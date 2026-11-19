'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { isValidStripePublishableKey, type StripeCapability } from '@/lib/stripe';

function getClientEnvCapabilityFallback(): StripeCapability {
  const envKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const allowPlaceholder = process.env.NODE_ENV === 'test';
  const valid = isValidStripePublishableKey(envKey, allowPlaceholder);
  return {
    cardCheckoutEnabled: valid,
    stripePublishableKey: valid && envKey ? envKey.trim() : null,
  };
}

interface RegistryCapabilitiesState extends StripeCapability {
  isCapabilitiesLoading: boolean;
}

interface InternalCapabilitiesState extends StripeCapability {
  hasLoaded: boolean;
}

/**
 * Queries the runtime registry capabilities endpoint without requiring a QueryClientProvider,
 * ensuring pre-built container deployments accurately reflect runtime Stripe configuration.
 */
export function useRegistryCapabilities(
  options: { enabled?: boolean } = {}
): RegistryCapabilitiesState {
  const { enabled = true } = options;
  const [state, setState] = useState<InternalCapabilitiesState>(() => {
    const fallback = getClientEnvCapabilityFallback();
    return {
      ...fallback,
      hasLoaded: process.env.NODE_ENV === 'test',
    };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;

    const loadCapabilities = async () => {
      const fallback = getClientEnvCapabilityFallback();
      let resolved = fallback;
      try {
        const res = await apiClient.get<StripeCapability>('/api/registry/capabilities');
        if (res && typeof res.cardCheckoutEnabled === 'boolean') {
          resolved = {
            cardCheckoutEnabled: res.cardCheckoutEnabled,
            stripePublishableKey: res.stripePublishableKey ?? null,
          };
        }
      } catch {
        resolved = fallback;
      }

      if (!active) return;
      setState((prev) => {
        if (
          prev.cardCheckoutEnabled === resolved.cardCheckoutEnabled &&
          prev.stripePublishableKey === resolved.stripePublishableKey &&
          prev.hasLoaded === true
        ) {
          return prev;
        }
        return {
          ...resolved,
          hasLoaded: true,
        };
      });
    };

    void loadCapabilities();

    return () => {
      active = false;
    };
  }, [enabled]);

  return {
    cardCheckoutEnabled: state.cardCheckoutEnabled,
    stripePublishableKey: state.stripePublishableKey,
    isCapabilitiesLoading: enabled && !state.hasLoaded,
  };
}
