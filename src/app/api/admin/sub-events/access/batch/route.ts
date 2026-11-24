import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { subEventService } from '@/features/sub-events';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { BatchUpdateSubEventAccessSchema } from '@/features/sub-events';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await parseJsonRequestBody(request);
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
