import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSessionFromRequestOrToken } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';
import { getAppConfig } from '@/lib/config';
import { formatScheduleEventToCalendarEvent, createMultiEventIcsFile } from '@/utils/calendar';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSessionFromRequestOrToken(request);

  if (!session || !session.code) {
    throw new ApiError(
      401,
      'Unauthorized: Please log in with your invitation code or use a valid itinerary link.'
    );
  }

  // Optional `token` query parameter is already verified by getGuestInviteSessionFromRequestOrToken;
  // referencing searchParams.get('token') here also documents the query parameter for OpenAPI generation.
  const _tokenParam = request.nextUrl.searchParams.get('token');
  void _tokenParam;

  const schedule = await subEventService.getScheduleForGuest(session.code);
  const attendingEvents = schedule.filter(
    (event) => !event.isReadOnly && event.userRsvp?.status === 'attending'
  );

  if (attendingEvents.length === 0) {
    throw new ApiError(404, 'No attending events found for your itinerary.');
  }

  const config = await getAppConfig();
  const timezone = config?.timezone || 'UTC';

  const calendarEvents = attendingEvents.map((event) =>
    formatScheduleEventToCalendarEvent(
      {
        id: event.id,
        title: event.title,
        startTime: event.startTime ? String(event.startTime) : undefined,
        endTime: event.endTime ? String(event.endTime) : undefined,
        locationName: event.locationName || undefined,
        location: event.location || undefined,
        attireRules: event.attireRules || undefined,
        description: event.description || undefined,
      },
      undefined,
      timezone
    )
  );

  const icsContent = createMultiEventIcsFile(calendarEvents);
  if (!icsContent) {
    throw new ApiError(500, 'Failed to generate combined calendar itinerary.');
  }

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="wedding-itinerary.ics"',
    },
  });
});
