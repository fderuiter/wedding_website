import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';
import { getStripeCapability } from '@/lib/stripe';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { registryService } from '../service';

export const GET = withApiMiddleware(async (request?: NextRequest) => {
  const [config, isAdmin, guestSession, catalogSummary] = await Promise.all([
    getAppConfig(),
    request ? isAdminRequest(request) : Promise.resolve(false),
    request ? getGuestInviteSession(request) : Promise.resolve(null),
    registryService.getActiveCatalogCapabilitiesSummary(),
  ]);

  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const capability = getStripeCapability();

  const defaultPaymentHandle = config.defaultPaymentHandle?.trim() || '';
  const defaultPaymentHandleType = config.defaultPaymentHandleType?.trim() || '';

  const shippingCandidate = {
    recipientName: config.shippingRecipientName?.trim() || '',
    addressLine1: config.shippingAddressLine1?.trim() || '',
    addressLine2: config.shippingAddressLine2?.trim() || '',
    city: config.shippingCity?.trim() || '',
    state: config.shippingState?.trim() || '',
    zip: config.shippingZip?.trim() || '',
    country: config.shippingCountry?.trim() || '',
    phone: config.shippingPhone?.trim() || '',
    deliveryNotes: config.shippingDeliveryNotes?.trim() || '',
  };

  const hasShippingAddress = Boolean(
    shippingCandidate.recipientName ||
      shippingCandidate.addressLine1 ||
      shippingCandidate.city ||
      shippingCandidate.state ||
      shippingCandidate.zip ||
      shippingCandidate.country
  );

  const canViewShippingAddress =
    hasShippingAddress &&
    (isAdmin || Boolean(guestSession?.code)) &&
    catalogSummary.hasActivePhysicalItems;

  const canViewDefaultPaymentHandle =
    Boolean(defaultPaymentHandle) && catalogSummary.hasActiveFundsOrGroupGifts;

  return NextResponse.json({
    success: true,
    data: {
      ...capability,
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
