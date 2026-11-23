import {
  cleanOptionalSetupText,
  formatCleanVenueParts,
  hasCustomStoryText,
  hasNonPlaceholderVenueDetails,
  isUpcomingWeddingDate,
  resolveSetupCopyField,
  synthesizeSetupStarterCopy,
} from '../setupCopy';

describe('setupCopy utilities', () => {
  describe('cleanOptionalSetupText', () => {
    it('returns empty string for null, undefined, whitespace, and legacy placeholders', () => {
      expect(cleanOptionalSetupText(undefined)).toBe('');
      expect(cleanOptionalSetupText(null)).toBe('');
      expect(cleanOptionalSetupText('   ')).toBe('');
      expect(cleanOptionalSetupText('TBD')).toBe('');
      expect(cleanOptionalSetupText('tbd')).toBe('');
      expect(cleanOptionalSetupText('Our story...')).toBe('');
      expect(cleanOptionalSetupText('Venue description...')).toBe('');
      expect(cleanOptionalSetupText('Travel advice...')).toBe('');
    });

    it('preserves and trims custom non-placeholder text', () => {
      expect(cleanOptionalSetupText('  The Glasshouse  ')).toBe('The Glasshouse');
      expect(cleanOptionalSetupText('We met in college.')).toBe('We met in college.');
    });
  });

  describe('isUpcomingWeddingDate', () => {
    const referenceNow = new Date('2026-11-22T12:00:00.000Z');

    it('returns true for future dates and false for past dates', () => {
      expect(isUpcomingWeddingDate('2027-06-20', referenceNow)).toBe(true);
      expect(isUpcomingWeddingDate(new Date('2028-05-01T18:00:00.000Z'), referenceNow)).toBe(true);
      expect(isUpcomingWeddingDate('2025-10-10', referenceNow)).toBe(false);
      expect(isUpcomingWeddingDate('2026-06-20T16:00:00.000Z', referenceNow)).toBe(false);
    });

    it('treats blank or invalid dates as upcoming during setup', () => {
      expect(isUpcomingWeddingDate('', referenceNow)).toBe(true);
      expect(isUpcomingWeddingDate(null, referenceNow)).toBe(true);
      expect(isUpcomingWeddingDate('not-a-date', referenceNow)).toBe(true);
    });
  });

  describe('formatCleanVenueParts', () => {
    it('formats full venue details cleanly', () => {
      expect(
        formatCleanVenueParts({
          venueName: 'Rosewood Estate',
          venueAddress: '100 Garden Way',
          venueCity: 'Austin',
          venueState: 'TX',
          venueZip: '78701',
        })
      ).toEqual({
        venueName: 'Rosewood Estate',
        venueAddress: '100 Garden Way',
        venueCity: 'Austin',
        venueState: 'TX',
        venueZip: '78701',
        cityState: 'Austin, TX',
        venueWithAddress: 'Rosewood Estate · 100 Garden Way',
        shortLocation: 'Austin, TX',
        fullLocation: 'Rosewood Estate, 100 Garden Way, Austin, TX 78701',
      });
    });

    it('omits TBD placeholders and dangling punctuation when venue fields are blank', () => {
      expect(
        formatCleanVenueParts({
          venueName: 'TBD',
          venueAddress: '  ',
          venueCity: 'TBD',
          venueState: '',
          venueZip: 'TBD',
        })
      ).toEqual({
        venueName: '',
        venueAddress: '',
        venueCity: '',
        venueState: '',
        venueZip: '',
        cityState: '',
        venueWithAddress: '',
        shortLocation: '',
        fullLocation: '',
      });
    });

    it('handles partial venue fields without stray commas or dots', () => {
      expect(
        formatCleanVenueParts({
          venueName: 'Sunset Barn',
          venueCity: 'Napa',
          venueState: '',
        })
      ).toMatchObject({
        cityState: 'Napa',
        venueWithAddress: 'Sunset Barn',
        shortLocation: 'Napa',
        fullLocation: 'Sunset Barn, Napa',
      });
    });
  });

  describe('synthesizeSetupStarterCopy', () => {
    const referenceDate = new Date('2026-11-22T12:00:00.000Z');

    it('synthesizes celebratory upcoming copy with partner names for future wedding dates', () => {
      const copy = synthesizeSetupStarterCopy({
        partner1Name: 'Maya',
        partner2Name: 'Liam',
        weddingDate: '2027-09-18',
        venueName: 'The Conservatory',
        venueCity: 'Seattle',
        venueState: 'WA',
        referenceDate,
      });

      expect(copy.isUpcoming).toBe(true);
      expect(copy.heroTitle).toBe('Maya & Liam');
      expect(copy.heroSubtitle).not.toContain('Tied the Knot');
      expect(copy.heroSubtitle).toContain('September 18, 2027 at The Conservatory in Seattle, WA');
      expect(copy.storyText).toContain('Maya and Liam cannot wait to celebrate');
      expect(copy.storyText).not.toBe('Our story...');
      expect(copy.seoTitle).toBe("Maya & Liam's Wedding");
    });

    it('preserves sensible past-wedding copy when weddingDate is in the past', () => {
      const copy = synthesizeSetupStarterCopy({
        partner1Name: 'Maya',
        partner2Name: 'Liam',
        weddingDate: '2024-09-18',
        venueName: 'TBD',
        venueCity: '',
        venueState: '',
        referenceDate,
      });

      expect(copy.isUpcoming).toBe(false);
      expect(copy.heroTitle).toBe('We Tied the Knot!');
      expect(copy.heroSubtitle).toContain('Thank you for celebrating with us on September 18, 2024.');
      expect(copy.storyText).toBe('');
    });

    it('resolveSetupCopyField replaces legacy placeholders while preserving custom copy', () => {
      expect(resolveSetupCopyField('We Tied the Knot!', 'Maya & Liam', 'heroTitle')).toBe('Maya & Liam');
      expect(resolveSetupCopyField('Custom Headline', 'Maya & Liam', 'heroTitle')).toBe('Custom Headline');
      expect(resolveSetupCopyField('Our story...', 'Starter story', 'storyText')).toBe('Starter story');
    });
  });

  describe('hasNonPlaceholderVenueDetails & hasCustomStoryText', () => {
    it('requires non-empty, non-TBD venueName, venueCity, and venueState', () => {
      expect(
        hasNonPlaceholderVenueDetails({
          venueName: 'Grand Hall',
          venueCity: 'Chicago',
          venueState: 'IL',
        })
      ).toBe(true);

      expect(
        hasNonPlaceholderVenueDetails({
          venueName: 'TBD',
          venueCity: 'Chicago',
          venueState: 'IL',
        })
      ).toBe(false);

      expect(
        hasNonPlaceholderVenueDetails({
          venueName: 'Grand Hall',
          venueCity: '',
          venueState: 'IL',
        })
      ).toBe(false);
    });

    it('rejects empty, placeholder, and auto-synthesized setup starter storyText while accepting custom stories', () => {
      const starterUpcoming = synthesizeSetupStarterCopy({
        partner1Name: 'Taylor',
        partner2Name: 'Jordan',
        weddingDate: '2028-06-01',
        venueName: 'Rosewood',
        venueCity: 'Austin',
        venueState: 'TX',
      });

      expect(
        hasCustomStoryText({
          storyText: '',
          partner1Name: 'Taylor',
          partner2Name: 'Jordan',
        })
      ).toBe(false);

      expect(
        hasCustomStoryText({
          storyText: 'Our story...',
          partner1Name: 'Taylor',
          partner2Name: 'Jordan',
        })
      ).toBe(false);

      expect(
        hasCustomStoryText({
          storyText: starterUpcoming.storyText,
          partner1Name: 'Taylor',
          partner2Name: 'Jordan',
        })
      ).toBe(false);

      expect(
        hasCustomStoryText({
          storyText: 'We met hiking in Yosemite in 2021 and got engaged at sunrise.',
          partner1Name: 'Taylor',
          partner2Name: 'Jordan',
          venueName: 'Rosewood',
          venueCity: 'Austin',
          venueState: 'TX',
        })
      ).toBe(true);
    });
  });
});
