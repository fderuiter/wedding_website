import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { thankYouService } from '@/features/registry/thank-you.service';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;
  const pageParam = searchParams.get('page');
  const pageSizeParam = searchParams.get('pageSize');

  const options: Parameters<typeof thankYouService.getThankYouNotes>[0] = {};
  if (status) options.status = status;
  if (search) options.search = search;
  if (pageParam) options.page = parseInt(pageParam, 10);
  if (pageSizeParam) options.pageSize = parseInt(pageSizeParam, 10);

  const result = await thankYouService.getThankYouNotes(options);
  return NextResponse.json({
    success: true,
    items: result.items,
    metrics: result.metrics,
    pagination: result.pagination,
  });
});
