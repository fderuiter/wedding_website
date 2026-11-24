import {
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  isEndTimeBeforeStartTime,
  formatSubEventSchedule,
  formatFriendlyTimezone,
  isValidIanaTimeZone,
} from '../dateTime';

describe('dateTime utilities', () => {
  describe('toDateTimeLocalValue & fromDateTimeLocalValue', () => {
    it('returns empty string for null, undefined, or invalid values', () => {
      expect(toDateTimeLocalValue(null)).toBe('');
      expect(toDateTimeLocalValue(undefined)).toBe('');
      expect(toDateTimeLocalValue('not-a-date')).toBe('');
    });

    it('preserves already formatted datetime-local strings', () => {
      expect(toDateTimeLocalValue('2026-06-19T18:30')).toBe('2026-06-19T18:30');
    });

    it('round-trips datetime-local values through ISO string without drift', () => {
      const localVal = '2026-06-19T18:30';
      const iso = fromDateTimeLocalValue(localVal);
      expect(iso).toBeTruthy();
      expect(toDateTimeLocalValue(iso)).toBe(localVal);
    });

    it('returns null from fromDateTimeLocalValue when empty or invalid', () => {
      expect(fromDateTimeLocalValue('')).toBeNull();
      expect(fromDateTimeLocalValue('   ')).toBeNull();
      expect(fromDateTimeLocalValue(null)).toBeNull();
      expect(fromDateTimeLocalValue('invalid')).toBeNull();
    });
  });

  describe('isEndTimeBeforeStartTime', () => {
    it('returns false when either startTime or endTime is missing', () => {
      expect(isEndTimeBeforeStartTime(null, '2026-06-19T20:00')).toBe(false);
      expect(isEndTimeBeforeStartTime('2026-06-19T18:00', null)).toBe(false);
      expect(isEndTimeBeforeStartTime('', '')).toBe(false);
    });

    it('returns false when endTime equals or follows startTime', () => {
      expect(isEndTimeBeforeStartTime('2026-06-19T18:00', '2026-06-19T18:00')).toBe(false);
      expect(isEndTimeBeforeStartTime('2026-06-19T18:00', '2026-06-19T21:00')).toBe(false);
    });

    it('returns true when endTime precedes startTime', () => {
      expect(isEndTimeBeforeStartTime('2026-06-19T21:00', '2026-06-19T18:00')).toBe(true);
    });
  });

  describe('formatSubEventSchedule', () => {
    it('returns null when both times are empty or invalid', () => {
      expect(formatSubEventSchedule(null, null)).toBeNull();
      expect(formatSubEventSchedule('invalid', '')).toBeNull();
    });

    it('formats same-day start and end times concisely', () => {
      const formatted = formatSubEventSchedule('2026-06-19T18:00', '2026-06-19T21:00');
      expect(formatted).toContain('Jun 19');
      expect(formatted).toContain('–');
    });

    it('formats start-only and end-only schedules', () => {
      expect(formatSubEventSchedule('2026-06-19T18:00', null)).toContain('Jun 19');
      expect(formatSubEventSchedule(null, '2026-06-19T21:00')).toMatch(/^Until /);
    });

    it('formats schedules in an explicit IANA venue timezone regardless of host timezone', () => {
      // 2026-09-20T01:00:00.000Z is Sep 19, 6:00 PM PDT in America/Los_Angeles
      const formatted = formatSubEventSchedule(
        '2026-09-20T01:00:00.000Z',
        '2026-09-20T04:00:00.000Z',
        'America/Los_Angeles'
      );
      expect(formatted).toContain('Sep 19');
      expect(formatted).toContain('6:00 PM');
      expect(formatted).toContain('9:00 PM');
    });
  });

  describe('venue timezone conversion & friendly labels', () => {
    it('converts datetime-local values using DST-accurate venue timezone offsets', () => {
      // Summer PDT (UTC-7): 2026-08-15T16:00 in America/Los_Angeles -> 2026-08-15T23:00:00.000Z
      const summerIso = fromDateTimeLocalValue('2026-08-15T16:00', 'America/Los_Angeles');
      expect(summerIso).toBe('2026-08-15T23:00:00.000Z');
      expect(toDateTimeLocalValue(summerIso, 'America/Los_Angeles')).toBe('2026-08-15T16:00');

      // Winter PST (UTC-8): 2026-12-15T16:00 in America/Los_Angeles -> 2026-12-16T00:00:00.000Z
      const winterIso = fromDateTimeLocalValue('2026-12-15T16:00', 'America/Los_Angeles');
      expect(winterIso).toBe('2026-12-16T00:00:00.000Z');
      expect(toDateTimeLocalValue(winterIso, 'America/Los_Angeles')).toBe('2026-12-15T16:00');
    });

    it('validates IANA timezones and formats human-friendly timezone labels', () => {
      expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true);
      expect(isValidIanaTimeZone('Invalid/Zone')).toBe(false);

      expect(formatFriendlyTimezone('America/Los_Angeles')).toBe('Pacific Time (PT)');
      expect(formatFriendlyTimezone('America/Chicago')).toBe('Central Time (CT)');
      expect(formatFriendlyTimezone('America/New_York')).toBe('Eastern Time (ET)');
      expect(formatFriendlyTimezone('UTC')).toBe('Coordinated Universal Time (UTC)');
    });
  });
});
