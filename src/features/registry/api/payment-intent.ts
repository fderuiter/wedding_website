import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { PaymentIntentRequestSchema } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance, calculateContributionAmounts } from '@/lib/stripe';

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

  const { itemId, amount, coverFee, paymentIntentId, name, email, message, code } = parseResult.data;

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

  const priceCents = Math.round(targetItem.price * 100);
  const contributedCents = Math.round(targetItem.amountContributed * 100);
  const remainingCents = priceCents - contributedCents;
  const contributionCents = Math.round(amount * 100);

  if (contributionCents > remainingCents) {
    throw new ApiError(400, 'Contribution cannot be greater than the remaining amount.');
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

  const stripe = getStripeInstance();
  const metadata = {
    itemId: targetItem.id,
    itemName: targetItem.name,
    baseAmount: baseAmount.toFixed(2),
    feeAmount: feeAmount.toFixed(2),
    coverFee: coverFee ? 'true' : 'false',
    totalChargeAmount: totalChargeAmount.toFixed(2),
    contributorName: name || '',
    contributorEmail: email || '',
    contributorMessage: message || '',
    invitationCode: finalCode || '',
  };

  if (paymentIntentId) {
    try {
      const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (existingIntent && existingIntent.status === 'requires_payment_method') {
        const updated = await stripe.paymentIntents.update(paymentIntentId, {
          amount: totalChargeCents,
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
      }
    } catch {
      // In case update is not possible, fall through to create a new PaymentIntent
    }
  }

  const newPaymentIntent = await stripe.paymentIntents.create({
    amount: totalChargeCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
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
