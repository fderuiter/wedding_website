import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { thankYouService } from '@/features/registry';
import type { LabelTemplate } from '@/utils/pdfLabelGenerator';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;
  const rawTemplate = searchParams.get('template') || 'avery_5160';

  const template: LabelTemplate = rawTemplate === 'avery_5163' ? 'avery_5163' : 'avery_5160';

  const stream = thankYouService.exportThankYouNotesPdf({
    status,
    search,
    template,
  });

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `thank-you-labels-${template}-${dateStr}.pdf`;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
