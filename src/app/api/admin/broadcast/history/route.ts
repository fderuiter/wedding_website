import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BroadcastService } from '@/features/broadcast';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url, 'http://localhost');

  let limit = 50;
  if (searchParams.has('limit')) {
    const rawLimit = searchParams.get('limit');
    if (rawLimit === null || rawLimit.trim() === '' || !/^-?\d+$/.test(rawLimit.trim())) {
      throw new ApiError(400, 'Invalid limit parameter');
    }
    const parsedLimit = parseInt(rawLimit.trim(), 10);
    if (parsedLimit <= 0) {
      throw new ApiError(400, 'Invalid limit parameter');
    }
    limit = Math.min(parsedLimit, 100);
  }

  let page = 1;
  if (searchParams.has('page')) {
    const rawPage = searchParams.get('page');
    if (rawPage === null || rawPage.trim() === '' || !/^-?\d+$/.test(rawPage.trim())) {
      throw new ApiError(400, 'Invalid page parameter');
    }
    const parsedPage = parseInt(rawPage.trim(), 10);
    if (parsedPage < 1) {
      throw new ApiError(400, 'Invalid page parameter');
    }
    page = parsedPage;
  }

  try {
    const [history, rawTotal] = await Promise.all([
      BroadcastService.getBroadcastHistory({ page, limit }),
      typeof BroadcastService.countBroadcastHistory === 'function'
        ? BroadcastService.countBroadcastHistory()
        : Promise.resolve(undefined),
    ]);

    const total = typeof rawTotal === 'number' ? rawTotal : history.length;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    const responseHeaders: Record<string, string> = {
      'X-Total-Count': String(total),
      'X-Page': String(page),
      'X-Limit': String(limit),
      'X-Total-Pages': String(totalPages),
      'X-Per-Page': String(limit),
      'X-Current-Page': String(page),
      'X-Has-Next-Page': String(page < totalPages),
      'X-Has-Prev-Page': String(page > 1),
      'Access-Control-Expose-Headers':
        'X-Total-Count, X-Page, X-Limit, X-Total-Pages, X-Per-Page, X-Current-Page, X-Has-Next-Page, X-Has-Prev-Page, X-Next-Cursor',
    };

    if (history.length > 0 && (history.length === limit || page < totalPages)) {
      if (history[history.length - 1]?.id) {
        responseHeaders['X-Next-Cursor'] = history[history.length - 1].id;
      }
    }

    return NextResponse.json(history, { headers: responseHeaders });
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to fetch broadcast history.';
    throw new ApiError(500, message);
  }
});
