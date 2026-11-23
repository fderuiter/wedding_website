import { NextResponse, NextRequest } from 'next/server';
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

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const data = await request.json();
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
    retailerOrderNumber,
    carrier,
    trackingNumber,
  } = parseResult.data;

  const targetItem = await registryService.getItemById(itemId);
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
  if (!finalCode) {
    const session = await getGuestInviteSession(request);
    if (session?.code) {
      finalCode = session.code;
    }
  }

  const effectiveCoverFee = isPayableGroupGift && !paymentIntentId ? false : Boolean(coverFee);

  let stripePaymentIntentId: string | null = null;
  let stripeChargeId: string | null = null;
  let transactionTimestamp: Date | null = null;

  if (paymentIntentId) {
    let stripe;
    try {
      stripe = getStripeInstance();
    } catch (err: any) {
      return NextResponse.json(
        {
          success: false,
          error: err?.message || 'Card checkout is not configured on this deployment.',
        },
        { status: 503 }
      );
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (err: any) {
      throw new ApiError(400, `Invalid or unresolved Stripe PaymentIntent: ${err.message}`);
    }

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
    ...(stripePaymentIntentId
      ? { stripePaymentIntentId, stripeChargeId, transactionTimestamp }
      : {}),
  });

  await dispatchContributionNotifications({
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
  });

  const isAdmin = await isAdminRequest(request);
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
});
