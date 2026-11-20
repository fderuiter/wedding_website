import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';
import { evaluateRsvpCutoff } from '@/utils/rsvpDeadline';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);
  const [schedule, plusOneAllocations, rawRsvpStatus] = await Promise.all([
    subEventService.getScheduleForGuest(session?.code),
    session?.code && typeof subEventService.getPlusOneAllowanceForGuest === 'function'
      ? subEventService.getPlusOneAllowanceForGuest(session.code)
      : Promise.resolve(null),
    typeof subEventService.getRsvpStatus === 'function'
      ? subEventService.getRsvpStatus()
      : Promise.resolve(undefined),
  ]);
  const rsvpStatus = rawRsvpStatus ?? evaluateRsvpCutoff();

  return NextResponse.json({
    success: true,
    data: schedule,
    isGuest: Boolean(session),
    guestName: session?.guestName || null,
    plusOneAllocations: session ? (plusOneAllocations ?? 0) : null,
    rsvpOpen: rsvpStatus.isOpen,
    rsvpDeadlineDate: rsvpStatus.deadlineDate,
    rsvpFormattedDeadline: rsvpStatus.formattedDeadline,
    timezone: rsvpStatus.timezone,
    rsvpClosedMessage: rsvpStatus.closedMessage,
  });
});
