import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import {
  subEventService,
  dispatchRsvpNotifications,
  SubEventRsvpBatchSubmissionSchema,
  SubEventRsvpSubmissionItemSchema,
  type SubEventRsvpSubmissionItem,
} from '@/features/sub-events';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);

  if (!session || !session.code) {
    throw new ApiError(401, 'Unauthorized: Please log in with your invitation code to submit RSVPs.');
  }

  const rsvpStatus =
    typeof subEventService.getRsvpStatus === 'function'
      ? await subEventService.getRsvpStatus()
      : undefined;
  if (rsvpStatus && !rsvpStatus.isOpen) {
    throw new ApiError(403, rsvpStatus.closedMessage);
  }

  const body = await request.json();

  let submissions: SubEventRsvpSubmissionItem[] = [];
  let submittedEmail: string | null | undefined;

  if (body && Array.isArray(body.rsvps)) {
    const parseResult = SubEventRsvpBatchSubmissionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid RSVP submission format: ' + parseResult.error.issues.map(i => i.message).join(', '));
    }
    submittedEmail = parseResult.data.email;
    submissions = parseResult.data.rsvps.map(({ email: itemEmail, ...rest }) => {
      if (submittedEmail === undefined && itemEmail !== undefined) {
        submittedEmail = itemEmail;
      }
      return rest;
    });
  } else if (body && body.subEventId) {
    const parseResult = SubEventRsvpSubmissionItemSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid RSVP submission format: ' + parseResult.error.issues.map(i => i.message).join(', '));
    }
    const { email: itemEmail, ...rest } = parseResult.data;
    submittedEmail = itemEmail;
    submissions = [rest];
  } else {
    throw new ApiError(400, 'Invalid RSVP payload format. Expected { subEventId, status } or { rsvps: [...] }.');
  }

  const updatedRsvps =
    submittedEmail === undefined
      ? await subEventService.submitSubEventRsvps(session.code, submissions)
      : await subEventService.submitSubEventRsvps(session.code, submissions, undefined, {
        email: submittedEmail,
      });

  const hasRsvpChanges =
    typeof subEventService.didSubmissionChangeRsvps === 'function'
      ? subEventService.didSubmissionChangeRsvps(updatedRsvps)
      : true;

  await dispatchRsvpNotifications({
    code: session.code,
    guestName: session.guestName,
    submittedEmail,
    submissions,
    updatedRsvps: Array.isArray(updatedRsvps) ? updatedRsvps : [],
    hasRsvpChanges,
    requestUrl: request.url,
  });

  return NextResponse.json({
    success: true,
    data: updatedRsvps,
  });
});
