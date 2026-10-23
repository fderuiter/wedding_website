import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BroadcastService } from '@/features/broadcast/service';

export const GET = withApiMiddleware(async (_req: NextRequest) => {
  try {
    const history = await BroadcastService.getBroadcastHistory();
    return NextResponse.json(history);
  } catch (error: any) {
    throw new ApiError(500, error.message || 'Failed to fetch broadcast history.');
  }
});
