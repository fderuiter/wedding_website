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
import { getStripeInstance } from '@/lib/stripe';

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

  const { itemId, name, email, amount, code, message, coverFee, paymentIntentId } = parseResult.data;

  const targetItem = await registryService.getItemById(itemId);
  if (targetItem && targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  if (!isFeatureEnabled('groupGifting', config.modules)) {
    if (targetItem && (targetItem.isGroupGift || amount < targetItem.price)) {
      throw new ApiError(400, 'Group gifting is currently disabled.');
    }
  }

  let finalCode = code;
  if (!finalCode) {
    const session = await getGuestInviteSession(request);
    if (session?.code) {
      finalCode = session.code;
    }
  }

  let stripePaymentIntentId: string | null = null;
  let stripeChargeId: string | null = null;
  let transactionTimestamp: Date | null = null;

  if (paymentIntentId) {
    const stripe = getStripeInstance();
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (err: any) {
      throw new ApiError(400, `Invalid or unresolved Stripe PaymentIntent: ${err.message}`);
    }

    if (paymentIntent.status !== 'succeeded') {
      throw new ApiError(400, `PaymentIntent status is '${paymentIntent.status}'. Payment must be succeeded before recording contribution.`);
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
    coverFee,
    ...(stripePaymentIntentId
      ? { stripePaymentIntentId, stripeChargeId, transactionTimestamp }
      : {}),
  });

  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(maskRegistryItem(updatedItem));
  }
  return NextResponse.json(sanitizeRegistryItem(updatedItem));
});
