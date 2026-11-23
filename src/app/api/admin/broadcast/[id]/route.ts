import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BroadcastService } from '@/features/broadcast';

export const GET = withApiMiddleware(
  async (_req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;

    if (!id || !id.trim()) {
      throw new ApiError(400, 'Broadcast ID is required.');
    }

    let broadcast;
    try {
      broadcast = await BroadcastService.getBroadcastById(id.trim());
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to fetch broadcast details.';
      throw new ApiError(500, message);
    }

    if (!broadcast) {
      throw new ApiError(404, 'Broadcast message not found.');
    }

    return NextResponse.json(broadcast);
  }
);
