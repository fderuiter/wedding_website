import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { subEventService } from '@/features/sub-events/service';
import { ApiError } from '@/utils/ApiError';
import { UpdateSubEventAccessSchema } from '@/features/sub-events/schemas';

export const GET = withApiMiddleware(async () => {
  const matrix = await subEventService.getAccessMatrix();
  return NextResponse.json({
    success: true,
    data: matrix,
  });
});

export const PUT = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const parseResult = UpdateSubEventAccessSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, 'Invalid request body: ' + parseResult.error.issues.map(i => i.message).join(', '));
  }

  const { invitationCodeId, allowedSubEventIds } = parseResult.data;
  const result = await subEventService.updateInvitationSubEventAccess(invitationCodeId, allowedSubEventIds);

  return NextResponse.json({
    success: true,
    data: result,
  });
});

export const POST = PUT;
