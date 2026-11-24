import { NextResponse, NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { registryService } from '../service';
import { ContributionSchema } from '../schemas';
import {
  buildOptionalAddressFields,
  buildStripeUnavailableResponse,
  projectViewerRegistryItem,
  runContributionNotifications,
  validateSettlementPaymentIntent,
  verifyPaymentIntentOwnership,
} from './stripeSettlementHelpers';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  assertJsonContentType,
  getRequestMediaType,
  isJsonMediaType,
} from '@/utils/contentType';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance } from '@/lib/stripe';
import { signContributorActionToken } from '../lib/contributorToken';
import type { GuestClaimActions } from '../types';
import { resolveEffectivePaymentHandle } from '../utils/paymentUrls';

function settle<T>(operation: () => Promise<T> | T): Promise<PromiseSettledResult<T>> {
  return Promise.allSettled([Promise.resolve().then(operation)]).then(([result]) => result);
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const hasJsonContentType = isJsonMediaType(getRequestMediaType(request));
  const configSettledPromise = settle(() => getAppConfig());
  const bodySettledPromise = hasJsonContentType ? settle(() => request.json()) : null;
  const isAdminSettledPromise = settle(() => isAdminRequest(request));

  const configSettled = await configSettledPromise;
  if (configSettled.status === 'rejected') {
    throw configSettled.reason;
  }
  const config = configSettled.value;

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  assertJsonContentType(request);

  const bodySettled = await bodySettledPromise!;
  if (bodySettled.status === 'rejected') {
    throw new ApiError(400, 'Invalid JSON payload');
  }
  const data = bodySettled.value;
  const parseResult = ContributionSchema.safeParse(data);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const {
    itemId, name, email, amount, code, message, coverFee, paymentIntentId,
    retailerOrderNumber, carrier, trackingNumber,
  } = parseResult.data;

  const targetItemSettledPromise = settle(() => registryService.getItemById(itemId));
  const guestSessionSettledPromise = !code ? settle(() => getGuestInviteSession(request)) : null;

  let hasStripeConfigError = false;
  let stripeConfigError: unknown = null;
  let paymentIntentSettledPromise: Promise<PromiseSettledResult<Stripe.PaymentIntent>> | null = null;

  if (paymentIntentId) {
    try {
      const stripe = getStripeInstance();
      paymentIntentSettledPromise = settle(() => stripe.paymentIntents.retrieve(paymentIntentId));
    } catch (err: unknown) {
      hasStripeConfigError = true;
      stripeConfigError = err;
    }
  }

  const targetItemSettled = await targetItemSettledPromise;
  if (targetItemSettled.status === 'rejected') {
    throw targetItemSettled.reason;
  }
  const targetItem = targetItemSettled.value;

  if (targetItem && targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  if (!isFeatureEnabled('groupGifting', config.modules)) {
    if (targetItem && (targetItem.isGroupGift || amount < targetItem.price)) {
      throw new ApiError(400, 'Group gifting is currently disabled.');
    }
  }

  const isFund =
    targetItem?.itemType === 'CASH_FUND' || targetItem?.itemType === 'EXPERIENCE_FUND';
  const isPayableGroupGift = Boolean(isFund || targetItem?.isGroupGift);
  const effectiveHandle = resolveEffectivePaymentHandle(targetItem, config);

  if (isPayableGroupGift && !paymentIntentId && !effectiveHandle.paymentHandle) {
    throw new ApiError(
      400,
      isFund
        ? 'Direct transfer is not available for this fund because no payment handle is configured.'
        : 'Direct transfer is not available for this group gift because no payment handle is configured.'
    );
  }

  let finalCode = code;
  if (!finalCode && guestSessionSettledPromise) {
    const sessionSettled = await guestSessionSettledPromise;
    if (sessionSettled.status === 'rejected') {
      throw sessionSettled.reason;
    }
    if (sessionSettled.value?.code) {
      finalCode = sessionSettled.value.code;
    }
  }

  const effectiveCoverFee = isPayableGroupGift && !paymentIntentId ? false : Boolean(coverFee);

  let stripePaymentIntentId: string | null = null;
  let stripeChargeId: string | null = null;
  let transactionTimestamp: Date | null = null;

  if (paymentIntentId) {
    if (hasStripeConfigError) return buildStripeUnavailableResponse(stripeConfigError);

    const { paymentIntent } = await verifyPaymentIntentOwnership(
      { source: { settledResult: await paymentIntentSettledPromise! }, requireClientSecret: false },
      400
    );
    const settlement = validateSettlementPaymentIntent(
      paymentIntent,
      { itemId, expectedAmounts: { baseAmount: amount, coverFee: effectiveCoverFee }, errorMode: 'api-error' },
      400
    );
    stripePaymentIntentId = settlement.stripePaymentIntentId;
    stripeChargeId = settlement.stripeChargeId;
    transactionTimestamp = settlement.transactionTimestamp;
  }

  const updatedItem = await registryService.contributeToItem(itemId, {
    name,
    email,
    amount,
    code: finalCode,
    message,
    coverFee: effectiveCoverFee,
    ...(retailerOrderNumber ? { retailerOrderNumber } : {}),
    ...(carrier ? { carrier } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...buildOptionalAddressFields(parseResult.data),
    ...(stripePaymentIntentId
      ? { stripePaymentIntentId, stripeChargeId, transactionTimestamp }
      : {}),
  });

  await runContributionNotifications(
    {
      itemId,
      targetItem,
      updatedItem,
      contribution: {
        name,
        email,
        amount,
        message,
        coverFee: effectiveCoverFee,
        stripePaymentIntentId,
        transactionTimestamp,
        ...(retailerOrderNumber ? { retailerOrderNumber } : {}),
        ...(carrier ? { carrier } : {}),
        ...(trackingNumber ? { trackingNumber } : {}),
      },
      config,
      requestUrl: request.url,
      isReservation: !stripePaymentIntentId,
    },
    { mode: 'after' }
  );

  const isAdminSettled = await isAdminSettledPromise;
  if (isAdminSettled.status === 'rejected') {
    throw isAdminSettled.reason;
  }
  const isAdmin = isAdminSettled.value;
  let claimActions: GuestClaimActions | undefined;
  if (!isAdmin && !stripePaymentIntentId) {
    const previousIds = new Set(
      (Array.isArray(targetItem?.contributors) ? targetItem.contributors : [])
        .map((c) => c?.id)
        .filter((id): id is string => Boolean(id))
    );
    const updatedContributors = Array.isArray(updatedItem.contributors)
      ? updatedItem.contributors
      : [];
    const newlyAdded = updatedContributors.filter((c) => c?.id && !previousIds.has(c.id));
    const matchedContributor =
      newlyAdded.length > 0
        ? newlyAdded[newlyAdded.length - 1]
        : [...updatedContributors]
          .reverse()
          .find((c) => c?.id && c.name === name && c.amount === amount);

    if (matchedContributor?.id) {
      try {
        const [confirmToken, cancelToken] = await Promise.all([
          signContributorActionToken({
            contributorId: matchedContributor.id,
            action: 'confirm',
          }),
          signContributorActionToken({
            contributorId: matchedContributor.id,
            action: 'cancel',
          }),
        ]);
        claimActions = { confirmToken, cancelToken };
      } catch {
        claimActions = undefined;
      }
    }
  }

  return NextResponse.json(projectViewerRegistryItem(updatedItem, isAdmin, claimActions));
});
