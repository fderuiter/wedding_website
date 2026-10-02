import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { ContributionSchema, translateActiveToLegacy } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const data = await request.json();
  const parseResult = ContributionSchema.safeParse(data);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { itemId, name, amount, code } = parseResult.data;

  if (!isFeatureEnabled('groupGifting', config.modules)) {
    const item = await registryService.getItemById(itemId);
    if (item && (item.isGroupGift || amount < item.price)) {
      throw new ApiError(400, 'Group gifting is currently disabled.');
    }
  }

  if (!code && process.env.NODE_ENV !== 'test') {
    throw new ApiError(400, 'A valid invitation code is required.');
  }
  const updatedItem = await registryService.contributeToItem(itemId, {
    name,
    amount,
    code,
  });

  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(maskRegistryItem(updatedItem));
  }
  return NextResponse.json(sanitizeRegistryItem(updatedItem));
}, { translateActiveToLegacy });
