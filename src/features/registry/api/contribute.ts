import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { ContributionSchema, translateActiveToLegacy } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const data = await request.json();
  const parseResult = ContributionSchema.safeParse(data);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { itemId, name, amount } = parseResult.data;

  const updatedItem = await registryService.contributeToItem(itemId, {
    name,
    amount
  });

  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(maskRegistryItem(updatedItem));
  }
  return NextResponse.json(sanitizeRegistryItem(updatedItem));
}, { translateActiveToLegacy });
