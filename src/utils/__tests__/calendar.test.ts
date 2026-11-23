import {
  createGoogleCalendarLink,
  createYahooCalendarLink,
  createOutlookCalendarLink,
  createIcsFile,
  buildVTimezoneBlock,
  formatScheduleEventToCalendarEvent,
} from '../calendar';
import { CalendarEvent } from '@/utils/calendar';

const event: CalendarEvent = {
  name: 'Test Event',
  description: 'This is a test event.',
  location: 'Test Location',
  startDate: '2025-12-25',
  startTime: '10:00',
  endDate: '2025-12-25',
  endTime: '11:00',
  timeZone: 'America/New_York',
};

describe('calendar utils', () => {
  describe('createGoogleCalendarLink', () => {
    it('should create a valid Google Calendar link', () => {
      const link = createGoogleCalendarLink(event);
      const url = new URL(link);
      expect(url.hostname).toBe('calendar.google.com');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      expect(url.searchParams.get('text')).toBe(event.name);
      expect(url.searchParams.get('dates')).toBe('20251225T100000/20251225T110000');
      expect(url.searchParams.get('ctz')).toBe(event.timeZone);
      expect(url.searchParams.get('details')).toBe(event.description);
      expect(url.searchParams.get('location')).toBe(event.location);
    });
  });

  describe('createYahooCalendarLink', () => {
    it('should create a valid Yahoo Calendar link with UTC Z timestamps', () => {
      const link = createYahooCalendarLink(event);
      const url = new URL(link);
      expect(url.hostname).toBe('calendar.yahoo.com');
      expect(url.searchParams.get('v')).toBe('60');
      expect(url.searchParams.get('view')).toBe('d');
      expect(url.searchParams.get('type')).toBe('20');
      expect(url.searchParams.get('title')).toBe(event.name);
      expect(url.searchParams.get('st')).toBe('20251225T150000Z');
      expect(url.searchParams.get('et')).toBe('20251225T160000Z');
      expect(url.searchParams.get('desc')).toBe(event.description);
      expect(url.searchParams.get('in_loc')).toBe(event.location);
    });

    it('adjusts UTC conversion across America/Chicago daylight saving shifts and invalid timezones', () => {
      const summerUrl = new URL(
        createYahooCalendarLink({
          ...event,
          startDate: '2026-06-19',
          startTime: '13:00',
          endDate: '2026-06-19',
          endTime: '16:00',
          timeZone: 'America/Chicago',
        })
      );
      expect(summerUrl.searchParams.get('st')).toBe('20260619T180000Z');
      expect(summerUrl.searchParams.get('et')).toBe('20260619T210000Z');

      const winterUrl = new URL(
        createYahooCalendarLink({
          ...event,
          startDate: '2026-12-19',
          startTime: '12:00',
          endDate: '2026-12-19',
          endTime: '15:00',
          timeZone: 'America/Chicago',
        })
      );
      expect(winterUrl.searchParams.get('st')).toBe('20261219T180000Z');
      expect(winterUrl.searchParams.get('et')).toBe('20261219T210000Z');

      const invalidTzUrl = new URL(
        createYahooCalendarLink({
          ...event,
          timeZone: 'Invalid/Timezone',
        })
      );
      expect(invalidTzUrl.searchParams.get('st')).toBe('20251225T100000Z');
      expect(invalidTzUrl.searchParams.get('et')).toBe('20251225T110000Z');
    });
  });

  describe('createOutlookCalendarLink', () => {
    it('should create a valid Outlook Calendar link with ISO UTC offsets', () => {
      const link = createOutlookCalendarLink(event);
      const url = new URL(link);
      expect(url.hostname).toBe('outlook.live.com');
      expect(url.pathname).toBe('/calendar/0/deeplink/compose');
      expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
      expect(url.searchParams.get('rru')).toBe('addevent');
      expect(url.searchParams.get('subject')).toBe(event.name);
      expect(url.searchParams.get('startdt')).toBe('2025-12-25T10:00:00-05:00');
      expect(url.searchParams.get('enddt')).toBe('2025-12-25T11:00:00-05:00');
      expect(url.searchParams.get('body')).toBe(event.description);
      expect(url.searchParams.get('location')).toBe(event.location);
    });

    it('appends DST-accurate offsets for America/Chicago and +00:00 for invalid timezones', () => {
      const summerUrl = new URL(
        createOutlookCalendarLink({
          ...event,
          startDate: '2026-06-19',
          startTime: '13:00',
          endDate: '2026-06-19',
          endTime: '16:00',
          timeZone: 'America/Chicago',
        })
      );
      expect(summerUrl.searchParams.get('startdt')).toBe('2026-06-19T13:00:00-05:00');
      expect(summerUrl.searchParams.get('enddt')).toBe('2026-06-19T16:00:00-05:00');

      const winterUrl = new URL(
        createOutlookCalendarLink({
          ...event,
          startDate: '2026-12-19',
          startTime: '12:00',
          endDate: '2026-12-19',
          endTime: '15:00',
          timeZone: 'America/Chicago',
        })
      );
      expect(winterUrl.searchParams.get('startdt')).toBe('2026-12-19T12:00:00-06:00');
      expect(winterUrl.searchParams.get('enddt')).toBe('2026-12-19T15:00:00-06:00');

      const invalidTzUrl = new URL(
        createOutlookCalendarLink({
          ...event,
          timeZone: '',
        })
      );
      expect(invalidTzUrl.searchParams.get('startdt')).toBe('2025-12-25T10:00:00+00:00');
      expect(invalidTzUrl.searchParams.get('enddt')).toBe('2025-12-25T11:00:00+00:00');
    });
  });

  describe('buildVTimezoneBlock', () => {
    it('generates standard VTIMEZONE block for America/New_York', () => {
      const vtz = buildVTimezoneBlock('America/New_York');
      expect(vtz).toContain('BEGIN:VTIMEZONE');
      expect(vtz).toContain('TZID:America/New_York');
      expect(vtz).toContain('BEGIN:DAYLIGHT');
      expect(vtz).toContain('TZNAME:EDT');
      expect(vtz).toContain('BEGIN:STANDARD');
      expect(vtz).toContain('TZNAME:EST');
      expect(vtz).toContain('END:VTIMEZONE');
    });

    it('generates standard VTIMEZONE block for UTC', () => {
      const vtz = buildVTimezoneBlock('UTC');
      expect(vtz).toContain('BEGIN:VTIMEZONE');
      expect(vtz).toContain('TZID:UTC');
      expect(vtz).toContain('BEGIN:STANDARD');
      expect(vtz).toContain('TZNAME:UTC');
      expect(vtz).toContain('END:VTIMEZONE');
    });

    it('generates fallback VTIMEZONE block for unrecognized custom timezone', () => {
      const vtz = buildVTimezoneBlock('Custom/Unrecognized_Timezone');
      expect(vtz).toContain('BEGIN:VTIMEZONE');
      expect(vtz).toContain('TZID:Custom/Unrecognized_Timezone');
      expect(vtz).toContain('BEGIN:STANDARD');
      expect(vtz).toContain('TZOFFSETFROM:+0000');
      expect(vtz).toContain('TZOFFSETTO:+0000');
      expect(vtz).toContain('END:VTIMEZONE');
    });

    it('anchors fallback VTIMEZONE offsets to the event date across daylight saving rules', () => {
      const summerVtz = buildVTimezoneBlock('America/Toronto', '2026-07-15', '14:00');
      expect(summerVtz).toContain('TZID:America/Toronto');
      expect(summerVtz).toContain('TZOFFSETFROM:-0400');
      expect(summerVtz).toContain('TZOFFSETTO:-0400');

      const winterVtz = buildVTimezoneBlock('America/Toronto', '2026-01-15', '14:00');
      expect(winterVtz).toContain('TZID:America/Toronto');
      expect(winterVtz).toContain('TZOFFSETFROM:-0500');
      expect(winterVtz).toContain('TZOFFSETTO:-0500');
    });
  });

  describe('createIcsFile', () => {
    it('should create a valid ICS file string with VTIMEZONE block', () => {
      const icsString = createIcsFile(event);
      expect(icsString).toContain('BEGIN:VCALENDAR');
      expect(icsString).toContain('VERSION:2.0');
      expect(icsString).toContain('BEGIN:VTIMEZONE');
      expect(icsString).toContain(`TZID:${event.timeZone}`);
      expect(icsString).toContain('END:VTIMEZONE');
      expect(icsString).toContain('BEGIN:VEVENT');
      expect(icsString).toContain(`SUMMARY:${event.name}`);
      expect(icsString).toContain(`DESCRIPTION:${event.description}`);
      expect(icsString).toContain(`LOCATION:${event.location}`);
      expect(icsString).toContain(`DTSTART;TZID=${event.timeZone}:20251225T100000`);
      expect(icsString).toContain(`DTEND;TZID=${event.timeZone}:20251225T110000`);
      expect(icsString).toContain('END:VEVENT');
      expect(icsString).toContain('END:VCALENDAR');

      // VTIMEZONE block should appear before BEGIN:VEVENT
      const vtimezoneIndex = icsString.indexOf('BEGIN:VTIMEZONE');
      const veventIndex = icsString.indexOf('BEGIN:VEVENT');
      expect(vtimezoneIndex).toBeGreaterThan(-1);
      expect(veventIndex).toBeGreaterThan(vtimezoneIndex);
    });

    it('passes the event date to buildVTimezoneBlock for seasonal fallback offsets', () => {
      const summerIcs = createIcsFile({
        ...event,
        startDate: '2026-07-15',
        startTime: '14:00',
        endDate: '2026-07-15',
        endTime: '15:00',
        timeZone: 'Europe/Berlin',
      });
      expect(summerIcs).toContain('TZOFFSETTO:+0200');

      const winterIcs = createIcsFile({
        ...event,
        startDate: '2026-01-15',
        startTime: '14:00',
        endDate: '2026-01-15',
        endTime: '15:00',
        timeZone: 'Europe/Berlin',
      });
      expect(winterIcs).toContain('TZOFFSETTO:+0100');
    });

    it('should return an empty string if there is an error', () => {
      const invalidEvent = { ...event, startDate: 'invalid-date' };
      const icsString = createIcsFile(invalidEvent);
      expect(icsString).toBe('');
    });
  });

  describe('formatScheduleEventToCalendarEvent', () => {
    it('converts ISO schedule item into CalendarEvent structure with localized wall times and timezone', () => {
      const scheduleItem = {
        id: 'item-123',
        title: 'Rehearsal Dinner',
        startTime: '2026-06-19T18:00:00.000Z',
        endTime: '2026-06-19T21:00:00.000Z',
        locationName: 'The Oak Room',
        attireRules: 'Smart Casual',
        description: 'Dinner for wedding party.',
      };

      const result = formatScheduleEventToCalendarEvent(scheduleItem, '2026-06-19', 'America/Chicago');

      expect(result.id).toBe('item-123');
      expect(result.name).toBe('Rehearsal Dinner');
      expect(result.startDate).toBe('2026-06-19');
      expect(result.startTime).toBe('13:00');
      expect(result.endDate).toBe('2026-06-19');
      expect(result.endTime).toBe('16:00');
      expect(result.timeZone).toBe('America/Chicago');
      expect(result.location).toBe('The Oak Room');
      expect(result.description).toContain('Dinner for wedding party.');
      expect(result.description).toContain('Attire: Smart Casual');
    });

    it('handles America/Chicago winter CST offset and default one-hour endTime', () => {
      const result = formatScheduleEventToCalendarEvent(
        {
          id: 'winter-ceremony',
          title: 'Winter Ceremony',
          startTime: '2026-12-19T18:00:00.000Z',
        },
        undefined,
        'America/Chicago'
      );

      expect(result.startDate).toBe('2026-12-19');
      expect(result.startTime).toBe('12:00');
      expect(result.endDate).toBe('2026-12-19');
      expect(result.endTime).toBe('13:00');
      expect(result.timeZone).toBe('America/Chicago');
    });

    it('preserves local venue date across UTC midnight rollovers and formats local midnight as 00:00', () => {
      const eveningRollover = formatScheduleEventToCalendarEvent(
        {
          id: 'evening-reception',
          title: 'Evening Reception',
          startTime: '2026-09-20T00:00:00.000Z',
          endTime: '2026-09-20T05:00:00.000Z',
        },
        undefined,
        'America/Chicago'
      );

      expect(eveningRollover.startDate).toBe('2026-09-19');
      expect(eveningRollover.startTime).toBe('19:00');
      expect(eveningRollover.endDate).toBe('2026-09-20');
      expect(eveningRollover.endTime).toBe('00:00');
    });

    it('falls back to UTC when timeZone is unrecognized or empty and keeps defaults when startTime is omitted', () => {
      const invalidTzResult = formatScheduleEventToCalendarEvent(
        {
          id: 'fallback-item',
          title: 'Fallback Event',
          startTime: '2026-09-19T16:00:00.000Z',
        },
        undefined,
        'Invalid/Timezone'
      );

      expect(invalidTzResult.startDate).toBe('2026-09-19');
      expect(invalidTzResult.startTime).toBe('16:00');
      expect(invalidTzResult.endDate).toBe('2026-09-19');
      expect(invalidTzResult.endTime).toBe('17:00');
      expect(invalidTzResult.timeZone).toBe('UTC');

      const missingStartResult = formatScheduleEventToCalendarEvent(
        {
          id: 'unscheduled-item',
          title: 'TBD Event',
        },
        '2026-09-19',
        'America/Chicago'
      );

      expect(missingStartResult.startDate).toBe('2026-09-19');
      expect(missingStartResult.startTime).toBe('12:00');
      expect(missingStartResult.endDate).toBe('2026-09-19');
      expect(missingStartResult.endTime).toBe('13:00');
      expect(missingStartResult.timeZone).toBe('America/Chicago');
    });

    it('joins locationName and street location without duplicating overlapping values', () => {
      const bothResult = formatScheduleEventToCalendarEvent(
        {
          id: 'ceremony-item',
          title: 'Ceremony',
          startTime: '2026-09-19T16:00:00.000Z',
          locationName: 'Grace Cathedral',
          location: '1100 California St, San Francisco, CA',
        },
        undefined,
        'America/Los_Angeles'
      );
      expect(bothResult.location).toBe('Grace Cathedral, 1100 California St, San Francisco, CA');

      const streetOnlyResult = formatScheduleEventToCalendarEvent(
        {
          id: 'afterparty-item',
          title: 'Afterparty',
          startTime: '2026-09-19T23:00:00.000Z',
          location: '500 Market St, San Francisco, CA',
        },
        undefined,
        'America/Los_Angeles'
      );
      expect(streetOnlyResult.location).toBe('500 Market St, San Francisco, CA');
    });
  });
});
