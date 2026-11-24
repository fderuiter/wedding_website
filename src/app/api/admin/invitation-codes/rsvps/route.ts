import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { assertJsonContentType } from '@/utils/contentType';
import {
  subEventService,
  AdminInvitationRsvpsQuerySchema,
  AdminUpdateInvitationRsvpsSchema,
} from '@/features/sub-events';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const invitationCodeId = searchParams.get('invitationCodeId') ?? '';

  const parsed = AdminInvitationRsvpsQuerySchema.safeParse({ invitationCodeId });
  if (!parsed.success) {
    throw new ApiError(
      400,
      parsed.error.issues[0]?.message || 'invitationCodeId query parameter is required.'
    );
  }

  const data = await subEventService.getAdminInvitationRsvps(parsed.data.invitationCodeId);
  return NextResponse.json({
    success: true,
    data,
  });
});

export const PUT = withApiMiddleware(async (request: NextRequest) => {
  assertJsonContentType(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON request body.');
  }

  const parsed = AdminUpdateInvitationRsvpsSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new ApiError(400, `Invalid RSVP override payload: ${details}`);
  }

  if ('invitationCodeIds' in parsed.data) {
    const result = await subEventService.adminBatchUpdateAttendance(parsed.data, 'Admin');
    return NextResponse.json({
      success: true,
      data: result,
    });
  }

  const result = await subEventService.adminUpdateInvitationRsvps(parsed.data, 'Admin');
  return NextResponse.json({
    success: true,
    data: result,
  });
});
