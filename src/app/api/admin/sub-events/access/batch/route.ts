import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { subEventService } from '@/features/sub-events/service';
import { ApiError } from '@/utils/ApiError';
import { BatchUpdateSubEventAccessSchema } from '@/features/sub-events/schemas';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const parseResult = BatchUpdateSubEventAccessSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(
      400,
      'Invalid request body: ' + parseResult.error.issues.map((i) => i.message).join(', ')
    );
  }

  const result = await subEventService.batchUpdateSubEventAccess(parseResult.data);

  return NextResponse.json({
    success: true,
    data: result,
  });
});
