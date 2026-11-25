import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';
import { getStripeCapability } from '@/lib/stripe';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { registryService } from '../service';
import type { RegistryGiftAccessTier, ShippingDisclosureTier } from '../types';
import { extractShippingAddressFromConfig } from '../utils/paymentUrls';

export const GET = withApiMiddleware(async (request?: NextRequest) => {
  const [config, isAdmin, isPasscodeGuest, guestSession, catalogSummary] = await Promise.all([
    getAppConfig(),
    request ? isAdminRequest(request) : Promise.resolve(false),
    request ? isGuestRequest(request) : Promise.resolve(false),
    request ? getGuestInviteSession(request) : Promise.resolve(null),
    registryService.getActiveCatalogCapabilitiesSummary(),
  ]);

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const capability = getStripeCapability();

  const giftAccessTier: RegistryGiftAccessTier =
    config.registryGiftAccessTier === 'INVITED_HOUSEHOLDS'
      ? 'INVITED_HOUSEHOLDS'
      : 'PASSCODE_GUESTS';

  const shippingDisclosureTier: ShippingDisclosureTier =
    config.shippingDisclosureTier === 'INVITED_HOUSEHOLDS' ||
    config.shippingDisclosureTier === 'POST_CLAIM_ONLY'
      ? config.shippingDisclosureTier
      : 'PASSCODE_GUESTS';

  const maxPendingReservations =
    typeof config.maxPendingReservations === 'number' &&
    Number.isFinite(config.maxPendingReservations)
      ? Math.min(100, Math.max(1, Math.trunc(config.maxPendingReservations)))
      : 5;

  const defaultPaymentHandle = config.defaultPaymentHandle?.trim() || '';
  const defaultPaymentHandleType = config.defaultPaymentHandleType?.trim() || '';

  const { shippingCandidate, hasShippingAddress } = extractShippingAddressFromConfig(config);

  const hasInviteSession = Boolean(guestSession?.code);
  const hasAuthenticatedGuestSession = hasInviteSession || isPasscodeGuest;

  const canViewShippingByTier =
    shippingDisclosureTier === 'POST_CLAIM_ONLY'
      ? false
      : shippingDisclosureTier === 'INVITED_HOUSEHOLDS'
        ? hasInviteSession
        : hasAuthenticatedGuestSession;

  const canViewShippingAddress =
    hasShippingAddress &&
    (isAdmin || (canViewShippingByTier && catalogSummary.hasActivePhysicalItems));

  const canUseGiftAccessByTier =
    giftAccessTier === 'INVITED_HOUSEHOLDS'
      ? hasInviteSession
      : hasAuthenticatedGuestSession;

  const canViewDefaultPaymentHandle =
    Boolean(defaultPaymentHandle) &&
    (isAdmin || (canUseGiftAccessByTier && catalogSummary.hasActiveFundsOrGroupGifts));

  return NextResponse.json({
    success: true,
    data: {
      ...capability,
      giftAccessTier,
      shippingDisclosureTier,
      maxPendingReservations,
      hasShippingAddress,
      ...(canViewDefaultPaymentHandle
        ? {
          defaultPaymentHandle,
          defaultPaymentHandleType: defaultPaymentHandleType || null,
        }
        : {}),
      ...(canViewShippingAddress ? { shippingAddress: shippingCandidate } : {}),
    },
  });
});
