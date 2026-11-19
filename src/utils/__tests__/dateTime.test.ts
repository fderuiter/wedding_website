import {
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  isEndTimeBeforeStartTime,
  formatSubEventSchedule,
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
  });
});
