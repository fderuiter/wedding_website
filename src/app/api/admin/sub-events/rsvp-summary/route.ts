import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { subEventService } from '@/features/sub-events';

export const GET = withApiMiddleware(async () => {
  const summary = await subEventService.getRsvpSummary();
  return NextResponse.json({
    success: true,
    data: summary,
  });
});
