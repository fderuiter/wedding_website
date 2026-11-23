import Stripe from 'stripe';
import {
  calculateContributionAmounts,
  getStripePromise,
  isValidStripePublishableKey,
  type StripeCapability,
} from './stripe.client';

function isPlaceholderKey(key: string): boolean {
  return (
    ((key.startsWith('sk_') || key.startsWith('rk_')) &&
      key.slice(3) === 'test_placeholder_mock_key') ||
    key.includes('placeholder_mock_key')
  );
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

export {
  isValidStripePublishableKey,
  getStripePromise,
  calculateContributionAmounts,
};

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
      ? ['sk', process.env.NODE_ENV, 'unit_environment_only'].join('_')
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

/**
 * Validates that a Stripe PaymentIntent satisfies all settlement invariants for a registry contribution:
 * succeeded status, USD currency, matching itemId and coverFee metadata, and exact cent charge.
 */
export function validatePaymentIntentInvariants(
  paymentIntent: {
    status?: string | null;
    currency?: string | null;
    amount?: number | null;
    amount_received?: number | null;
    metadata?: Record<string, string | undefined> | null;
  },
  expected: {
    itemId: string;
    baseAmount: number;
    coverFee: boolean;
  }
): { valid: boolean; error?: string; totalChargeCents: number } {
  const { totalChargeCents } = calculateContributionAmounts(
    expected.baseAmount,
    expected.coverFee
  );

  if (!paymentIntent || paymentIntent.status !== 'succeeded') {
    return {
      valid: false,
      totalChargeCents,
      error: `PaymentIntent status is '${paymentIntent?.status ?? 'unknown'}'. Payment must be succeeded before recording contribution.`,
    };
  }

  if (paymentIntent.currency !== 'usd') {
    return {
      valid: false,
      totalChargeCents,
      error: `PaymentIntent currency '${paymentIntent.currency ?? 'unknown'}' does not match expected currency 'usd'.`,
    };
  }

  const metadata = paymentIntent.metadata ?? {};
  if (!metadata.itemId || metadata.itemId !== expected.itemId) {
    return {
      valid: false,
      totalChargeCents,
      error: 'PaymentIntent metadata itemId does not match the target registry item.',
    };
  }

  const normalizedMetaCoverFee =
    metadata.coverFee === undefined || metadata.coverFee === ''
      ? 'false'
      : metadata.coverFee;
  const expectedMetaCoverFee = expected.coverFee ? 'true' : 'false';
  if (normalizedMetaCoverFee !== expectedMetaCoverFee) {
    return {
      valid: false,
      totalChargeCents,
      error: 'PaymentIntent metadata coverFee does not match the contribution request.',
    };
  }

  if (metadata.baseAmount !== undefined && metadata.baseAmount !== '') {
    const parsedMetaBase = Number(metadata.baseAmount);
    if (
      !Number.isFinite(parsedMetaBase) ||
      parsedMetaBase <= 0 ||
      Math.round(parsedMetaBase * 100) !== Math.round(expected.baseAmount * 100)
    ) {
      return {
        valid: false,
        totalChargeCents,
        error: 'PaymentIntent metadata baseAmount does not match the contribution amount.',
      };
    }
  }

  if (typeof paymentIntent.amount !== 'number' || paymentIntent.amount !== totalChargeCents) {
    return {
      valid: false,
      totalChargeCents,
      error: `PaymentIntent amount (${paymentIntent.amount ?? 'unknown'} cents) does not match expected charge (${totalChargeCents} cents).`,
    };
  }

  const amountReceived = paymentIntent.amount_received ?? paymentIntent.amount;
  if (typeof amountReceived !== 'number' || amountReceived < totalChargeCents) {
    return {
      valid: false,
      totalChargeCents,
      error: `PaymentIntent amount_received (${amountReceived} cents) is less than expected charge (${totalChargeCents} cents).`,
    };
  }

  return {
    valid: true,
    totalChargeCents,
  };
}
