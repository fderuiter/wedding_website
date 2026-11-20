import crypto from 'crypto';
import {
  extractDietaryTags,
  matchDietaryCategory,
  getAttendanceStatus,
  formatAttendanceLabel,
  formatGuestPlusOneNames,
  formatGuestMealSelections,
  formatGuestCustomAnswers,
  isAddressComplete,
  generateRandomCode,
  AttendanceStatus,
  AttendanceStatusItem,
  AddressItem,
} from '../invitation';

describe('invitation utils', () => {
  describe('matchDietaryCategory', () => {
    it('returns true immediately if category is empty, undefined, null, or "all"', () => {
      expect(matchDietaryCategory(undefined, 'all')).toBe(true);
      expect(matchDietaryCategory(null, 'all')).toBe(true);
      expect(matchDietaryCategory('', 'all')).toBe(true);
      expect(matchDietaryCategory('   ', 'all')).toBe(true);
      expect(matchDietaryCategory(null, '')).toBe(true);
      expect(matchDietaryCategory(null, undefined)).toBe(true);
      expect(matchDietaryCategory('Vegan only', 'all')).toBe(true);
      expect(matchDietaryCategory('Nut allergy', '')).toBe(true);
    });

    it('returns false when notes are empty, undefined, null, or whitespace-only for specific categories', () => {
      expect(matchDietaryCategory(undefined, 'gluten-free')).toBe(false);
      expect(matchDietaryCategory(null, 'vegetarian')).toBe(false);
      expect(matchDietaryCategory('', 'vegan')).toBe(false);
      expect(matchDietaryCategory('   ', 'dairy-free')).toBe(false);
      expect(matchDietaryCategory(null, 'has_restriction')).toBe(false);
      expect(matchDietaryCategory(null, 'other')).toBe(false);
    });

    it('identifies gluten-free restrictions correctly', () => {
      expect(matchDietaryCategory('Gluten-free diet', 'gluten-free')).toBe(true);
      expect(matchDietaryCategory('Strictly GF please', 'gluten-free')).toBe(true);
      expect(matchDietaryCategory('No gluten', 'gluten-free')).toBe(true);
      expect(matchDietaryCategory('Dairy-free and vegan', 'gluten-free')).toBe(false);
    });

    it('identifies vegan restrictions correctly', () => {
      expect(matchDietaryCategory('I am vegan', 'vegan')).toBe(true);
      expect(matchDietaryCategory('VEGAN meals only', 'vegan')).toBe(true);
      expect(matchDietaryCategory('Vegetarian please', 'vegan')).toBe(false);
    });

    it('identifies vegetarian restrictions correctly (excluding pure vegan)', () => {
      expect(matchDietaryCategory('Vegetarian only', 'vegetarian')).toBe(true);
      expect(matchDietaryCategory('Strict veg', 'vegetarian')).toBe(true);
      // If someone writes vegan, isVegetarian evaluates to false because !isVegan
      expect(matchDietaryCategory('Vegan diet', 'vegetarian')).toBe(false);
      expect(matchDietaryCategory('No meat, vegetarian', 'vegetarian')).toBe(true);
    });

    it('identifies dairy-free restrictions correctly', () => {
      expect(matchDietaryCategory('Dairy-free please', 'dairy-free')).toBe(true);
      expect(matchDietaryCategory('DF diet', 'dairy-free')).toBe(true);
      expect(matchDietaryCategory('Severe lactose intolerance', 'dairy-free')).toBe(true);
      expect(matchDietaryCategory('No dairy', 'dairy-free')).toBe(true);
      expect(matchDietaryCategory('Gluten-free only', 'dairy-free')).toBe(false);
    });

    it('identifies nut-free restrictions correctly', () => {
      expect(matchDietaryCategory('Nut allergy', 'nut-free')).toBe(true);
      expect(matchDietaryCategory('No nuts please', 'nut-free')).toBe(true);
      expect(matchDietaryCategory('Severe peanut allergy', 'nut-free')).toBe(true);
      expect(matchDietaryCategory('General food allergies', 'nut-free')).toBe(true);
      // Word boundary check: "minute" should not match "nut"
      expect(matchDietaryCategory('Will arrive 10 minutes late', 'nut-free')).toBe(false);
    });

    it('categorizes unclassified restrictions under "other"', () => {
      expect(matchDietaryCategory('Kosher only', 'other')).toBe(true);
      expect(matchDietaryCategory('Halal meals', 'other')).toBe(true);
      expect(matchDietaryCategory('Gluten-free and vegan', 'other')).toBe(false);
    });

    it('matches "has_restriction" for any non-empty note', () => {
      expect(matchDietaryCategory('Kosher', 'has_restriction')).toBe(true);
      expect(matchDietaryCategory('No onions', 'has_restriction')).toBe(true);
      expect(matchDietaryCategory('', 'has_restriction')).toBe(false);
    });

    it('defaults to true for unknown categories when notes are non-empty', () => {
      expect(matchDietaryCategory('Some notes', 'unknown-category')).toBe(true);
    });
  });

  describe('getAttendanceStatus', () => {
    it('handles explicit boolean values in extraFields', () => {
      expect(getAttendanceStatus({ used: false, extraFields: { attendanceStatus: true } })).toBe('attending');
      expect(getAttendanceStatus({ used: true, extraFields: { attendanceStatus: false } })).toBe('declined');
      expect(getAttendanceStatus({ used: false, extraFields: { attending: true } })).toBe('attending');
      expect(getAttendanceStatus({ used: true, extraFields: { attending: false } })).toBe('declined');
    });

    it('handles explicit attending keywords in extraFields', () => {
      const attendingWords = ['attending', 'accepted', 'yes', 'confirmed', 'true'];
      for (const word of attendingWords) {
        expect(getAttendanceStatus({ used: false, extraFields: { rsvpStatus: word } })).toBe('attending');
        expect(getAttendanceStatus({ used: false, extraFields: { rsvpStatus: `  ${word.toUpperCase()}  ` } })).toBe('attending');
      }
    });

    it('handles explicit declined keywords in extraFields', () => {
      const declinedWords = ['declined', 'no', 'rejected', 'false'];
      for (const word of declinedWords) {
        expect(getAttendanceStatus({ used: true, extraFields: { rsvp: word } })).toBe('declined');
        expect(getAttendanceStatus({ used: true, extraFields: { rsvp: `  ${word.toUpperCase()}  ` } })).toBe('declined');
      }
    });

    it('handles explicit pending keyword in extraFields', () => {
      expect(getAttendanceStatus({ used: true, extraFields: { status: 'pending' } })).toBe('pending');
      expect(getAttendanceStatus({ used: false, extraFields: { status: '  PENDING  ' } })).toBe('pending');
    });

    it('observes priority order across multiple extraFields keys', () => {
      // attendanceStatus takes precedence over rsvpStatus
      expect(
        getAttendanceStatus({
          used: false,
          extraFields: { attendanceStatus: 'attending', rsvpStatus: 'declined' },
        })
      ).toBe('attending');

      // rsvpStatus takes precedence over attendance
      expect(
        getAttendanceStatus({
          used: false,
          extraFields: { rsvpStatus: 'declined', attendance: 'attending' },
        })
      ).toBe('declined');

      // attendance takes precedence over rsvp
      expect(
        getAttendanceStatus({
          used: false,
          extraFields: { attendance: 'attending', rsvp: 'declined' },
        })
      ).toBe('attending');

      // rsvp takes precedence over attending
      expect(
        getAttendanceStatus({
          used: false,
          extraFields: { rsvp: 'declined', attending: true },
        })
      ).toBe('declined');

      // attending takes precedence over status
      expect(
        getAttendanceStatus({
          used: false,
          extraFields: { attending: true, status: 'declined' },
        })
      ).toBe('attending');
    });

    it('falls back to item.used when extraFields is absent, null, empty, or unparseable', () => {
      const itemWithUsed: AttendanceStatusItem = { used: true };
      const itemWithoutUsed: AttendanceStatusItem = { used: false };

      const attendingStatus: AttendanceStatus = getAttendanceStatus(itemWithUsed);
      expect(attendingStatus).toBe('attending');
      expect(getAttendanceStatus(itemWithoutUsed)).toBe('pending');
      expect(getAttendanceStatus({ used: true, extraFields: null })).toBe('attending');
      expect(getAttendanceStatus({ used: false, extraFields: null })).toBe('pending');
      expect(getAttendanceStatus({ used: true, extraFields: {} })).toBe('attending');
      expect(getAttendanceStatus({ used: false, extraFields: {} })).toBe('pending');
      expect(getAttendanceStatus({ used: true, extraFields: { status: 'unknown_value' } })).toBe('attending');
      expect(getAttendanceStatus({ used: false, extraFields: { status: 'unknown_value' } })).toBe('pending');
    });
  });

  describe('isAddressComplete', () => {
    it('returns true when addressLine1, city, state, and zipCode are non-empty', () => {
      const validAddress: AddressItem = {
        addressLine1: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
      };
      expect(isAddressComplete(validAddress)).toBe(true);
    });

    it('returns true even if optional addressLine2 or country are missing or null', () => {
      expect(
        isAddressComplete({
          addressLine1: '456 Elm Ave',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
        })
      ).toBe(true);
    });

    it('returns false if addressLine1 is missing, null, or empty', () => {
      expect(isAddressComplete({ city: 'Austin', state: 'TX', zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: null, city: 'Austin', state: 'TX', zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '   ', city: 'Austin', state: 'TX', zipCode: '78701' })).toBe(false);
    });

    it('returns false if city is missing, null, or empty', () => {
      expect(isAddressComplete({ addressLine1: '123 Main St', state: 'TX', zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: null, state: 'TX', zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: '   ', state: 'TX', zipCode: '78701' })).toBe(false);
    });

    it('returns false if state is missing, null, or empty', () => {
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', state: null, zipCode: '78701' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', state: '   ', zipCode: '78701' })).toBe(false);
    });

    it('returns false if zipCode is missing, null, or empty', () => {
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', state: 'TX' })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', state: 'TX', zipCode: null })).toBe(false);
      expect(isAddressComplete({ addressLine1: '123 Main St', city: 'Austin', state: 'TX', zipCode: '   ' })).toBe(false);
    });

    it('handles undefined or null item gracefully', () => {
      expect(isAddressComplete(undefined)).toBe(false);
      expect(isAddressComplete(null)).toBe(false);
      expect(isAddressComplete({})).toBe(false);
    });
  });

  describe('generateRandomCode', () => {
    it('generates an eight-character string', () => {
      const code = generateRandomCode();
      expect(typeof code).toBe('string');
      expect(code).toHaveLength(8);
    });

    it('contains only uppercase alphanumeric characters (A-Z and 0-9)', () => {
      const alphanumericUppercaseRegex = /^[A-Z0-9]{8}$/;
      for (let i = 0; i < 50; i++) {
        const code = generateRandomCode();
        expect(code).toHaveLength(8);
        expect(code).toMatch(alphanumericUppercaseRegex);
        // Ensure no lowercase characters or special symbols are present
        expect(code).toBe(code.toUpperCase());
        expect(/[^A-Z0-9]/.test(code)).toBe(false);
      }
    });

    it('generates random codes across successive calls', () => {
      const sampleSize = 100;
      const codes = new Set<string>();
      for (let i = 0; i < sampleSize; i++) {
        codes.add(generateRandomCode());
      }
      expect(codes.size).toBe(sampleSize);

      const code1 = generateRandomCode();
      const code2 = generateRandomCode();
      expect(code1).not.toBe(code2);
    });

    it('uses crypto.randomInt rather than Math.random', () => {
      const randomIntSpy = jest.spyOn(crypto, 'randomInt');
      const mathRandomSpy = jest.spyOn(Math, 'random');

      try {
        const code = generateRandomCode();
        expect(code).toMatch(/^[A-Z0-9]{8}$/);
        expect(randomIntSpy).toHaveBeenCalledTimes(8);
        expect(randomIntSpy).toHaveBeenCalledWith(0, 36);
        expect(mathRandomSpy).not.toHaveBeenCalled();
      } finally {
        randomIntSpy.mockRestore();
        mathRandomSpy.mockRestore();
      }
    });
  });

  describe('structured dietary tags & RSVP export formatters', () => {
    it('extracts and matches structured dietary tags from extraFields and mealSelections even when free-text notes are empty', () => {
      const extra = {
        dietaryTags: ['Gluten-Free'],
        mealSelections: [
          {
            subEventId: 'se-1',
            subEventTitle: 'Reception',
            selections: [
              { attendee: 'Jane', optionId: 'm1', label: 'Salmon', dietaryTags: ['gluten-free', 'dairy-free'] },
              { attendee: 'John', optionId: 'm2', label: 'Falafel', dietaryTags: ['vegan', 'halal'] },
            ],
          },
        ],
      };

      expect(extractDietaryTags(extra)).toEqual(['gluten-free', 'dairy-free', 'vegan', 'halal']);
      expect(matchDietaryCategory('', 'gluten-free', extra)).toBe(true);
      expect(matchDietaryCategory('', 'dairy-free', extra)).toBe(true);
      expect(matchDietaryCategory('', 'vegan', extra)).toBe(true);
      expect(matchDietaryCategory('', 'other', extra)).toBe(true); // 'halal' matches 'other'
      expect(matchDietaryCategory('', 'nut-free', extra)).toBe(false);
      expect(matchDietaryCategory('', 'has_restriction', extra)).toBe(true);

      // 'kids' portion tag alone does not count as a dietary restriction unless filtering by 'kids'
      const kidsOnly = { dietaryTags: ['kids'] };
      expect(matchDietaryCategory('', 'has_restriction', kidsOnly)).toBe(false);
      expect(matchDietaryCategory('', 'other', kidsOnly)).toBe(false);
      expect(matchDietaryCategory('', 'kids', kidsOnly)).toBe(true);
    });

    it('formats attendance labels, plus-one names, meal selections, and custom answers for CSV exports', () => {
      const syncedGuest = {
        used: true,
        plusOneFirstName: 'John',
        plusOneLastName: 'Doe',
        extraFields: {
          attendanceStatus: 'attending',
          plusOneNames: ['John Doe', 'Alex Doe'],
          mealSelections: [
            {
              subEventId: 'se-1',
              subEventTitle: 'Reception',
              selections: [
                { attendee: 'Jane Doe', optionId: 'm1', label: 'Herb Salmon', dietaryTags: ['gluten-free'] },
                { attendee: 'John Doe', optionId: 'm2', label: 'Short Rib', dietaryTags: [] },
              ],
            },
          ],
          customAnswers: [
            {
              subEventId: 'se-1',
              subEventTitle: 'Reception',
              answers: [{ questionId: 'q1', prompt: 'Shuttle?', answer: 'Yes, round-trip' }],
            },
          ],
        },
      };

      expect(formatAttendanceLabel(syncedGuest)).toBe('Attending');
      expect(formatGuestPlusOneNames(syncedGuest)).toBe('John Doe, Alex Doe');
      expect(formatGuestMealSelections(syncedGuest)).toBe(
        'Jane Doe: Herb Salmon (gluten-free); John Doe: Short Rib'
      );
      expect(formatGuestCustomAnswers(syncedGuest)).toBe('Shuttle?: Yes, round-trip');

      expect(formatAttendanceLabel({ used: true, extraFields: { attendanceStatus: 'declined' } })).toBe('Declined');
      expect(formatAttendanceLabel({ used: false, extraFields: null })).toBe('Pending');
      expect(
        formatGuestPlusOneNames({ plusOneFirstName: 'Legacy', plusOneLastName: 'Guest', extraFields: null })
      ).toBe('Legacy Guest');
    });
  });
});
