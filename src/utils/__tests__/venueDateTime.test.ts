import {
  DEFAULT_CEREMONY_TIME,
  extractVenueDateAndTime,
  formatVenueCeremonyConfirmation,
  formatVenueWeddingDate,
  isValidCeremonyTime,
  isValidDateOnly,
  normalizeCeremonyTime,
  normalizeVenueWeddingDate,
  resolveVenueDateTimeInstant,
  resolveVenueTimezone,
  subtractCalendarDays,
} from '../venueDateTime';

describe('venueDateTime utilities', () => {
  describe('resolveVenueTimezone', () => {
    it('returns valid IANA timezones and falls back cleanly for blank or invalid inputs', () => {
      expect(resolveVenueTimezone('America/Chicago')).toBe('America/Chicago');
      expect(resolveVenueTimezone('  America/Los_Angeles  ')).toBe('America/Los_Angeles');
      expect(resolveVenueTimezone('UTC')).toBe('UTC');
      expect(resolveVenueTimezone('')).toBe('UTC');
      expect(resolveVenueTimezone(null, 'America/New_York')).toBe('America/New_York');
      expect(resolveVenueTimezone('Invalid/Not_A_Zone', 'America/Chicago')).toBe('America/Chicago');
    });
  });

  describe('isValidDateOnly, isValidCeremonyTime, and normalizeCeremonyTime', () => {
    it('validates real calendar dates and rejects impossible dates', () => {
      expect(isValidDateOnly('2027-06-20')).toBe(true);
      expect(isValidDateOnly('2028-02-29')).toBe(true);
      expect(isValidDateOnly('2027-02-29')).toBe(false);
      expect(isValidDateOnly('2027-13-01')).toBe(false);
      expect(isValidDateOnly('2027-06-20T16:00:00Z')).toBe(false);
      expect(isValidDateOnly('')).toBe(false);
    });

    it('validates 24-hour HH:MM ceremony times and defaults blank/unset inputs to 16:00', () => {
      expect(DEFAULT_CEREMONY_TIME).toBe('16:00');
      expect(isValidCeremonyTime('00:00')).toBe(true);
      expect(isValidCeremonyTime('16:00')).toBe(true);
      expect(isValidCeremonyTime('19:30')).toBe(true);
      expect(isValidCeremonyTime('23:59')).toBe(true);
      expect(isValidCeremonyTime('24:00')).toBe(false);
      expect(isValidCeremonyTime('4:00 PM')).toBe(false);

      expect(normalizeCeremonyTime(undefined)).toBe('16:00');
      expect(normalizeCeremonyTime('')).toBe('16:00');
      expect(normalizeCeremonyTime('   ')).toBe('16:00');
      expect(normalizeCeremonyTime('19:30')).toBe('19:30');
    });
  });

  describe('resolveVenueDateTimeInstant & extractVenueDateAndTime round-trips', () => {
    it('converts 2027-06-20 at 16:00 in America/Chicago to 2027-06-20T21:00:00.000Z and extracts back cleanly', () => {
      const instant = resolveVenueDateTimeInstant('2027-06-20', '16:00', 'America/Chicago');
      expect(instant).not.toBeNull();
      expect(instant!.toISOString()).toBe('2027-06-20T21:00:00.000Z');

      expect(extractVenueDateAndTime(instant, 'America/Chicago')).toEqual({
        date: '2027-06-20',
        time: '16:00',
      });
    });

    it('converts evening 2027-06-20 at 19:30 in America/Los_Angeles to 2027-06-21T02:30:00.000Z without advancing date on reload', () => {
      const instant = resolveVenueDateTimeInstant('2027-06-20', '19:30', 'America/Los_Angeles');
      expect(instant).not.toBeNull();
      expect(instant!.toISOString()).toBe('2027-06-21T02:30:00.000Z');

      expect(extractVenueDateAndTime(instant!.toISOString(), 'America/Los_Angeles')).toEqual({
        date: '2027-06-20',
        time: '19:30',
      });
      expect(formatVenueWeddingDate(instant, 'America/Los_Angeles')).toBe('June 20, 2027');
    });

    it('disambiguates explicit ceremony times that land on 00:00:00Z (e.g. 17:00 PDT in America/Los_Angeles) from legacy UTC midnight', () => {
      const instant = resolveVenueDateTimeInstant('2027-06-20', '17:00', 'America/Los_Angeles');
      expect(instant).not.toBeNull();
      expect(instant!.toISOString()).toBe('2027-06-21T00:00:00.001Z');

      expect(extractVenueDateAndTime(instant!.toISOString(), 'America/Los_Angeles')).toEqual({
        date: '2027-06-20',
        time: '17:00',
      });
      expect(formatVenueWeddingDate(instant!.toISOString(), 'America/Los_Angeles')).toBe(
        'June 20, 2027',
      );
    });

    it('handles winter standard-time offsets and positive-offset Pacific/Auckland timezones accurately', () => {
      const winterChicago = resolveVenueDateTimeInstant('2027-12-11', '16:00', 'America/Chicago');
      expect(winterChicago!.toISOString()).toBe('2027-12-11T22:00:00.000Z');

      const aucklandMorning = resolveVenueDateTimeInstant('2027-06-20', '11:00', 'Pacific/Auckland');
      expect(aucklandMorning!.toISOString()).toBe('2027-06-19T23:00:00.000Z');
      expect(extractVenueDateAndTime(aucklandMorning, 'Pacific/Auckland')).toEqual({
        date: '2027-06-20',
        time: '11:00',
      });
    });
  });

  describe('normalizeVenueWeddingDate & legacy T00:00:00.000Z healing', () => {
    it.each([
      ['America/New_York', '2027-06-20T20:00:00.000Z'],
      ['America/Chicago', '2027-06-20T21:00:00.000Z'],
      ['America/Los_Angeles', '2027-06-20T23:00:00.000Z'],
    ])(
      'heals legacy 2027-06-20T00:00:00.000Z in %s to 16:00 local (%s) and renders June 20, 2027',
      (tz, expectedIso) => {
        const fromString = normalizeVenueWeddingDate('2027-06-20T00:00:00.000Z', tz);
        expect(fromString!.toISOString()).toBe(expectedIso);

        const fromDate = normalizeVenueWeddingDate(new Date('2027-06-20T00:00:00.000Z'), tz);
        expect(fromDate!.toISOString()).toBe(expectedIso);

        expect(formatVenueWeddingDate('2027-06-20T00:00:00.000Z', tz)).toBe('June 20, 2027');
        expect(extractVenueDateAndTime('2027-06-20T00:00:00.000Z', tz)).toEqual({
          date: '2027-06-20',
          time: '16:00',
        });
      },
    );
  });

  describe('formatVenueCeremonyConfirmation & subtractCalendarDays', () => {
    it('formats human-readable ceremony confirmation strings with localized weekday, time, and timezone', () => {
      const chicagoText = formatVenueCeremonyConfirmation(
        '2027-06-20',
        '16:00',
        'America/Chicago',
      );
      expect(chicagoText).toContain('Sunday, June 20, 2027');
      expect(chicagoText).toContain('4:00 PM');
      expect(chicagoText).toContain('(America/Chicago)');

      const laEveningText = formatVenueCeremonyConfirmation(
        '2027-06-20',
        '19:30',
        'America/Los_Angeles',
      );
      expect(laEveningText).toContain('Sunday, June 20, 2027');
      expect(laEveningText).toContain('7:30 PM');
      expect(laEveningText).toContain('(America/Los_Angeles)');

      expect(formatVenueCeremonyConfirmation('', '16:00', 'America/Chicago')).toBeNull();
    });

    it('subtracts calendar days without applying timezone offsets twice', () => {
      expect(subtractCalendarDays('2027-06-20', 16)).toBe('2027-06-04');
      expect(subtractCalendarDays('2027-03-10', 16)).toBe('2027-02-22');
      expect(subtractCalendarDays('2028-03-10', 16)).toBe('2028-02-23');
    });
  });
});
