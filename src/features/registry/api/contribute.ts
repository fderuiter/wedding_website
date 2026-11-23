import { NextResponse, NextRequest, after } from 'next/server';
import { registryService } from '../service';
import { ContributionSchema } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance, validatePaymentIntentInvariants } from '@/lib/stripe';
import { dispatchContributionNotifications } from '../notifications';
import { signContributorActionToken } from '../lib/contributorToken';
import type { GuestClaimActions } from '../types';
import { resolveEffectivePaymentHandle } from '../utils/paymentUrls';

function settle<T>(operation: () => Promise<T> | T): Promise<PromiseSettledResult<T>> {
  return Promise.allSettled([Promise.resolve().then(operation)]).then(([result]) => result);
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const configSettledPromise = settle(() => getAppConfig());
  const bodySettledPromise = settle(() => request.json());
  const isAdminSettledPromise = settle(() => isAdminRequest(request));

  const configSettled = await configSettledPromise;
  if (configSettled.status === 'rejected') {
    throw configSettled.reason;
  }
  const config = configSettled.value;

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const bodySettled = await bodySettledPromise;
  if (bodySettled.status === 'rejected') {
    throw bodySettled.reason;
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
    message,
    coverFee,
    paymentIntentId,
    retailerOrderNumber,
    carrier,
    trackingNumber,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
  } = parseResult.data;

  const targetItemSettledPromise = settle(() => registryService.getItemById(itemId));
  const guestSessionSettledPromise = settle(() => getGuestInviteSession(request));

  let hasStripeConfigError = false;
  let stripeConfigError: unknown = null;
  let paymentIntentSettledPromise: Promise<
    PromiseSettledResult<
      Awaited<ReturnType<ReturnType<typeof getStripeInstance>['paymentIntents']['retrieve']>>
    >
  > | null = null;

  if (paymentIntentId) {
    try {
      const stripe = getStripeInstance();
      paymentIntentSettledPromise = settle(() =>
        stripe.paymentIntents.retrieve(paymentIntentId)
      );
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

  const sessionSettled = await guestSessionSettledPromise;
  if (sessionSettled.status === 'rejected') {
    throw sessionSettled.reason;
  }
  const finalCode = sessionSettled.value?.code;

  const isAdminSettled = await isAdminSettledPromise;
  if (isAdminSettled.status === 'rejected') {
    throw isAdminSettled.reason;
  }
  const isAdmin = isAdminSettled.value;

  if (!paymentIntentId && !finalCode && !isAdmin) {
    throw new ApiError(
      403,
      'A verified invitation code session is required to reserve gifts or record direct transfers.'
    );
  }

  const effectiveCoverFee = isPayableGroupGift && !paymentIntentId ? false : Boolean(coverFee);

  let stripePaymentIntentId: string | null = null;
  let stripeChargeId: string | null = null;
  let transactionTimestamp: Date | null = null;

  if (paymentIntentId) {
    if (hasStripeConfigError) {
      const err = stripeConfigError as { message?: string } | null;
      return NextResponse.json(
        {
          success: false,
          error: err?.message || 'Card checkout is not configured on this deployment.',
        },
        { status: 503 }
      );
    }

    const paymentIntentSettled = await paymentIntentSettledPromise!;
    if (paymentIntentSettled.status === 'rejected') {
      const err = paymentIntentSettled.reason as { message?: string } | null;
      throw new ApiError(400, `Invalid or unresolved Stripe PaymentIntent: ${err?.message}`);
    }
    const paymentIntent = paymentIntentSettled.value;

    const invariantCheck = validatePaymentIntentInvariants(paymentIntent, {
      itemId,
      baseAmount: amount,
      coverFee: effectiveCoverFee,
    });
    if (!invariantCheck.valid) {
      throw new ApiError(400, invariantCheck.error || 'Invalid Stripe PaymentIntent.');
    }

    stripePaymentIntentId = paymentIntent.id;
    stripeChargeId = typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : (paymentIntent.latest_charge as any)?.id || null;
    transactionTimestamp = paymentIntent.created ? new Date(paymentIntent.created * 1000) : new Date();
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
    ...(addressLine1 ? { addressLine1 } : {}),
    ...(addressLine2 ? { addressLine2 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(country ? { country } : {}),
    ...(stripePaymentIntentId
      ? { stripePaymentIntentId, stripeChargeId, transactionTimestamp }
      : {}),
  });

  const requestUrl = request.url;
  const isReservation = !stripePaymentIntentId;
  let notificationDispatchPromise: Promise<void> | undefined;
  const runNotifications = () => {
    notificationDispatchPromise ??= dispatchContributionNotifications({
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
      requestUrl,
      isReservation,
      verifiedInvitationCode: finalCode,
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

  if (!isAdmin) {
    let claimActions: GuestClaimActions | undefined;
    if (!stripePaymentIntentId) {
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

    const maskedItem = maskRegistryItem({
      ...updatedItem,
      contributors: [],
    });
    return NextResponse.json(
      claimActions ? { ...maskedItem, claimActions } : maskedItem
    );
  }
  return NextResponse.json(sanitizeRegistryItem(updatedItem));
}, {
  limit: 20,
  windowMs: 60 * 1000,
  keyPrefix: 'registry-contribute',
});
