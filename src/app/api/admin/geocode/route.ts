import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AdminGeocodeQuerySchema, formatZodError } from '@/utils/validation';
import { geocodeSearch } from '@/lib/geocoding';

export const GET = withApiMiddleware(
  async (req: NextRequest) => {
    const url = new URL(req.url);
    const q = url.searchParams.get('q');
    const limit = url.searchParams.get('limit');

    if (!q) {
      throw new ApiError(400, 'Search query is required.');
    }

    const parsed = AdminGeocodeQuerySchema.safeParse({
      q,
      ...(limit !== null ? { limit } : {}),
    });

    if (!parsed.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parsed.error)}`);
    }

    const candidates = await geocodeSearch(parsed.data.q, parsed.data.limit);
    return NextResponse.json(candidates);
  },
  {
    limit: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'admin-geocode',
  }
);
