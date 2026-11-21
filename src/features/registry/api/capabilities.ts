import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';
import { getStripeCapability } from '@/lib/stripe';

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
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

  return NextResponse.json({
    success: true,
    data: {
      ...capability,
      ...(defaultPaymentHandle
        ? {
          defaultPaymentHandle,
          defaultPaymentHandleType: defaultPaymentHandleType || null,
        }
        : {}),
      ...(hasShippingAddress ? { shippingAddress: shippingCandidate } : {}),
    },
  });
});
