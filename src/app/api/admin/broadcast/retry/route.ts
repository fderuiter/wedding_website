import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import { RetryBroadcastSchema } from '@/features/broadcast';
import { BroadcastService } from '@/features/broadcast/service';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = RetryBroadcastSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  try {
    const updatedBroadcast = await BroadcastService.retryFailedRecipients(
      parseResult.data.broadcastId,
      parseResult.data.recipientIds
    );
    return NextResponse.json(updatedBroadcast);
  } catch (error: any) {
    throw new ApiError(500, error.message || 'Failed to retry broadcast dispatch.');
  }
});
