'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/apiClient';
import { isValidStripePublishableKey, type StripeCapability } from '@/lib/stripe.client';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { subscribeGuestSessionChanged } from '@/utils/guestSessionEvents';
import { useGuestSession } from '../context/GuestSessionContext';
import type {
  RegistryGiftAccessTier,
  RegistryShippingAddress,
  ShippingDisclosureTier,
} from '../types';

const REGISTRY_CAPABILITIES_REFRESH_EVENT = 'registry:capabilities-refresh';

export function notifyCapabilitiesRefresh(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REGISTRY_CAPABILITIES_REFRESH_EVENT));
  }
}

interface RegistryCapabilitiesPayload extends StripeCapability {
  giftAccessTier?: RegistryGiftAccessTier;
  shippingDisclosureTier?: ShippingDisclosureTier;
  maxPendingReservations?: number;
  defaultPaymentHandleType?: string | null;
  defaultPaymentHandle?: string | null;
  hasShippingAddress?: boolean;
  shippingAddress?: RegistryShippingAddress | null;
}

interface NormalizedCapabilities extends StripeCapability {
  giftAccessTier: RegistryGiftAccessTier;
  shippingDisclosureTier: ShippingDisclosureTier;
  maxPendingReservations: number;
  defaultPaymentHandleType: string | null;
  defaultPaymentHandle: string | null;
  hasShippingAddress: boolean;
  shippingAddress: RegistryShippingAddress | null;
}

function getClientEnvCapabilityFallback(): NormalizedCapabilities {
  const envKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const allowPlaceholder = process.env.NODE_ENV === 'test';
  const valid = isValidStripePublishableKey(envKey, allowPlaceholder);
  return {
    cardCheckoutEnabled: valid,
    stripePublishableKey: valid && envKey ? envKey.trim() : null,
    giftAccessTier: 'PASSCODE_GUESTS',
    shippingDisclosureTier: 'PASSCODE_GUESTS',
    maxPendingReservations: 5,
    defaultPaymentHandleType: null,
    defaultPaymentHandle: null,
    hasShippingAddress: false,
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
 * site-wide default payment handle fallback, access tiers, and authenticated shipping details.
 */
export function useRegistryCapabilities(
  options: { enabled?: boolean } = {}
): RegistryCapabilitiesState {
  const { enabled = true } = options;
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const { isVerified, invitationCode, hasPasscodeSession } = useGuestSession();
  const [refreshTick, setRefreshTick] = useState(0);
  const [state, setState] = useState<InternalCapabilitiesState>(() => {
    const fallback = getClientEnvCapabilityFallback();
    return {
      ...fallback,
      hasLoaded: process.env.NODE_ENV === 'test',
    };
  });

  useEffect(() => {
    if (!enabled || isDemoMode || typeof window === 'undefined') {
      return;
    }

    const triggerRefresh = () => {
      setRefreshTick((tick) => tick + 1);
    };

    window.addEventListener(REGISTRY_CAPABILITIES_REFRESH_EVENT, triggerRefresh);
    const unsubscribeGuestSession = subscribeGuestSessionChanged(triggerRefresh);

    return () => {
      window.removeEventListener(REGISTRY_CAPABILITIES_REFRESH_EVENT, triggerRefresh);
      unsubscribeGuestSession();
    };
  }, [enabled, isDemoMode]);

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
          const resolvedAddress = res.shippingAddress ?? null;
          resolved = {
            cardCheckoutEnabled: res.cardCheckoutEnabled,
            stripePublishableKey: res.stripePublishableKey ?? null,
            giftAccessTier:
              res.giftAccessTier === 'INVITED_HOUSEHOLDS'
                ? 'INVITED_HOUSEHOLDS'
                : 'PASSCODE_GUESTS',
            shippingDisclosureTier:
              res.shippingDisclosureTier === 'INVITED_HOUSEHOLDS' ||
              res.shippingDisclosureTier === 'POST_CLAIM_ONLY'
                ? res.shippingDisclosureTier
                : 'PASSCODE_GUESTS',
            maxPendingReservations:
              typeof res.maxPendingReservations === 'number' &&
              Number.isFinite(res.maxPendingReservations)
                ? Math.min(100, Math.max(1, Math.trunc(res.maxPendingReservations)))
                : 5,
            defaultPaymentHandleType: res.defaultPaymentHandleType ?? null,
            defaultPaymentHandle: res.defaultPaymentHandle ?? null,
            hasShippingAddress:
              typeof res.hasShippingAddress === 'boolean'
                ? res.hasShippingAddress
                : Boolean(resolvedAddress),
            shippingAddress: resolvedAddress,
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
          prev.giftAccessTier === resolved.giftAccessTier &&
          prev.shippingDisclosureTier === resolved.shippingDisclosureTier &&
          prev.maxPendingReservations === resolved.maxPendingReservations &&
          prev.defaultPaymentHandleType === resolved.defaultPaymentHandleType &&
          prev.defaultPaymentHandle === resolved.defaultPaymentHandle &&
          prev.hasShippingAddress === resolved.hasShippingAddress &&
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
  }, [enabled, isDemoMode, isVerified, invitationCode, hasPasscodeSession, refreshTick]);

  if (enabled && isDemoMode && demo) {
    return {
      cardCheckoutEnabled: true,
      stripePublishableKey: null,
      giftAccessTier: 'PASSCODE_GUESTS',
      shippingDisclosureTier: 'PASSCODE_GUESTS',
      maxPendingReservations: 5,
      defaultPaymentHandleType: 'Venmo',
      defaultPaymentHandle: '@alex-and-taylor',
      hasShippingAddress: Boolean(demo.shippingAddress),
      shippingAddress: demo.shippingAddress,
      isCapabilitiesLoading: false,
    };
  }

  return {
    cardCheckoutEnabled: state.cardCheckoutEnabled,
    stripePublishableKey: state.stripePublishableKey,
    giftAccessTier: state.giftAccessTier,
    shippingDisclosureTier: state.shippingDisclosureTier,
    maxPendingReservations: state.maxPendingReservations,
    defaultPaymentHandleType: state.defaultPaymentHandleType,
    defaultPaymentHandle: state.defaultPaymentHandle,
    hasShippingAddress: state.hasShippingAddress,
    shippingAddress: state.shippingAddress,
    isCapabilitiesLoading: enabled && !state.hasLoaded,
  };
}
