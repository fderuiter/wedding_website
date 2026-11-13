import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import { SendTestBroadcastSchema } from '@/features/broadcast';
import { BroadcastService } from '@/features/broadcast/service';

export const POST = withApiMiddleware(
  async (req: NextRequest) => {
    const body = await req.json();
    const parseResult = SendTestBroadcastSchema.safeParse(body);

    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    try {
      const result = await BroadcastService.sendTestBroadcast(parseResult.data);
      return NextResponse.json(result);
    } catch (error: any) {
      throw new ApiError(500, error.message || 'Failed to dispatch test broadcast message.');
    }
  },
  { limit: 5, windowMs: 60 * 1000 }
);
