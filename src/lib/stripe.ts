import Stripe from 'stripe';
import { loadStripe, Stripe as StripeClient } from '@stripe/stripe-js';

let stripeInstance: Stripe | null = null;

/**
 * Returns a singleton server-side Stripe instance.
 */
export function getStripeInstance(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_mock_key';
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as any,
      typescript: true,
    });
  }
  return stripeInstance;
}

let stripePromise: Promise<StripeClient | null> | null = null;

/**
 * Returns a cached Stripe.js promise for client-side Stripe Elements.
 */
export function getStripePromise(): Promise<StripeClient | null> {
  if (!stripePromise) {
    const publishableKey =
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      process.env.STRIPE_PUBLISHABLE_KEY ||
      'pk_test_placeholder_mock_key';
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

/**
 * Standard processing fee rate for card checkout (2.5%).
 */
export const CARD_PROCESSING_FEE_RATE = 0.025;

/**
 * Computes the fee and total charge based on contribution amount and whether the contributor opted to cover fees.
 */
export function calculateContributionAmounts(baseAmount: number, coverFee: boolean) {
  const safeBase = Math.max(0, baseAmount);
  const estimatedFee = Math.round(safeBase * CARD_PROCESSING_FEE_RATE * 100) / 100;
  const feeAmount = coverFee ? estimatedFee : 0;
  const totalChargeAmount = coverFee
    ? Math.round((safeBase + estimatedFee) * 100) / 100
    : safeBase;
  const totalChargeCents = Math.round(totalChargeAmount * 100);
  const netPayout = coverFee
    ? safeBase
    : Math.max(0, Math.round((safeBase - estimatedFee) * 100) / 100);

  return {
    baseAmount: safeBase,
    estimatedFee,
    feeAmount,
    totalChargeAmount,
    totalChargeCents,
    netPayout,
  };
}
