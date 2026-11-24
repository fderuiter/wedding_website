import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { ReconcilePaymentIntentSchema } from '../schemas';
import {
  mapStripeMetadataToContributor,
  projectViewerRegistryItem,
  resolveStripeClient,
  runContributionNotifications,
  validateSettlementPaymentIntent,
  verifyPaymentIntentOwnership,
} from './stripeSettlementHelpers';
import type { ReconciledContributionReceipt } from '../types';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { calculateContributionAmounts } from '@/lib/stripe';
import { parseJsonRequestBody } from '@/utils/contentType';

/**
 * Reconciles a redirected Stripe PaymentIntent on return to `/registry`.
 * Verifies clientSecret ownership in constant time before exposing receipt details,
 * validates Stripe settlement invariants, records the contribution idempotently,
 * and triggers deduplicated guest/couple notifications.
 */
export const POST = withApiMiddleware(async (request: NextRequest) => {
  const data = await parseJsonRequestBody(request);
  const [config, isAdmin] = await Promise.all([getAppConfig(), isAdminRequest(request)]);

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const parseResult = ReconcilePaymentIntentSchema.safeParse(data);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { paymentIntentId, clientSecret, itemId: requestedItemId } = parseResult.data;

  const stripeResult = resolveStripeClient();
  if (!stripeResult.ok) return stripeResult.response;

  const { paymentIntent, resolvedItemId } = await verifyPaymentIntentOwnership(
    {
      source: { stripe: stripeResult.stripe, paymentIntentId },
      requireClientSecret: true,
      clientSecret,
      expectedItemId: requestedItemId,
      requireMetadataItemId: true,
    },
    403
  );

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

  const settlement = validateSettlementPaymentIntent(
    paymentIntent,
    { itemId: resolvedItemId, errorMode: 'api-error' },
    400
  );

  const targetItem = await registryService.getItemById(resolvedItemId);
  if (!targetItem) throw new ApiError(404, 'Item not found');
  if (targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  const mapped = mapStripeMetadataToContributor(paymentIntent.metadata, { trimIdentity: true });
  const updatedItem = await registryService.contributeToItem(resolvedItemId, {
    name: mapped.name,
    email: mapped.email,
    amount: settlement.baseAmount,
    code: mapped.code,
    message: mapped.message,
    coverFee: settlement.coverFee,
    stripePaymentIntentId: settlement.stripePaymentIntentId,
    stripeChargeId: settlement.stripeChargeId,
    transactionTimestamp: settlement.transactionTimestamp,
    ...mapped.addressFields,
  });

  const savedContributor = Array.isArray(updatedItem.contributors)
    ? updatedItem.contributors.find((c) => c?.stripePaymentIntentId === settlement.stripePaymentIntentId)
    : undefined;
  const resolvedContributorName = savedContributor?.name || mapped.name;
  const resolvedContributorEmail = savedContributor?.email ?? mapped.email;

  await runContributionNotifications(
    {
      itemId: resolvedItemId,
      targetItem,
      updatedItem,
      contribution: {
        name: resolvedContributorName,
        email: resolvedContributorEmail,
        amount: settlement.baseAmount,
        message: mapped.message,
        coverFee: settlement.coverFee,
        stripePaymentIntentId: settlement.stripePaymentIntentId,
        transactionTimestamp: settlement.transactionTimestamp,
      },
      config,
      requestUrl: request.url,
      isReservation: false,
    },
    { mode: 'after' }
  );

  const { feeAmount, totalChargeAmount } = calculateContributionAmounts(
    settlement.baseAmount,
    settlement.coverFee
  );
  const receipt: ReconciledContributionReceipt = {
    itemId: resolvedItemId,
    paymentIntentId: settlement.stripePaymentIntentId,
    contributorName: resolvedContributorName,
    contributorEmail: resolvedContributorEmail ?? null,
    baseAmount: settlement.baseAmount,
    feeAmount,
    coverFee: settlement.coverFee,
    totalChargeAmount,
    message: mapped.message,
  };

  return NextResponse.json({
    reconciled: true,
    status: 'succeeded',
    itemId: resolvedItemId,
    item: projectViewerRegistryItem(updatedItem, isAdmin),
    receipt,
  });
});
