import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BroadcastService } from '@/features/broadcast';
import { timingSafeEqualJS } from '@/utils/crypto';

async function handleCron(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = req.headers.get('authorization');

  if (cronSecret) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Unauthorized: Invalid Bearer token');
    }
    const token = authHeader.slice(7).trim();
    const encoder = new TextEncoder();
    const isMatch = timingSafeEqualJS(encoder.encode(token), encoder.encode(cronSecret));
    if (!isMatch) {
      throw new ApiError(401, 'Unauthorized: Invalid Bearer token');
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(500, 'CRON_SECRET is not configured');
    }
    if (!authHeader || !authHeader.startsWith('Bearer ') || !authHeader.slice(7).trim()) {
      throw new ApiError(401, 'Unauthorized: Authorization header missing');
    }
  }

  try {
    const results = await BroadcastService.processScheduledBroadcasts();
    return NextResponse.json({
      success: true,
      processedCount: results.length,
      processedBroadcasts: results,
    });
  } catch (error: any) {
    throw new ApiError(500, error.message || 'Failed to process scheduled broadcasts.');
  }
}

export const GET = withApiMiddleware(handleCron);
export const POST = withApiMiddleware(handleCron);
