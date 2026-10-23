import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import { SendBroadcastSchema } from '@/features/broadcast';
import { BroadcastService } from '@/features/broadcast/service';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = SendBroadcastSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  try {
    const broadcast = await BroadcastService.sendBroadcast(parseResult.data);
    return NextResponse.json(broadcast);
  } catch (error: any) {
    throw new ApiError(500, error.message || 'Failed to dispatch broadcast message.');
  }
});
