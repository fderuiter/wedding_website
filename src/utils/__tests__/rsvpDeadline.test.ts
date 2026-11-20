import {
  DEFAULT_RSVP_CLOSED_MESSAGE,
  RSVP_GRACE_PERIOD_HOURS_OPTIONS,
  evaluateRsvpCutoff,
  formatRsvpDeadlineDate,
  getVenueMidnightCutoffUtcMs,
  isValidRsvpDeadlineDate,
  isValidRsvpGracePeriodHours,
  resolveValidTimezone,
  sanitizeRsvpClosedMessage,
} from '../rsvpDeadline';

describe('rsvpDeadline utility', () => {
  describe('sanitizeRsvpClosedMessage', () => {
    it('strips HTML tags, angle brackets, control characters, and unsafe URI schemes', () => {
      expect(
        sanitizeRsvpClosedMessage('  <script>alert("xss")</script>Please email us\r\nsoon!  ')
      ).toBe('alert("xss")Please email us soon!');
      expect(
        sanitizeRsvpClosedMessage('Reach out <img src=x onerror=alert(1)> via javascript:alert(1)')
      ).toBe('Reach out  via alert(1)');
      expect(sanitizeRsvpClosedMessage('data:text/html;base64,PHNjcmlwdD4= vbscript:msgbox(1)')).toBe(
        'text/html;base64,PHNjcmlwdD4= msgbox(1)'
      );
      expect(sanitizeRsvpClosedMessage('\u0000\u0007Hello<world>')).toBe('Hello');
      expect(sanitizeRsvpClosedMessage('\u0000\u0007Hello < world >')).toBe('Hello  world');
      expect(sanitizeRsvpClosedMessage('Please email <couple@example.com>')).toBe(
        'Please email couple@example.com'
      );
      expect(
        sanitizeRsvpClosedMessage('<scr<script>ipt>alert(1)</scr</script>ipt>Contact hosts')
      ).toBe('alert(1)Contact hosts');
      expect(
        sanitizeRsvpClosedMessage(
          'java<script>script:javascript:alert(1) da\u0000ta:text/html,hi (metadata: ok)'
        )
      ).toBe('alert(1) text/html,hi (metadata: ok)');
      expect(sanitizeRsvpClosedMessage(null)).toBe('');
      expect(sanitizeRsvpClosedMessage(undefined)).toBe('');
    });

    it('truncates messages exceeding maxLength', () => {
      expect(sanitizeRsvpClosedMessage('a'.repeat(600)).length).toBe(500);
    });
  });

  describe('isValidRsvpDeadlineDate & formatRsvpDeadlineDate', () => {
    it('accepts real YYYY-MM-DD calendar dates and rejects impossible dates', () => {
      expect(isValidRsvpDeadlineDate('2026-08-15')).toBe(true);
      expect(isValidRsvpDeadlineDate('2028-02-29')).toBe(true); // leap year
      expect(isValidRsvpDeadlineDate('2026-02-29')).toBe(false); // non-leap year
      expect(isValidRsvpDeadlineDate('2026-02-31')).toBe(false);
      expect(isValidRsvpDeadlineDate('08/15/2026')).toBe(false);
      expect(isValidRsvpDeadlineDate('')).toBe(false);
    });

    it('formats YYYY-MM-DD without shifting the calendar day in western timezones', () => {
      expect(formatRsvpDeadlineDate('2026-08-15')).toBe('August 15, 2026');
      expect(formatRsvpDeadlineDate('2026-01-01')).toBe('January 1, 2026');
      expect(formatRsvpDeadlineDate('')).toBeNull();
      expect(formatRsvpDeadlineDate('invalid')).toBeNull();
    });
  });

  describe('isValidRsvpGracePeriodHours & resolveValidTimezone', () => {
    it('accepts only the six supported grace period presets', () => {
      expect(RSVP_GRACE_PERIOD_HOURS_OPTIONS).toEqual([0, 12, 24, 48, 72, 168]);
      for (const hours of RSVP_GRACE_PERIOD_HOURS_OPTIONS) {
        expect(isValidRsvpGracePeriodHours(hours)).toBe(true);
      }
      expect(isValidRsvpGracePeriodHours(6)).toBe(false);
      expect(isValidRsvpGracePeriodHours(-12)).toBe(false);
      expect(isValidRsvpGracePeriodHours('48')).toBe(false);
    });

    it('resolves valid IANA timezones and falls back to UTC for invalid identifiers', () => {
      expect(resolveValidTimezone('America/Chicago')).toBe('America/Chicago');
      expect(resolveValidTimezone('UTC')).toBe('UTC');
      expect(resolveValidTimezone('Not/AZone')).toBe('UTC');
      expect(resolveValidTimezone('')).toBe('UTC');
    });
  });

  describe('getVenueMidnightCutoffUtcMs & evaluateRsvpCutoff', () => {
    it('computes midnight at the end of the cutoff date in the venue IANA timezone', () => {
      // August 15, 2026 in America/Chicago (CDT, UTC-5) closes at 2026-08-16T00:00:00-05:00 = 2026-08-16T05:00:00.000Z
      const chicagoCutoffMs = getVenueMidnightCutoffUtcMs('2026-08-15', 'America/Chicago');
      expect(chicagoCutoffMs).toBe(Date.parse('2026-08-16T05:00:00.000Z'));

      // December 15, 2026 in America/New_York (EST, UTC-5) closes at 2026-12-16T05:00:00.000Z
      const nyCutoffMs = getVenueMidnightCutoffUtcMs('2026-12-15', 'America/New_York');
      expect(nyCutoffMs).toBe(Date.parse('2026-12-16T05:00:00.000Z'));
    });

    it('keeps RSVPs open during a silent grace window while preserving the published deadline date', () => {
      const config = {
        rsvpOpen: true,
        rsvpDeadlineDate: '2026-08-15',
        rsvpGracePeriodHours: 48,
        rsvpClosedMessage: 'RSVPs closed — email hosts@example.com.',
        timezone: 'America/Chicago',
      };

      // 1 second before midnight CDT -> open, not in grace window
      const beforeCutoff = evaluateRsvpCutoff(config, new Date('2026-08-16T04:59:59.000Z'));
      expect(beforeCutoff.isOpen).toBe(true);
      expect(beforeCutoff.isPastDeadline).toBe(false);
      expect(beforeCutoff.isInGraceWindow).toBe(false);
      expect(beforeCutoff.formattedDeadline).toBe('August 15, 2026');

      // 24 hours after midnight CDT -> still open inside 48-hour silent grace window!
      const inGrace = evaluateRsvpCutoff(config, new Date('2026-08-17T05:00:00.000Z'));
      expect(inGrace.isOpen).toBe(true);
      expect(inGrace.isPastDeadline).toBe(true);
      expect(inGrace.isInGraceWindow).toBe(true);
      expect(inGrace.formattedDeadline).toBe('August 15, 2026');

      // Exactly 48 hours after midnight CDT -> grace window expired -> closed!
      const afterGrace = evaluateRsvpCutoff(config, new Date('2026-08-18T05:00:00.000Z'));
      expect(afterGrace.isOpen).toBe(false);
      expect(afterGrace.isPastDeadline).toBe(true);
      expect(afterGrace.isInGraceWindow).toBe(false);
      expect(afterGrace.closedMessage).toBe('RSVPs closed — email hosts@example.com.');
    });

    it('closes RSVPs immediately when manual rsvpOpen toggle is false even before cutoff', () => {
      const result = evaluateRsvpCutoff(
        {
          rsvpOpen: false,
          rsvpDeadlineDate: '2099-12-31',
          rsvpGracePeriodHours: 168,
          rsvpClosedMessage: '',
          timezone: 'America/Chicago',
        },
        new Date('2026-06-01T12:00:00.000Z')
      );

      expect(result.isOpen).toBe(false);
      expect(result.isManuallyLocked).toBe(true);
      expect(result.closedMessage).toBe(DEFAULT_RSVP_CLOSED_MESSAGE);
    });
  });
});
