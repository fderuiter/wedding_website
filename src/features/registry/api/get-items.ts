import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { maskRegistryItems, sanitizeRegistryItems } from '../lib/masking';
import { translateActiveToLegacy } from '../schemas';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const items = await registryService.getAllItems();
  const isAdmin = await isAdminRequest(req);
  if (!isAdmin) {
    return NextResponse.json(maskRegistryItems(items));
  }
  return NextResponse.json(sanitizeRegistryItems(items));
}, { translateActiveToLegacy });
