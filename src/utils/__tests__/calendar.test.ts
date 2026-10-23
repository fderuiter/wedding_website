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
    it('should create a valid Yahoo Calendar link', () => {
      const link = createYahooCalendarLink(event);
      const url = new URL(link);
      expect(url.hostname).toBe('calendar.yahoo.com');
      expect(url.searchParams.get('v')).toBe('60');
      expect(url.searchParams.get('view')).toBe('d');
      expect(url.searchParams.get('type')).toBe('20');
      expect(url.searchParams.get('title')).toBe(event.name);
      expect(url.searchParams.get('st')).toBe('20251225T100000');
      expect(url.searchParams.get('et')).toBe('20251225T110000');
      expect(url.searchParams.get('desc')).toBe(event.description);
      expect(url.searchParams.get('in_loc')).toBe(event.location);
    });
  });

  describe('createOutlookCalendarLink', () => {
    it('should create a valid Outlook Calendar link', () => {
      const link = createOutlookCalendarLink(event);
      const url = new URL(link);
      expect(url.hostname).toBe('outlook.live.com');
      expect(url.pathname).toBe('/calendar/0/deeplink/compose');
      expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
      expect(url.searchParams.get('rru')).toBe('addevent');
      expect(url.searchParams.get('subject')).toBe(event.name);
      expect(url.searchParams.get('startdt')).toBe('2025-12-25T10:00:00');
      expect(url.searchParams.get('enddt')).toBe('2025-12-25T11:00:00');
      expect(url.searchParams.get('body')).toBe(event.description);
      expect(url.searchParams.get('location')).toBe(event.location);
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

    it('should return an empty string if there is an error', () => {
      const invalidEvent = { ...event, startDate: 'invalid-date' };
      const icsString = createIcsFile(invalidEvent);
      expect(icsString).toBe('');
    });
  });

  describe('formatScheduleEventToCalendarEvent', () => {
    it('converts ISO schedule item into CalendarEvent structure with exact start/end times and timezone', () => {
      const scheduleItem = {
        title: 'Rehearsal Dinner',
        startTime: '2026-06-19T18:00:00.000Z',
        endTime: '2026-06-19T21:00:00.000Z',
        locationName: 'The Oak Room',
        attireRules: 'Smart Casual',
        description: 'Dinner for wedding party.',
      };

      const result = formatScheduleEventToCalendarEvent(scheduleItem, '2026-06-19', 'America/Chicago');

      expect(result.name).toBe('Rehearsal Dinner');
      expect(result.startDate).toBe('2026-06-19');
      expect(result.startTime).toBe('18:00');
      expect(result.endDate).toBe('2026-06-19');
      expect(result.endTime).toBe('21:00');
      expect(result.timeZone).toBe('America/Chicago');
      expect(result.location).toBe('The Oak Room');
      expect(result.description).toContain('Dinner for wedding party.');
      expect(result.description).toContain('Attire: Smart Casual');
    });
  });
});
