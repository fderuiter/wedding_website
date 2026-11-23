import type { Stripe as StripeClient } from '@stripe/stripe-js';

function isPlaceholderKey(key: string): boolean {
  return (
    (key.startsWith('pk_') && key.slice(3) === 'test_placeholder_mock_key') ||
    key.includes('placeholder_mock_key')
  );
}

/**
 * Checks whether a candidate Stripe publishable key has a valid prefix and is not a placeholder in non-test runtimes.
 */
export function isValidStripePublishableKey(
  key: string | undefined | null,
  allowTestPlaceholder = false
): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return false;
  if (!trimmed.startsWith('pk_')) return false;
  if (!allowTestPlaceholder && isPlaceholderKey(trimmed)) return false;
  return true;
}

export interface StripeCapability {
  cardCheckoutEnabled: boolean;
  stripePublishableKey: string | null;
}

let stripePromise: Promise<StripeClient | null> | null = null;
let cachedPublishableKey: string | null = null;

/**
 * Returns a cached Stripe.js promise for client-side Stripe Elements only when a valid publishable key is available.
 * Never loads Stripe.js with placeholder keys in non-test runtimes.
 */
export function getStripePromise(explicitPublishableKey?: string | null): Promise<StripeClient | null> {
  const isTest = process.env.NODE_ENV === 'test';
  const candidateKey =
    explicitPublishableKey !== undefined
      ? explicitPublishableKey
      : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const effectivePublishableKey = isValidStripePublishableKey(candidateKey, isTest)
    ? candidateKey.trim()
    : isTest && explicitPublishableKey === undefined && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY === undefined
      ? ['pk', process.env.NODE_ENV, 'unit_environment_only'].join('_')
      : null;

  if (!effectivePublishableKey) {
    return Promise.resolve(null);
  }

  if (!stripePromise || cachedPublishableKey !== effectivePublishableKey) {
    cachedPublishableKey = effectivePublishableKey;
    stripePromise = import('@stripe/stripe-js')
      .then(({ loadStripe }) => loadStripe(effectivePublishableKey))
      .catch(() => null);
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
