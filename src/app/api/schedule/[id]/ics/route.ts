import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';
import { getAppConfig } from '@/lib/config';
import { formatScheduleEventToCalendarEvent, createIcsFile } from '@/utils/calendar';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) => {
    const resolvedParams = await Promise.resolve(params);
    const id = resolvedParams?.id;

    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new ApiError(404, 'Sub-event ID is required.');
    }

    const session = await getGuestInviteSession(request);
    const event = await subEventService.getSubEventByIdForGuest(id.trim(), session?.code);

    const config = await getAppConfig();
    const timezone = config?.timezone || 'UTC';

    const calendarEvent = formatScheduleEventToCalendarEvent(
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
    );

    const icsContent = createIcsFile(calendarEvent);
    if (!icsContent) {
      throw new ApiError(500, 'Failed to generate calendar event');
    }

    const cleanTitle = (event.title || 'event').replace(/["\r\n\t]/g, '').trim() || 'event';

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${cleanTitle}.ics"`,
      },
    });
  }
);
