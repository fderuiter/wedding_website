import { NextResponse, NextRequest } from 'next/server';
import Stripe from 'stripe';
import { registryService } from '../service';
import {
  dispatchContributionNotifications,
  dispatchLedgerAdjustmentNotification,
} from '../notifications';
import { getStripeInstance, validatePaymentIntentInvariants } from '@/lib/stripe';
import { getAppConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { StripeWebhookEventSchema } from '@/utils/validation';

/**
 * Stripe webhook handler for registry contributions.
 * Cryptographically verifies signatures using STRIPE_WEBHOOK_SECRET.
 * Processes payment_intent.succeeded, charge.refunded, and charge.dispute.created idempotently.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new NextResponse('Missing stripe-signature header', { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new NextResponse('Webhook secret is not configured', { status: 500 });
  }

  let event: Stripe.Event;
  try {
    let rawBody = '';
    if (typeof request.text === 'function') {
      rawBody = await request.text();
    } else if (typeof (request as any).json === 'function') {
      const parsed = await (request as any).json();
      rawBody = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    }
    const stripe = getStripeInstance();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    return new NextResponse(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  const parsedEvent = StripeWebhookEventSchema.safeParse(event);
  if (parsedEvent.success && event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const metadata = paymentIntent.metadata || {};
    const itemId = metadata.itemId;

    if (itemId) {
      const rawMetaCoverFee = metadata.coverFee;
      if (
        rawMetaCoverFee !== undefined &&
        rawMetaCoverFee !== '' &&
        rawMetaCoverFee !== 'true' &&
        rawMetaCoverFee !== 'false'
      ) {
        return new NextResponse('Invalid PaymentIntent coverFee metadata', { status: 400 });
      }
      const coverFee = rawMetaCoverFee === 'true';

      let baseAmount: number;
      if (metadata.baseAmount !== undefined && metadata.baseAmount !== '') {
        const parsedBaseAmount = Number(metadata.baseAmount);
        if (!Number.isFinite(parsedBaseAmount) || parsedBaseAmount <= 0) {
          return new NextResponse('Invalid PaymentIntent baseAmount metadata', { status: 400 });
        }
        baseAmount = parsedBaseAmount;
      } else if (!coverFee && typeof paymentIntent.amount === 'number' && paymentIntent.amount > 0) {
        baseAmount = paymentIntent.amount / 100;
      } else {
        return new NextResponse('Missing PaymentIntent baseAmount metadata', { status: 400 });
      }

      const invariantCheck = validatePaymentIntentInvariants(
        {
          ...paymentIntent,
          status: paymentIntent.status ?? 'succeeded',
        },
        {
          itemId,
          baseAmount,
          coverFee,
        }
      );

      if (!invariantCheck.valid) {
        return new NextResponse(
          `Webhook PaymentIntent validation failed: ${invariantCheck.error}`,
          { status: 400 }
        );
      }

      const name = metadata.contributorName || 'Anonymous Guest';
      const email = metadata.contributorEmail || null;
      const message = metadata.contributorMessage || null;
      const code = metadata.invitationCode || undefined;
      const stripePaymentIntentId = paymentIntent.id;
      const stripeChargeId =
        typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : (paymentIntent.latest_charge as any)?.id || null;
      const transactionTimestamp = paymentIntent.created
        ? new Date(paymentIntent.created * 1000)
        : new Date();

      try {
        const configPromise = Promise.resolve()
          .then(() => getAppConfig())
          .catch(() => undefined);

        const updatedItem = await registryService.contributeToItem(itemId, {
          name,
          email,
          amount: baseAmount,
          code,
          message,
          coverFee,
          stripePaymentIntentId,
          stripeChargeId,
          transactionTimestamp,
        });

        const config = await configPromise;

        await dispatchContributionNotifications({
          itemId,
          updatedItem,
          contribution: {
            name,
            email,
            amount: baseAmount,
            message,
            coverFee,
            stripePaymentIntentId,
            transactionTimestamp,
          },
          config,
          requestUrl: request.url,
        });
      } catch (err: any) {
        // Log error without PII and return 200 to Stripe if already processed or handled gracefully
        logger.error('Error processing webhook payment_intent.succeeded', {
          itemId,
          stripePaymentIntentId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  } else if (parsedEvent.success && event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const stripeChargeId = typeof charge.id === 'string' && charge.id ? charge.id : null;
    const stripePaymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent as any)?.id || null;
    const amountRefundedCents =
      typeof charge.amount_refunded === 'number' && Number.isFinite(charge.amount_refunded)
        ? Math.max(0, charge.amount_refunded)
        : 0;
    const chargeAmountCents =
      typeof charge.amount === 'number' && Number.isFinite(charge.amount) ? charge.amount : 0;
    const forceFullReversal = Boolean(
      charge.refunded || (chargeAmountCents > 0 && amountRefundedCents >= chargeAmountCents)
    );

    if (stripeChargeId || stripePaymentIntentId) {
      try {
        const reconciled = await registryService.reconcileStripeAdjustment({
          stripeChargeId,
          stripePaymentIntentId,
          refundedCents: amountRefundedCents,
          forceFullReversal,
        });

        if (reconciled.matched && reconciled.changed && reconciled.contributor) {
          await dispatchLedgerAdjustmentNotification({
            eventType:
              reconciled.contributor.status === 'REFUNDED' ? 'refund' : 'partial_refund',
            contributor: reconciled.contributor,
            item: reconciled.item,
            refundedAmount: reconciled.refundedAmount,
            requestUrl: request.url,
          });
        }
      } catch (err: unknown) {
        logger.error('Error processing webhook charge.refunded', {
          stripeChargeId,
          stripePaymentIntentId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  } else if (parsedEvent.success && event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    const stripeChargeId =
      typeof dispute.charge === 'string'
        ? dispute.charge
        : (dispute.charge as any)?.id || null;
    const stripePaymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : (dispute.payment_intent as any)?.id || null;
    const disputedCents =
      typeof dispute.amount === 'number' && Number.isFinite(dispute.amount)
        ? Math.max(0, dispute.amount)
        : 0;
    const forceFullReversal = disputedCents <= 0;

    if (stripeChargeId || stripePaymentIntentId) {
      try {
        const reconciled = await registryService.reconcileStripeAdjustment({
          stripeChargeId,
          stripePaymentIntentId,
          refundedCents: disputedCents,
          forceFullReversal,
        });

        if (reconciled.matched && reconciled.changed && reconciled.contributor) {
          await dispatchLedgerAdjustmentNotification({
            eventType: 'dispute',
            contributor: reconciled.contributor,
            item: reconciled.item,
            refundedAmount: reconciled.refundedAmount,
            requestUrl: request.url,
          });
        }
      } catch (err: unknown) {
        logger.error('Error processing webhook charge.dispute.created', {
          stripeChargeId,
          stripePaymentIntentId,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
