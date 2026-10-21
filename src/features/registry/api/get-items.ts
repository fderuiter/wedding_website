import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { isAdminRequest } from '@/core/auth/auth.server';
import { sanitizeRegistryItems } from '../lib/masking';
import { RegistryQuerySchema, type RegistryQueryParams } from '../schemas';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  let searchParams: URLSearchParams;
  if (req && req.nextUrl && req.nextUrl.searchParams) {
    searchParams = req.nextUrl.searchParams;
  } else if (req && req.url) {
    try {
      searchParams = new URL(req.url).searchParams;
    } catch {
      searchParams = new URLSearchParams();
    }
  } else {
    searchParams = new URLSearchParams();
  }

  const rawPage = searchParams.get('page');
  const rawLimit = searchParams.get('limit') || searchParams.get('pageSize');
  const category = searchParams.get('category') || undefined;
  const rawMinPrice = searchParams.get('minPrice');
  const rawMaxPrice = searchParams.get('maxPrice');
  const sortBy = searchParams.get('sortBy') || searchParams.get('sort') || undefined;

  const queryPayload: Record<string, any> = {};
  if (rawPage !== null) queryPayload.page = rawPage;
  if (rawLimit !== null) queryPayload.limit = rawLimit;
  if (category !== undefined) queryPayload.category = category;
  if (rawMinPrice !== null) queryPayload.minPrice = rawMinPrice;
  if (rawMaxPrice !== null) queryPayload.maxPrice = rawMaxPrice;
  if (sortBy !== undefined) queryPayload.sortBy = sortBy;

  const parseResult = RegistryQuerySchema.safeParse(queryPayload);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues.map(i => i.message).join(', ');
    throw new ApiError(400, `Invalid query parameters: ${errorDetails}`);
  }

  const queryParams: RegistryQueryParams = parseResult.data;
  const { page, limit, category: filterCategory, minPrice, maxPrice, sortBy: parsedSortBy } = queryParams;

  const isAdmin = await isAdminRequest(req);
  const result = await registryService.getAllItems({
    page,
    limit,
    category: filterCategory,
    minPrice,
    maxPrice,
    sortBy: parsedSortBy,
    includeContributors: isAdmin,
  });

  if (isAdmin) {
    result.items = sanitizeRegistryItems(result.items);
  }

  return NextResponse.json(result);
});

