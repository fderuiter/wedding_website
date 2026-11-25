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
import { isGuestRequest } from '@/core/auth/guest.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance } from '@/lib/stripe';
import { checkAuthLockout, recordAuthFailure } from '@/utils/rateLimit';
import { signContributorActionToken } from '../lib/contributorToken';
import type { GuestClaimActions } from '../types';
import {
  extractShippingAddressFromConfig,
  resolveEffectivePaymentHandle,
} from '../utils/paymentUrls';

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
  const isPasscodeGuestSettledPromise = settle(() => isGuestRequest(request));

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

  const [sessionSettled, isAdminSettled, isPasscodeGuestSettled] = await Promise.all([
    guestSessionSettledPromise,
    isAdminSettledPromise,
    isPasscodeGuestSettledPromise,
  ]);
  if (sessionSettled.status === 'rejected') {
    throw sessionSettled.reason;
  }
  if (isAdminSettled.status === 'rejected') {
    throw isAdminSettled.reason;
  }
  if (isPasscodeGuestSettled.status === 'rejected') {
    throw isPasscodeGuestSettled.reason;
  }

  const session = sessionSettled.value;
  const isAdmin = isAdminSettled.value;
  const isPasscodeGuest = isPasscodeGuestSettled.value;
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
  const giftAccessTier =
    config.registryGiftAccessTier === 'INVITED_HOUSEHOLDS'
      ? 'INVITED_HOUSEHOLDS'
      : 'PASSCODE_GUESTS';

  if (!paymentIntentId) {
    if (giftAccessTier === 'INVITED_HOUSEHOLDS') {
      if (!isAdmin && !verifiedHouseholdCode) {
        throw new ApiError(
          403,
          'This wedding registry requires a verified household invitation code before claiming a gift or recording a direct transfer. Please verify the invitation code from your wedding invitation.'
        );
      }
    } else {
      const isAuthorizedClaimer = isAdmin || Boolean(verifiedHouseholdCode) || isPasscodeGuest;
      if (!isAuthorizedClaimer) {
        throw new ApiError(
          403,
          'Please sign in with the wedding passcode or verify your household invitation code before claiming a gift or recording a direct transfer.'
        );
      }
    }
  }

  if (!paymentIntentId && !verifiedHouseholdCode && !isAdmin) {
    const trimmedClaimEmail = email?.trim() ?? '';
    if (!trimmedClaimEmail) {
      throw new ApiError(
        400,
        'Email address is required when claiming a gift or recording a transfer without a household invitation code.'
      );
    }
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

  const configuredMaxPendingReservations =
    typeof config.maxPendingReservations === 'number' &&
    Number.isFinite(config.maxPendingReservations)
      ? Math.min(100, Math.max(1, Math.trunc(config.maxPendingReservations)))
      : undefined;

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
    ...(configuredMaxPendingReservations !== undefined
      ? { maxPendingReservations: configuredMaxPendingReservations }
      : {}),
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
      allowPasscodeReservationEmail: Boolean(!effectiveCode && isPasscodeGuest && !isAdmin),
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
        const resolvedItemType = targetItem?.itemType ?? updatedItem.itemType ?? 'PHYSICAL';
        const { shippingCandidate, hasShippingAddress } = extractShippingAddressFromConfig(config);
        claimActions = {
          confirmToken,
          cancelToken,
          ...(resolvedItemType === 'PHYSICAL' && hasShippingAddress
            ? { shippingAddress: shippingCandidate }
            : {}),
        };
      } catch {
        claimActions = undefined;
      }
    }
  }

  return NextResponse.json(projectViewerRegistryItem(updatedItem, isAdmin, claimActions));
}, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'registry-contribute', ipLimit: 20 });
