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

  return NextResponse.json({
    success: true,
    data: capability,
  });
});
