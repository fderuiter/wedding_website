'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { isValidStripePublishableKey, type StripeCapability } from '@/lib/stripe.client';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { DEMO_SHIPPING_ADDRESS } from '@/lib/demo/demoSeed';
import { useGuestSession } from '../context/GuestSessionContext';
import type { RegistryShippingAddress } from '../types';

export const REGISTRY_CAPABILITIES_REFRESH_EVENT = 'registry-capabilities-refresh';

interface RegistryCapabilitiesPayload extends StripeCapability {
  defaultPaymentHandleType?: string | null;
  defaultPaymentHandle?: string | null;
  shippingAddress?: RegistryShippingAddress | null;
}

interface NormalizedCapabilities extends StripeCapability {
  defaultPaymentHandleType: string | null;
  defaultPaymentHandle: string | null;
  shippingAddress: RegistryShippingAddress | null;
}

function getClientEnvCapabilityFallback(): NormalizedCapabilities {
  const envKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const allowPlaceholder = process.env.NODE_ENV === 'test';
  const valid = isValidStripePublishableKey(envKey, allowPlaceholder);
  return {
    cardCheckoutEnabled: valid,
    stripePublishableKey: valid && envKey ? envKey.trim() : null,
    defaultPaymentHandleType: null,
    defaultPaymentHandle: null,
    shippingAddress: null,
  };
}

interface RegistryCapabilitiesState extends NormalizedCapabilities {
  isCapabilitiesLoading: boolean;
}

interface InternalCapabilitiesState extends NormalizedCapabilities {
  hasLoaded: boolean;
}

/**
 * Queries the runtime registry capabilities endpoint without requiring a QueryClientProvider,
 * ensuring pre-built container deployments accurately reflect runtime Stripe configuration,
 * site-wide default payment handle fallback, and authenticated shipping details.
 */
export function useRegistryCapabilities(
  options: { enabled?: boolean } = {}
): RegistryCapabilitiesState {
  const { enabled = true } = options;
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const { isVerified, invitationCode } = useGuestSession();
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [state, setState] = useState<InternalCapabilitiesState>(() => {
    const fallback = getClientEnvCapabilityFallback();
    return {
      ...fallback,
      hasLoaded: process.env.NODE_ENV === 'test',
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleRefresh = () => {
      setRefreshRevision((prev) => prev + 1);
    };
    window.addEventListener(REGISTRY_CAPABILITIES_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(REGISTRY_CAPABILITIES_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  useEffect(() => {
    if (!enabled || isDemoMode) {
      return;
    }

    let active = true;

    const loadCapabilities = async () => {
      const fallback = getClientEnvCapabilityFallback();
      let resolved = fallback;
      try {
        const res = await apiClient.get<RegistryCapabilitiesPayload>('/api/registry/capabilities');
        if (res && typeof res.cardCheckoutEnabled === 'boolean') {
          resolved = {
            cardCheckoutEnabled: res.cardCheckoutEnabled,
            stripePublishableKey: res.stripePublishableKey ?? null,
            defaultPaymentHandleType: res.defaultPaymentHandleType ?? null,
            defaultPaymentHandle: res.defaultPaymentHandle ?? null,
            shippingAddress: res.shippingAddress ?? null,
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
          prev.defaultPaymentHandleType === resolved.defaultPaymentHandleType &&
          prev.defaultPaymentHandle === resolved.defaultPaymentHandle &&
          JSON.stringify(prev.shippingAddress) === JSON.stringify(resolved.shippingAddress) &&
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
  }, [enabled, isDemoMode, isVerified, invitationCode, refreshRevision]);

  if (enabled && isDemoMode) {
    return {
      cardCheckoutEnabled: true,
      stripePublishableKey: null,
      defaultPaymentHandleType: 'Venmo',
      defaultPaymentHandle: '@alex-and-taylor',
      shippingAddress: DEMO_SHIPPING_ADDRESS,
      isCapabilitiesLoading: false,
    };
  }

  return {
    cardCheckoutEnabled: state.cardCheckoutEnabled,
    stripePublishableKey: state.stripePublishableKey,
    defaultPaymentHandleType: state.defaultPaymentHandleType,
    defaultPaymentHandle: state.defaultPaymentHandle,
    shippingAddress: state.shippingAddress,
    isCapabilitiesLoading: enabled && !state.hasLoaded,
  };
}
