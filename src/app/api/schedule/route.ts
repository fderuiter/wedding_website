import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';
import { evaluateRsvpCutoff } from '@/utils/rsvpDeadline';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);
  const [schedule, plusOneAllocations, savedPlusOneNames, guestEmail, rawRsvpStatus] =
    await Promise.all([
      subEventService.getScheduleForGuest(session?.code),
      session?.code && typeof subEventService.getPlusOneAllowanceForGuest === 'function'
        ? subEventService.getPlusOneAllowanceForGuest(session.code)
        : Promise.resolve(null),
      session?.code && typeof subEventService.getSavedPlusOneNamesForGuest === 'function'
        ? subEventService.getSavedPlusOneNamesForGuest(session.code)
        : Promise.resolve([]),
      session?.code && typeof subEventService.getSavedEmailForGuest === 'function'
        ? subEventService.getSavedEmailForGuest(session.code)
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
    guestEmail: session ? (guestEmail ?? null) : null,
    plusOneAllocations: session ? (plusOneAllocations ?? 0) : null,
    savedPlusOneNames: session ? savedPlusOneNames : [],
    rsvpOpen: rsvpStatus.isOpen,
    rsvpDeadlineDate: rsvpStatus.deadlineDate,
    rsvpFormattedDeadline: rsvpStatus.formattedDeadline,
    timezone: rsvpStatus.timezone,
    rsvpClosedMessage: rsvpStatus.closedMessage,
  });
});
