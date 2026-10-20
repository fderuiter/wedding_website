import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';
import { ApiError } from '@/utils/ApiError';
import { SubEventRsvpBatchSubmissionSchema, SubEventRsvpSubmissionItemSchema } from '@/features/sub-events/schemas';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);

  if (!session || !session.code) {
    throw new ApiError(401, 'Unauthorized: Please log in with your invitation code to submit RSVPs.');
  }

  const body = await request.json();

  let submissions = [];

  if (body && Array.isArray(body.rsvps)) {
    const parseResult = SubEventRsvpBatchSubmissionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid RSVP submission format: ' + parseResult.error.issues.map(i => i.message).join(', '));
    }
    submissions = parseResult.data.rsvps;
  } else if (body && body.subEventId) {
    const parseResult = SubEventRsvpSubmissionItemSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid RSVP submission format: ' + parseResult.error.issues.map(i => i.message).join(', '));
    }
    submissions = [parseResult.data];
  } else {
    throw new ApiError(400, 'Invalid RSVP payload format. Expected { subEventId, status } or { rsvps: [...] }.');
  }

  const updatedRsvps = await subEventService.submitSubEventRsvps(session.code, submissions);

  return NextResponse.json({
    success: true,
    data: updatedRsvps,
  });
});
