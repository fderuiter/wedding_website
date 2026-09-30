import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { sanitizeRegistryItems } from '../lib/masking';
import { translateActiveToLegacy } from '../schemas';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  const items = await registryService.getAllItems({ includeContributors: isAdmin });
  if (!isAdmin) {
    return NextResponse.json(items);
  }
  return NextResponse.json(sanitizeRegistryItems(items));
}, { translateActiveToLegacy });
