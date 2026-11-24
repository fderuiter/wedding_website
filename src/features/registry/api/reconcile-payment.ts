import { NextResponse, NextRequest, after } from 'next/server';
import { registryService } from '../service';
import { ReconcilePaymentIntentSchema } from '../schemas';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';
import { dispatchContributionNotifications } from '../notifications';
import type { ReconciledContributionReceipt } from '../types';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import {
  getStripeInstance,
  calculateContributionAmounts,
  validatePaymentIntentInvariants,
} from '@/lib/stripe';
import { timingSafeEqualJS } from '@/utils/crypto';

/**
 * Reconciles a redirected Stripe PaymentIntent on return to `/registry`.
 * Verifies clientSecret ownership in constant time before exposing receipt details,
 * validates Stripe settlement invariants, records the contribution idempotently,
 * and triggers deduplicated guest/couple notifications.
 */
export const POST = withApiMiddleware(async (request: NextRequest) => {
  const [config, data, isAdmin] = await Promise.all([
    getAppConfig(),
    request.json(),
    isAdminRequest(request),
  ]);

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const parseResult = ReconcilePaymentIntentSchema.safeParse(data);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { paymentIntentId, clientSecret, itemId: requestedItemId } = parseResult.data;

  let stripe: ReturnType<typeof getStripeInstance>;
  try {
    stripe = getStripeInstance();
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Card checkout is not configured on this deployment.';
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }

  let paymentIntent: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
  }

  if (!paymentIntent) {
    throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
  }

  const encoder = new TextEncoder();
  const providedSecretBytes = encoder.encode(clientSecret);
  const expectedSecretBytes =
    typeof paymentIntent.client_secret === 'string' && paymentIntent.client_secret.length > 0
      ? encoder.encode(paymentIntent.client_secret)
      : null;

  const hasMatchingSecret =
    expectedSecretBytes !== null &&
    timingSafeEqualJS(providedSecretBytes, expectedSecretBytes);

  if (!hasMatchingSecret) {
    throw new ApiError(403, 'Forbidden: PaymentIntent ownership mismatch.');
  }

  const metadata = paymentIntent.metadata || {};
  const resolvedItemId = typeof metadata.itemId === 'string' ? metadata.itemId.trim() : '';

  if (!resolvedItemId) {
    throw new ApiError(400, 'PaymentIntent is missing registry item metadata.');
  }

  if (requestedItemId && requestedItemId !== resolvedItemId) {
    throw new ApiError(403, 'Forbidden: PaymentIntent item binding mismatch.');
  }

  if (paymentIntent.status !== 'succeeded') {
    const declineMessage =
      paymentIntent.last_payment_error?.message ||
      'Your payment was not completed or was canceled. No contribution was recorded — please try again or choose another payment method.';
    return NextResponse.json({
      reconciled: false,
      status: paymentIntent.status,
      itemId: resolvedItemId,
      error: declineMessage,
    });
  }

  const rawMetaCoverFee = metadata.coverFee;
  if (
    rawMetaCoverFee !== undefined &&
    rawMetaCoverFee !== '' &&
    rawMetaCoverFee !== 'true' &&
    rawMetaCoverFee !== 'false'
  ) {
    throw new ApiError(400, 'Invalid PaymentIntent coverFee metadata.');
  }
  const coverFee = rawMetaCoverFee === 'true';

  let baseAmount: number;
  if (metadata.baseAmount !== undefined && metadata.baseAmount !== '') {
    const parsedBaseAmount = Number(metadata.baseAmount);
    if (!Number.isFinite(parsedBaseAmount) || parsedBaseAmount <= 0) {
      throw new ApiError(400, 'Invalid PaymentIntent baseAmount metadata.');
    }
    baseAmount = parsedBaseAmount;
  } else if (!coverFee && typeof paymentIntent.amount === 'number' && paymentIntent.amount > 0) {
    baseAmount = paymentIntent.amount / 100;
  } else {
    throw new ApiError(400, 'Missing PaymentIntent baseAmount metadata.');
  }

  const invariantCheck = validatePaymentIntentInvariants(paymentIntent, {
    itemId: resolvedItemId,
    baseAmount,
    coverFee,
  });
  if (!invariantCheck.valid) {
    throw new ApiError(400, invariantCheck.error || 'Invalid Stripe PaymentIntent.');
  }

  const targetItem = await registryService.getItemById(resolvedItemId);
  if (!targetItem) {
    throw new ApiError(404, 'Item not found');
  }
  if (targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  const contributorNameFromMeta = metadata.contributorName?.trim() || 'Anonymous Guest';
  const contributorEmailFromMeta = metadata.contributorEmail?.trim() || null;
  const contributorMessage = metadata.contributorMessage?.trim() || null;
  const invitationCode = metadata.invitationCode?.trim() || undefined;
  const addressLine1 = metadata.addressLine1?.trim() || undefined;
  const addressLine2 = metadata.addressLine2?.trim() || undefined;
  const city = metadata.city?.trim() || undefined;
  const state = metadata.state?.trim() || undefined;
  const zipCode = metadata.zipCode?.trim() || undefined;
  const country = metadata.country?.trim() || undefined;

  const latestCharge = paymentIntent.latest_charge;
  const stripeChargeId =
    typeof latestCharge === 'string'
      ? latestCharge
      : latestCharge && typeof latestCharge === 'object' && 'id' in latestCharge && typeof latestCharge.id === 'string'
        ? latestCharge.id
        : null;
  const transactionTimestamp = paymentIntent.created
    ? new Date(paymentIntent.created * 1000)
    : new Date();

  const updatedItem = await registryService.contributeToItem(resolvedItemId, {
    name: contributorNameFromMeta,
    email: contributorEmailFromMeta,
    amount: baseAmount,
    code: invitationCode,
    message: contributorMessage,
    coverFee,
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId,
    transactionTimestamp,
    ...(addressLine1 ? { addressLine1 } : {}),
    ...(addressLine2 ? { addressLine2 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(country ? { country } : {}),
  });

  const savedContributor = Array.isArray(updatedItem.contributors)
    ? updatedItem.contributors.find((c) => c?.stripePaymentIntentId === paymentIntent.id)
    : undefined;
  const resolvedContributorName = savedContributor?.name || contributorNameFromMeta;
  const resolvedContributorEmail = savedContributor?.email ?? contributorEmailFromMeta;

  const requestUrl = request.url;
  let notificationDispatchPromise: Promise<void> | undefined;
  const runNotifications = () => {
    notificationDispatchPromise ??= dispatchContributionNotifications({
      itemId: resolvedItemId,
      targetItem,
      updatedItem,
      contribution: {
        name: resolvedContributorName,
        email: resolvedContributorEmail,
        amount: baseAmount,
        message: contributorMessage,
        coverFee,
        stripePaymentIntentId: paymentIntent.id,
        transactionTimestamp,
      },
      config,
      requestUrl,
      isReservation: false,
    });
    return notificationDispatchPromise;
  };

  let scheduledPostResponse = false;
  if (typeof after === 'function') {
    try {
      after(runNotifications);
      scheduledPostResponse = true;
    } catch {
      scheduledPostResponse = false;
    }
  }

  if (!scheduledPostResponse) {
    await runNotifications();
  }

  const { feeAmount, totalChargeAmount } = calculateContributionAmounts(baseAmount, coverFee);
  const receipt: ReconciledContributionReceipt = {
    itemId: resolvedItemId,
    paymentIntentId: paymentIntent.id,
    contributorName: resolvedContributorName,
    contributorEmail: resolvedContributorEmail ?? null,
    baseAmount,
    feeAmount,
    coverFee,
    totalChargeAmount,
    message: contributorMessage,
  };

  const responseItem = isAdmin
    ? sanitizeRegistryItem(updatedItem)
    : maskRegistryItem({
      ...updatedItem,
      contributors: [],
    });

  return NextResponse.json({
    reconciled: true,
    status: 'succeeded',
    itemId: resolvedItemId,
    item: responseItem,
    receipt,
  });
});
