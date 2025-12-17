import { createGoogleCalendarLink, createYahooCalendarLink, createIcsFile } from '../calendar';
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

  describe('createIcsFile', () => {
    it('should create a valid ICS file string', () => {
      const icsString = createIcsFile(event);
      expect(icsString).toContain('BEGIN:VCALENDAR');
      expect(icsString).toContain('VERSION:2.0');
      expect(icsString).toContain('BEGIN:VEVENT');
      expect(icsString).toContain(`SUMMARY:${event.name}`);
      expect(icsString).toContain(`DESCRIPTION:${event.description}`);
      expect(icsString).toContain(`LOCATION:${event.location}`);
      expect(icsString).toContain('DTSTART:20251225T100000');
      expect(icsString).toContain('DTEND:20251225T110000');
      expect(icsString).toContain('END:VEVENT');
      expect(icsString).toContain('END:VCALENDAR');
    });

    it('should return an empty string if there is an error', () => {
        const invalidEvent = { ...event, startDate: 'invalid-date' };
        const icsString = createIcsFile(invalidEvent);
        expect(icsString).toBe('');
      });
  });
});
