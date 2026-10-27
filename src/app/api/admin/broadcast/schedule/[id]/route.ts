import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BroadcastService } from '@/features/broadcast/service';

export const DELETE = withApiMiddleware(async (_req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;

  if (!id) {
    throw new ApiError(400, 'Broadcast ID is required.');
  }

  try {
    const cancelled = await BroadcastService.cancelScheduledBroadcast(id);
    return NextResponse.json(cancelled);
  } catch (error: any) {
    throw new ApiError(400, error.message || 'Failed to cancel scheduled broadcast.');
  }
});
