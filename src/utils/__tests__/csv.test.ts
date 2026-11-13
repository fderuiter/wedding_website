import {
  parseCsvContent,
  validateSingleCsvRow,
  generateCsvContent,
  escapeCsvCell,
  generateSampleCsvTemplate,
} from '../csv';

describe('CSV Parser Utility', () => {
  it('parses standard CSV lines with quotes and commas', () => {
    const csv = 'Guest Name,Invitation Code\n"Doe, John",CODE123\n"Smith, Jane",CODE456';
    const parsed = parseCsvContent(csv);
    expect(parsed.headers).toEqual(['Guest Name', 'Invitation Code']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ 'Guest Name': 'Doe, John', 'Invitation Code': 'CODE123' });
    expect(parsed.rows[1]).toEqual({ 'Guest Name': 'Smith, Jane', 'Invitation Code': 'CODE456' });
  });

  it('handles escaped quotes and CRLF line endings', () => {
    const csv = 'Name,Code\r\n"Alice ""Ace"" Smith",ACE789\r\nBob,BOB123';
    const parsed = parseCsvContent(csv);
    expect(parsed.headers).toEqual(['Name', 'Code']);
    expect(parsed.suggestedGuestNameCol).toBe('Name');
    expect(parsed.suggestedCodeCol).toBe('Code');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]['Name']).toBe('Alice "Ace" Smith');
  });

  it('auto-detects column headers intelligently for multi-column spreadsheets including companion names', () => {
    const csv = 'Full Name,Invite Code,Email Address,Dietary Allergies,Plus One Count,Companion First Name,Companion Last Name,Table Group\nJane Doe,JANE12,jane@example.com,Gluten Free,2,Jack,Doe,VIP Table';
    const parsed = parseCsvContent(csv);
    expect(parsed.suggestedGuestNameCol).toBe('Full Name');
    expect(parsed.suggestedCodeCol).toBe('Invite Code');
    expect(parsed.suggestedEmailCol).toBe('Email Address');
    expect(parsed.suggestedDietaryNotesCol).toBe('Dietary Allergies');
    expect(parsed.suggestedPlusOneCol).toBe('Plus One Count');
    expect(parsed.suggestedPlusOneFirstNameCol).toBe('Companion First Name');
    expect(parsed.suggestedPlusOneLastNameCol).toBe('Companion Last Name');
  });

  it('disambiguates duplicate CSV headers gracefully', () => {
    const csv = 'Name,Code,Notes,Notes\nAlice,A100,First Note,Second Note';
    const parsed = parseCsvContent(csv);
    expect(parsed.headers).toEqual(['Name', 'Code', 'Notes', 'Notes (2)']);
    expect(parsed.rows[0]['Notes']).toBe('First Note');
    expect(parsed.rows[0]['Notes (2)']).toBe('Second Note');
  });

  describe('generateCsvContent', () => {
    it('escapes individual CSV cells properly', () => {
      expect(escapeCsvCell('simple')).toBe('simple');
      expect(escapeCsvCell('with, comma')).toBe('"with, comma"');
      expect(escapeCsvCell('with "quotes"')).toBe('"with ""quotes"""');
      expect(escapeCsvCell(null)).toBe('');
    });

    it('formats an array of objects into standard CSV text', () => {
      const records = [
        { 'Guest Name': 'Alice Smith', Code: 'ALICE123', Status: 'Unused' },
        { 'Guest Name': 'Bob Jones', Code: 'BOB456', Status: 'Redeemed' },
      ];
      const csv = generateCsvContent(records);
      expect(csv).toBe('Guest Name,Code,Status\nAlice Smith,ALICE123,Unused\nBob Jones,BOB456,Redeemed');
    });

    it('escapes quotes, commas, and newlines correctly', () => {
      const records = [
        {
          'Guest Name': 'Doe, "Johnny" John',
          Notes: 'Line 1\nLine 2',
          Code: 'CODE1,CODE2',
        },
      ];
      const csv = generateCsvContent(records);
      expect(csv).toBe(
        'Guest Name,Notes,Code\n"Doe, ""Johnny"" John","Line 1\nLine 2","CODE1,CODE2"'
      );
    });

    it('respects explicit headers parameter if provided', () => {
      const records = [
        { name: 'Charlie', code: 'C123', extra: 'ignored' },
      ];
      const csv = generateCsvContent(records, ['name', 'code']);
      expect(csv).toBe('name,code\nCharlie,C123');
    });

    it('handles empty records array gracefully', () => {
      expect(generateCsvContent([])).toBe('');
      expect(generateCsvContent([], ['Guest Name', 'Code'])).toBe('Guest Name,Code\n');
    });

    it('handles null, undefined, or missing values safely', () => {
      const records = [
        { 'Guest Name': 'David', Code: null, Email: undefined },
      ];
      const csv = generateCsvContent(records);
      expect(csv).toBe('Guest Name,Code,Email\nDavid,,');
    });

    it('round-trips safely with parseCsvContent', () => {
      const records = [
        {
          'Guest Name': 'Smith, Jane "Janey"',
          'Invitation Code': 'JANEY100',
          Email: 'jane@example.com',
          'Dietary Notes': 'Gluten Free, Nut Allergy',
          'Plus Ones': 2,
        },
      ];
      const csvString = generateCsvContent(records);
      const parsed = parseCsvContent(csvString);

      expect(parsed.headers).toEqual([
        'Guest Name',
        'Invitation Code',
        'Email',
        'Dietary Notes',
        'Plus Ones',
      ]);
      expect(parsed.rows[0]['Guest Name']).toBe('Smith, Jane "Janey"');
      expect(parsed.rows[0]['Invitation Code']).toBe('JANEY100');
      expect(parsed.rows[0]['Dietary Notes']).toBe('Gluten Free, Nut Allergy');
    });
  });

  describe('generateSampleCsvTemplate', () => {
    it('generates standard headers and representative sample rows', () => {
      const template = generateSampleCsvTemplate();
      expect(typeof template).toBe('string');

      const parsed = parseCsvContent(template);
      expect(parsed.headers).toEqual([
        'Guest Name',
        'Invitation Code',
        'Email',
        'Household Name',
        'Party Group',
        'Party Tags',
        'Dietary Notes',
        'Plus-One Allocations',
      ]);
      expect(parsed.suggestedGuestNameCol).toBe('Guest Name');
      expect(parsed.suggestedCodeCol).toBe('Invitation Code');
      expect(parsed.suggestedEmailCol).toBe('Email');
      expect(parsed.suggestedHouseholdNameCol).toBe('Household Name');
      expect(parsed.suggestedPartyGroupCol).toBe('Party Group');
      expect(parsed.suggestedPartyTagsCol).toBe('Party Tags');
      expect(parsed.suggestedDietaryNotesCol).toBe('Dietary Notes');
      expect(parsed.suggestedPlusOneCol).toBe('Plus-One Allocations');

      expect(parsed.rows.length).toBeGreaterThanOrEqual(1);
      expect(parsed.rows[0]['Guest Name']).toBe('Jane Doe');
      expect(parsed.rows[0]['Invitation Code']).toBe('WED2026-JANE');
      expect(parsed.rows[0]['Email']).toBe('jane.doe@example.com');
      expect(parsed.rows[0]['Household Name']).toBe('Doe Family');
      expect(parsed.rows[0]['Party Group']).toBe('Bride');
      expect(parsed.rows[0]['Party Tags']).toBe('VIP, Rehearsal Dinner');
      expect(parsed.rows[0]['Dietary Notes']).toBe('Vegetarian');
      expect(parsed.rows[0]['Plus-One Allocations']).toBe('1');
    });
  });

  describe('validateSingleCsvRow & Hoisted Set Allocations', () => {
    it('validates a single CSV row correctly using provided frequency map and DB set', () => {
      const row = {
        'Guest Name': 'Alice Smith',
        Code: 'ALICE1',
        Email: 'alice@example.com',
      };
      const freqMap = new Map([['ALICE1', 1]]);
      const dbCodes = new Set<string>();

      const result = validateSingleCsvRow(
        row,
        0,
        { guestNameCol: 'Guest Name', codeCol: 'Code', emailCol: 'Email' },
        freqMap,
        dbCodes
      );

      expect(result.isValid).toBe(true);
      expect(result.guestName).toBe('Alice Smith');
      expect(result.code).toBe('ALICE1');
      expect(result.email).toBe('alice@example.com');
    });

    it('uses hoisted column Set to avoid allocating a Set per row in validateSingleCsvRow', () => {
      let setConstructorCount = 0;
      const OriginalSet = global.Set;

      // Spy on Set construction during validateSingleCsvRow execution
      const SetSpy = jest.fn().mockImplementation(function (this: unknown, iterable?: Iterable<unknown>) {
        setConstructorCount++;
        return new OriginalSet(iterable);
      });
      (global as unknown as { Set: typeof Set }).Set = SetSpy as unknown as typeof Set;

      try {
        const hoistedMappedCols = new OriginalSet(['Guest Name', 'Code']);
        const freqMap = new Map<string, number>();
        const dbCodes = new OriginalSet<string>();
        const mapping = { guestNameCol: 'Guest Name', codeCol: 'Code' };

        setConstructorCount = 0;
        for (let i = 0; i < 100; i++) {
          validateSingleCsvRow(
            { 'Guest Name': `Guest ${i}`, Code: `CODE${i}` },
            i,
            mapping,
            freqMap,
            dbCodes,
            hoistedMappedCols
          );
        }

        // When hoistedMappedCols is supplied, validateSingleCsvRow does not allocate a Set per row
        expect(setConstructorCount).toBe(0);
      } finally {
        global.Set = OriginalSet;
      }
    });
  });
});

