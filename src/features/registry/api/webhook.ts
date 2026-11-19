import { NextResponse, NextRequest } from 'next/server';
import Stripe from 'stripe';
import { registryService } from '../service';
import { getStripeInstance } from '@/lib/stripe';
import { StripeWebhookEventSchema } from '@/utils/validation';

/**
 * Stripe webhook handler for registry contributions.
 * Cryptographically verifies signatures using STRIPE_WEBHOOK_SECRET.
 * Processes payment_intent.succeeded events idempotently.
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
      const baseAmount = parseFloat(metadata.baseAmount || '') || (paymentIntent.amount / 100);
      const name = metadata.contributorName || 'Anonymous Guest';
      const email = metadata.contributorEmail || null;
      const message = metadata.contributorMessage || null;
      const code = metadata.invitationCode || undefined;
      const coverFee = metadata.coverFee === 'true';
      const stripePaymentIntentId = paymentIntent.id;
      const stripeChargeId =
        typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : (paymentIntent.latest_charge as any)?.id || null;
      const transactionTimestamp = paymentIntent.created
        ? new Date(paymentIntent.created * 1000)
        : new Date();

      try {
        await registryService.contributeToItem(itemId, {
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
      } catch (err: any) {
        // Log error but return 200 to Stripe if already processed or handle gracefully
        console.error('Error processing webhook payment_intent.succeeded:', err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
