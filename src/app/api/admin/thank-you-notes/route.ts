import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import { CreateOfflineThankYouNoteSchema, thankYouService } from '@/features/registry';

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

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();

  const parseResult = CreateOfflineThankYouNoteSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const created = await thankYouService.createOfflineGift(parseResult.data, 'Admin');
  return NextResponse.json(
    {
      success: true,
      item: created,
    },
    { status: 201 }
  );
});
