import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { PaymentIntentRequestSchema } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance, calculateContributionAmounts } from '@/lib/stripe';
import { timingSafeEqualJS } from '@/utils/crypto';

const STRIPE_METADATA_VALUE_MAX_LENGTH = 500;

function truncateStripeMetadata(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, STRIPE_METADATA_VALUE_MAX_LENGTH);
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const data = await request.json();
  const parseResult = PaymentIntentRequestSchema.safeParse(data);

  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const {
    itemId,
    amount,
    coverFee,
    paymentIntentId,
    clientSecret,
    name,
    email,
    message,
    code,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
  } = parseResult.data;

  const targetItem = await registryService.getItemById(itemId);
  if (!targetItem) {
    throw new ApiError(404, 'Item not found');
  }

  if (targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  if (targetItem.purchased) {
    throw new ApiError(400, 'This item has already been purchased.');
  }

  if (!isFeatureEnabled('groupGifting', config.modules)) {
    if (targetItem.isGroupGift || amount < targetItem.price) {
      throw new ApiError(400, 'Group gifting is currently disabled.');
    }
  }

  const isFund =
    targetItem.itemType === 'CASH_FUND' || targetItem.itemType === 'EXPERIENCE_FUND';
  const quantity = isFund ? 1 : Math.max(1, Math.floor(targetItem.quantity || 1));
  const unitPriceCents = Math.round(targetItem.price * 100);
  const totalTargetCents = unitPriceCents * quantity;
  const contributedCents = Math.round(targetItem.amountContributed * 100);
  const remainingCents = totalTargetCents - contributedCents;
  const contributionCents = Math.round(amount * 100);

  if (contributionCents > remainingCents) {
    throw new ApiError(400, 'Contribution cannot be greater than the remaining amount.');
  }

  if (!isFund && !targetItem.isGroupGift && unitPriceCents > 0) {
    if (contributionCents < unitPriceCents || contributionCents % unitPriceCents !== 0) {
      throw new ApiError(400, 'Contribution amount must match a whole number of available units.');
    }
  }

  let finalCode = code;
  if (!finalCode) {
    const session = await getGuestInviteSession(request);
    if (session?.code) {
      finalCode = session.code;
    }
  }

  const { baseAmount, feeAmount, totalChargeAmount, totalChargeCents, netPayout } =
    calculateContributionAmounts(amount, Boolean(coverFee));

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
  const trimmedEmail = email?.trim() || '';
  const metadata: Record<string, string> = {
    itemId: truncateStripeMetadata(targetItem.id),
    itemName: truncateStripeMetadata(targetItem.name),
    baseAmount: baseAmount.toFixed(2),
    feeAmount: feeAmount.toFixed(2),
    coverFee: coverFee ? 'true' : 'false',
    totalChargeAmount: totalChargeAmount.toFixed(2),
    contributorName: truncateStripeMetadata(name),
    contributorEmail: truncateStripeMetadata(trimmedEmail),
    contributorMessage: truncateStripeMetadata(message),
    invitationCode: truncateStripeMetadata(finalCode),
    addressLine1: truncateStripeMetadata(addressLine1?.trim()),
    addressLine2: truncateStripeMetadata(addressLine2?.trim()),
    city: truncateStripeMetadata(city?.trim()),
    state: truncateStripeMetadata(state?.trim()),
    zipCode: truncateStripeMetadata(zipCode?.trim()),
    country: truncateStripeMetadata(country?.trim()),
  };

  if (paymentIntentId) {
    if (!clientSecret) {
      throw new ApiError(403, 'Valid clientSecret is required to update an existing PaymentIntent.');
    }

    let existingIntent;
    try {
      existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch {
      throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
    }

    if (!existingIntent) {
      throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
    }

    const encoder = new TextEncoder();
    const providedSecretBytes = encoder.encode(clientSecret);
    const expectedSecretBytes =
      typeof existingIntent.client_secret === 'string' && existingIntent.client_secret.length > 0
        ? encoder.encode(existingIntent.client_secret)
        : null;
    const hasMatchingSecret =
      expectedSecretBytes !== null &&
      timingSafeEqualJS(providedSecretBytes, expectedSecretBytes);
    const hasMatchingItem = existingIntent.metadata?.itemId === targetItem.id;

    if (!hasMatchingSecret || !hasMatchingItem) {
      throw new ApiError(403, 'Forbidden: PaymentIntent ownership or item binding mismatch.');
    }

    if (existingIntent.status === 'requires_payment_method') {
      try {
        const updated = await stripe.paymentIntents.update(paymentIntentId, {
          amount: totalChargeCents,
          receipt_email: trimmedEmail || null,
          metadata,
        });
        return NextResponse.json({
          success: true,
          clientSecret: updated.client_secret,
          paymentIntentId: updated.id,
          amount: totalChargeAmount,
          baseAmount,
          feeAmount,
          coverFee: Boolean(coverFee),
          netPayout,
        });
      } catch {
        // In case update is no longer possible for a verified intent, fall through to create a new PaymentIntent
      }
    }
  }

  const newPaymentIntent = await stripe.paymentIntents.create({
    amount: totalChargeCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    ...(trimmedEmail ? { receipt_email: trimmedEmail } : {}),
    metadata,
  });

  return NextResponse.json({
    success: true,
    clientSecret: newPaymentIntent.client_secret,
    paymentIntentId: newPaymentIntent.id,
    amount: totalChargeAmount,
    baseAmount,
    feeAmount,
    coverFee: Boolean(coverFee),
    netPayout,
  });
});
