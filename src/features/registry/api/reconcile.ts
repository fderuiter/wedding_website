import { NextRequest, NextResponse } from 'next/server';
import { registryService } from '../service';
import { ReconcilePaymentIntentSchema } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getStripeInstance, validatePaymentIntentInvariants } from '@/lib/stripe';
import { timingSafeEqualJS } from '@/utils/crypto';
import { maskRegistryItem } from '../lib/masking';
import { dispatchContributionNotifications } from '../notifications';

function verifyClientSecretConstantTime(expected: unknown, provided: string): boolean {
  if (typeof expected !== 'string' || expected.length === 0 || !provided) {
    return false;
  }
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const providedBytes = encoder.encode(provided);
  if (expectedBytes.byteLength !== providedBytes.byteLength) {
    timingSafeEqualJS(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqualJS(providedBytes, expectedBytes);
}

/**
 * Reconciles a Stripe redirect PaymentIntent on the server using constant-time
 * `payment_intent_client_secret` verification, recording succeeded contributions
 * idempotently from PaymentIntent metadata while omitting donor emails and personal
 * notes from public responses.
 */
export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const data = await request.json();
  const parseResult = ReconcilePaymentIntentSchema.safeParse(data);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { paymentIntentId, clientSecret, itemId } = parseResult.data;

  let stripe;
  try {
    stripe = getStripeInstance();
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Card checkout is not configured on this deployment.',
      },
      { status: 503 }
    );
  }

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
  }

  if (!paymentIntent || !verifyClientSecretConstantTime(paymentIntent.client_secret, clientSecret)) {
    throw new ApiError(403, 'Forbidden: PaymentIntent client secret verification failed.');
  }

  const metadata = paymentIntent.metadata || {};
  const metadataItemId = typeof metadata.itemId === 'string' ? metadata.itemId.trim() : '';
  const resolvedItemId = metadataItemId || itemId || '';

  if (!resolvedItemId) {
    throw new ApiError(400, 'PaymentIntent is missing registry item metadata.');
  }

  if (itemId && metadataItemId && itemId !== metadataItemId) {
    throw new ApiError(403, 'Forbidden: PaymentIntent item binding mismatch.');
  }

  const targetItem = await registryService.getItemById(resolvedItemId);
  if (!targetItem) {
    throw new ApiError(404, 'Item not found');
  }

  if (targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
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

  let baseAmount: number | undefined;
  if (metadata.baseAmount !== undefined && metadata.baseAmount !== '') {
    const parsedBaseAmount = Number(metadata.baseAmount);
    if (!Number.isFinite(parsedBaseAmount) || parsedBaseAmount <= 0) {
      throw new ApiError(400, 'Invalid PaymentIntent baseAmount metadata.');
    }
    baseAmount = parsedBaseAmount;
  } else if (!coverFee && typeof paymentIntent.amount === 'number' && paymentIntent.amount > 0) {
    baseAmount = Math.round(paymentIntent.amount) / 100;
  }

  const rawContributorName = (metadata.contributorName || '').trim();
  const contributorName = rawContributorName || 'Anonymous Guest';
  const contributorEmail = (metadata.contributorEmail || '').trim() || null;
  const contributorMessage = metadata.contributorMessage || null;
  const invitationCode = (metadata.invitationCode || '').trim() || undefined;

  if (paymentIntent.status === 'succeeded') {
    if (baseAmount === undefined || baseAmount <= 0) {
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

    const stripeChargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : (paymentIntent.latest_charge as { id?: string } | null)?.id || null;
    const transactionTimestamp = paymentIntent.created
      ? new Date(paymentIntent.created * 1000)
      : new Date();

    let updatedItem;
    try {
      updatedItem = await registryService.contributeToItem(resolvedItemId, {
        name: contributorName,
        email: contributorEmail,
        amount: baseAmount,
        code: invitationCode,
        message: contributorMessage,
        coverFee,
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId,
        transactionTimestamp,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }
      if (err instanceof Error) {
        if (
          err.message === 'This item has already been purchased.' ||
          err.message === 'Contribution cannot be greater than the remaining amount.'
        ) {
          throw new ApiError(409, err.message);
        }
        if (
          err.message === 'Invalid invitation code.' ||
          err.message === 'Sample registry items do not accept contributions or payments.'
        ) {
          throw new ApiError(400, err.message);
        }
        if (err.message === 'Item not found') {
          throw new ApiError(404, err.message);
        }
      }
      throw err;
    }

    await dispatchContributionNotifications({
      itemId: resolvedItemId,
      targetItem,
      updatedItem,
      contribution: {
        name: contributorName,
        email: contributorEmail,
        amount: baseAmount,
        message: contributorMessage,
        coverFee,
        stripePaymentIntentId: paymentIntent.id,
        transactionTimestamp,
      },
      config,
      requestUrl: request.url,
    });

    return NextResponse.json({
      status: 'succeeded',
      recorded: true,
      paymentIntentId: paymentIntent.id,
      itemId: resolvedItemId,
      amount: baseAmount,
      coverFee,
      contributorName,
      item: maskRegistryItem(updatedItem),
    });
  }

  if (paymentIntent.status === 'processing' || paymentIntent.status === 'requires_capture') {
    return NextResponse.json({
      status: 'processing',
      recorded: false,
      paymentIntentId: paymentIntent.id,
      itemId: resolvedItemId,
      ...(baseAmount !== undefined ? { amount: baseAmount } : {}),
      coverFee,
      ...(rawContributorName ? { contributorName: rawContributorName } : {}),
      item: maskRegistryItem(targetItem),
    });
  }

  const failureMessage = paymentIntent.last_payment_error?.message
    ? 'Your payment could not be completed by your card issuer. Please review your payment details or try another payment method.'
    : 'Your payment was not completed. Please review your payment details and try again.';

  return NextResponse.json({
    status: 'failed',
    recorded: false,
    paymentIntentId: paymentIntent.id,
    itemId: resolvedItemId,
    ...(baseAmount !== undefined ? { amount: baseAmount } : {}),
    coverFee,
    ...(rawContributorName ? { contributorName: rawContributorName } : {}),
    failureMessage,
    item: maskRegistryItem(targetItem),
  });
});
