import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { thankYouService } from '@/features/registry';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const stream = thankYouService.exportThankYouNotesCsv({ status, search });

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `thank-you-notes-${dateStr}.csv`;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
