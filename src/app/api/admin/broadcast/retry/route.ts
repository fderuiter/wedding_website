import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import { getValidatedCanonicalUrl } from '@/utils/hostValidation';
import { RetryBroadcastSchema, BroadcastService } from '@/features/broadcast';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = RetryBroadcastSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const hostHeader =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  const protoHeader = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const safeLocalFallback =
    req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1'
      ? req.nextUrl.origin
      : undefined;
  const requestOrigin = getValidatedCanonicalUrl(hostHeader, protoHeader, safeLocalFallback);

  try {
    const updatedBroadcast = await BroadcastService.retryFailedRecipients(
      parseResult.data.broadcastId,
      parseResult.data.recipientIds,
      requestOrigin
    );
    return NextResponse.json(updatedBroadcast);
  } catch (error: any) {
    throw new ApiError(500, error.message || 'Failed to retry broadcast dispatch.');
  }
});
