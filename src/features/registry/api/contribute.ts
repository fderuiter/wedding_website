import { NextResponse, NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { registryService } from '../service';
import { ContributionSchema } from '../schemas';
import {
  buildOptionalAddressFields,
  buildStripeUnavailableResponse,
  mapStripeMetadataToContributor,
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
import { checkAuthLockout, recordAuthFailure } from '@/utils/rateLimit';
import { mintContributorActionPair } from '../lib/contributorToken';
import type { GuestClaimActions } from '../types';
import { resolveEffectivePaymentHandle } from '../utils/paymentUrls';

function settle<T>(operation: () => Promise<T> | T): Promise<PromiseSettledResult<T>> {
  return Promise.allSettled([Promise.resolve().then(operation)]).then(([result]) => result);
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const hasHeaders = Boolean(request?.headers && typeof request.headers.get === 'function');
  if (hasHeaders) {
    const lockoutResponse = await checkAuthLockout(request);
    if (lockoutResponse) {
      return lockoutResponse;
    }
  }

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
    itemId,
    name,
    email,
    amount,
    code,
    message,
    coverFee,
    paymentIntentId,
    clientSecret,
    retailerOrderNumber,
    carrier,
    trackingNumber,
  } = parseResult.data;

  const targetItemSettledPromise = settle(() => registryService.getItemById(itemId));
  const guestSessionSettledPromise = settle(() => getGuestInviteSession(request));

  let hasStripeConfigError = false;
  let stripeConfigError: unknown = null;
  let paymentIntentSettledPromise: Promise<PromiseSettledResult<Stripe.PaymentIntent>> | null = null;

  if (paymentIntentId) {
    try {
      const stripe = getStripeInstance();
      if (clientSecret) {
        paymentIntentSettledPromise = settle(() => stripe.paymentIntents.retrieve(paymentIntentId));
      }
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

  const [sessionSettled, isAdminSettled] = await Promise.all([
    guestSessionSettledPromise,
    isAdminSettledPromise,
  ]);
  if (sessionSettled.status === 'rejected') {
    throw sessionSettled.reason;
  }
  if (isAdminSettled.status === 'rejected') {
    throw isAdminSettled.reason;
  }

  const session = sessionSettled.value;
  const isAdmin = isAdminSettled.value;
  const submittedCode = code?.trim() ? code.trim() : undefined;
  const sessionCode = session?.code?.trim() ? session.code.trim() : undefined;

  if (!isAdmin && submittedCode) {
    if (!sessionCode || sessionCode.toUpperCase() !== submittedCode.toUpperCase()) {
      if (hasHeaders) {
        await recordAuthFailure(request);
      }
      throw new ApiError(
        403,
        'Forbidden: Please verify your household invitation code before linking a contribution to a household.'
      );
    }
  }

  const verifiedHouseholdCode = isAdmin ? submittedCode : sessionCode;

  if (!paymentIntentId && !verifiedHouseholdCode && !isAdmin) {
    throw new ApiError(
      403,
      'Please verify your household invitation code before claiming a gift or recording a direct transfer.'
    );
  }

  let effectiveName = name;
  let effectiveEmail: string | null | undefined = email;
  let effectiveCode: string | undefined = verifiedHouseholdCode;
  let effectiveMessage: string | null | undefined = message;
  let effectiveAddressFields = buildOptionalAddressFields(parseResult.data);
  let effectiveAmount = amount;
  let effectiveCoverFee = isPayableGroupGift && !paymentIntentId ? false : Boolean(coverFee);

  let stripePaymentIntentId: string | null = null;
  let stripeChargeId: string | null = null;
  let transactionTimestamp: Date | null = null;

  if (paymentIntentId) {
    if (hasStripeConfigError) return buildStripeUnavailableResponse(stripeConfigError);

    let paymentIntent: Stripe.PaymentIntent;
    try {
      const ownership = await verifyPaymentIntentOwnership(
        {
          source: paymentIntentSettledPromise
            ? { settledResult: await paymentIntentSettledPromise }
            : {
              settledResult: {
                status: 'rejected',
                reason: new Error('Missing clientSecret'),
              },
            },
          requireClientSecret: true,
          clientSecret,
        },
        403
      );
      paymentIntent = ownership.paymentIntent;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 403 && hasHeaders) {
        await recordAuthFailure(request);
      }
      throw err;
    }

    const settlement = validateSettlementPaymentIntent(
      paymentIntent,
      { itemId, expectedAmounts: { baseAmount: amount, coverFee: effectiveCoverFee }, errorMode: 'api-error' },
      400
    );
    stripePaymentIntentId = settlement.stripePaymentIntentId;
    stripeChargeId = settlement.stripeChargeId;
    transactionTimestamp = settlement.transactionTimestamp;
    effectiveAmount = settlement.baseAmount;
    effectiveCoverFee = settlement.coverFee;

    const mapped = mapStripeMetadataToContributor(paymentIntent.metadata, {
      trimIdentity: true,
    });
    effectiveName = mapped.name;
    effectiveEmail = mapped.email;
    effectiveCode = mapped.code;
    effectiveMessage = mapped.message;
    effectiveAddressFields = mapped.addressFields;
  }

  const updatedItem = await registryService.contributeToItem(itemId, {
    name: effectiveName,
    email: effectiveEmail,
    amount: effectiveAmount,
    code: effectiveCode,
    message: effectiveMessage,
    coverFee: effectiveCoverFee,
    ...(retailerOrderNumber ? { retailerOrderNumber } : {}),
    ...(carrier ? { carrier } : {}),
    ...(trackingNumber ? { trackingNumber } : {}),
    ...effectiveAddressFields,
    ...(stripePaymentIntentId
      ? { stripePaymentIntentId, stripeChargeId, transactionTimestamp }
      : {}),
  });

  const savedContributor =
    stripePaymentIntentId && Array.isArray(updatedItem.contributors)
      ? updatedItem.contributors.find((c) => c?.stripePaymentIntentId === stripePaymentIntentId)
      : undefined;
  const notificationName = stripePaymentIntentId
    ? savedContributor?.name || effectiveName
    : effectiveName;
  const notificationEmail = stripePaymentIntentId
    ? savedContributor?.email ?? effectiveEmail
    : effectiveEmail;

  await runContributionNotifications(
    {
      itemId,
      targetItem,
      updatedItem,
      contribution: {
        name: notificationName,
        email: notificationEmail,
        amount: effectiveAmount,
        message: effectiveMessage,
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
      verifiedInvitationCode: effectiveCode,
    },
    { mode: 'after' }
  );

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
          .find((c) => c?.id && c.name === effectiveName && c.amount === effectiveAmount);

    if (matchedContributor?.id) {
      try {
        claimActions = await mintContributorActionPair({
          contributorId: matchedContributor.id,
          request,
          config,
        });
      } catch {
        claimActions = undefined;
      }
    }
  }

  return NextResponse.json(projectViewerRegistryItem(updatedItem, isAdmin, claimActions));
}, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'registry-contribute' });
