import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { thankYouService } from '@/features/registry/thank-you.service';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const result = await thankYouService.getThankYouNotes({ status, search });
  return NextResponse.json({
    success: true,
    items: result.items,
    metrics: result.metrics,
  });
});
