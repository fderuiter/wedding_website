import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { sanitizeRegistryItems } from '../lib/masking';
import { translateActiveToLegacy } from '../schemas';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }
  const isAdmin = await isAdminRequest(req);
  const items = await registryService.getAllItems({ includeContributors: isAdmin });
  if (!isAdmin) {
    return NextResponse.json(items);
  }
  return NextResponse.json(sanitizeRegistryItems(items));
}, { translateActiveToLegacy });
