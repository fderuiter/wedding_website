import Stripe from 'stripe';
import type { Stripe as StripeClient } from '@stripe/stripe-js';

const PLACEHOLDER_STRIPE_KEYS = new Set([
  'sk_test_placeholder_mock_key',
  'pk_test_placeholder_mock_key',
]);

function isPlaceholderKey(key: string): boolean {
  return PLACEHOLDER_STRIPE_KEYS.has(key) || key.includes('placeholder_mock_key');
}

/**
 * Checks whether a candidate Stripe secret key has a valid prefix and is not a placeholder in non-test runtimes.
 */
export function isValidStripeSecretKey(
  key: string | undefined | null,
  allowTestPlaceholder = false
): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return false;
  if (!trimmed.startsWith('sk_') && !trimmed.startsWith('rk_')) return false;
  if (!allowTestPlaceholder && isPlaceholderKey(trimmed)) return false;
  return true;
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

/**
 * Detects at runtime whether valid Stripe card processing credentials exist.
 * Never exposes STRIPE_SECRET_KEY.
 */
export function getStripeCapability(): StripeCapability {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const allowTestPlaceholder = process.env.NODE_ENV === 'test';
  const hasSecret = isValidStripeSecretKey(secretKey, allowTestPlaceholder);
  const hasPublishable = isValidStripePublishableKey(publishableKey, allowTestPlaceholder);
  const cardCheckoutEnabled = hasSecret && hasPublishable;

  return {
    cardCheckoutEnabled,
    stripePublishableKey: cardCheckoutEnabled && publishableKey ? publishableKey.trim() : null,
  };
}

let stripeInstance: Stripe | null = null;
let cachedSecretKey: string | null = null;

/**
 * Returns a cached server-side Stripe instance when valid credentials exist.
 * Throws in non-test runtimes if Stripe credentials are missing or invalid.
 */
export function getStripeInstance(): Stripe {
  const isTest = process.env.NODE_ENV === 'test';
  const rawSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!isTest) {
    const capability = getStripeCapability();
    if (!capability.cardCheckoutEnabled || !isValidStripeSecretKey(rawSecretKey, false)) {
      throw new Error(
        'Card checkout is not configured on this deployment. Valid STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY credentials are required.'
      );
    }
  }

  const effectiveSecretKey = isValidStripeSecretKey(rawSecretKey, isTest)
    ? rawSecretKey.trim()
    : isTest && rawSecretKey === undefined
      ? 'sk_test_unit_environment_only'
      : null;

  if (!effectiveSecretKey) {
    throw new Error(
      'Card checkout is not configured on this deployment. Valid STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY credentials are required.'
    );
  }

  if (!stripeInstance || cachedSecretKey !== effectiveSecretKey) {
    stripeInstance = new Stripe(effectiveSecretKey, {
      apiVersion: '2025-02-24.acacia' as any,
      typescript: true,
    });
    cachedSecretKey = effectiveSecretKey;
  }

  return stripeInstance;
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
      ? 'pk_test_unit_environment_only'
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
