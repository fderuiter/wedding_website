import {
  parseCsvContent,
  detectCsvHeaders,
  combineFirstAndLastName,
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

  it('auto-detects split guest first and last name headers from Joy exports and avoids setting suggestedGuestNameCol', () => {
    const csv = 'First Name,Last Name,Invitation Code,Email\nJane,Doe,JANE12,jane@example.com';
    const parsed = parseCsvContent(csv);
    expect(parsed.suggestedGuestFirstNameCol).toBe('First Name');
    expect(parsed.suggestedGuestLastNameCol).toBe('Last Name');
    expect(parsed.guestFirstNameCol).toBe('First Name');
    expect(parsed.guestLastNameCol).toBe('Last Name');
    expect(parsed.suggestedGuestNameCol).toBe('');
    expect(parsed.suggestedCodeCol).toBe('Invitation Code');
    expect(parsed.suggestedEmailCol).toBe('Email');
  });

  it('auto-detects alternative split name header variations', () => {
    const headers1 = ['Guest First Name', 'Guest Last Name', 'Code'];
    const detected1 = detectCsvHeaders(headers1);
    expect(detected1.suggestedGuestFirstNameCol).toBe('Guest First Name');
    expect(detected1.suggestedGuestLastNameCol).toBe('Guest Last Name');
    expect(detected1.suggestedGuestNameCol).toBe('');

    const headers2 = ['Given Name', 'Surname', 'Code'];
    const detected2 = detectCsvHeaders(headers2);
    expect(detected2.suggestedGuestFirstNameCol).toBe('Given Name');
    expect(detected2.suggestedGuestLastNameCol).toBe('Surname');
    expect(detected2.suggestedGuestNameCol).toBe('');

    const headers3 = ['First', 'Last', 'Passcode'];
    const detected3 = detectCsvHeaders(headers3);
    expect(detected3.suggestedGuestFirstNameCol).toBe('First');
    expect(detected3.suggestedGuestLastNameCol).toBe('Last');
    expect(detected3.suggestedGuestNameCol).toBe('');
  });

  it('disambiguates split guest names from companion and plus-one name columns', () => {
    const csv = 'First Name,Last Name,Plus One First Name,Plus One Last Name,Code\nJohn,Smith,Jack,Smith,CODE1';
    const parsed = parseCsvContent(csv);
    expect(parsed.suggestedGuestFirstNameCol).toBe('First Name');
    expect(parsed.suggestedGuestLastNameCol).toBe('Last Name');
    expect(parsed.suggestedPlusOneFirstNameCol).toBe('Plus One First Name');
    expect(parsed.suggestedPlusOneLastNameCol).toBe('Plus One Last Name');
    expect(parsed.suggestedGuestNameCol).toBe('');
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
      expect(escapeCsvCell(undefined)).toBe('');
      expect(escapeCsvCell(42)).toBe('42');
      expect(escapeCsvCell(0)).toBe('0');
      expect(escapeCsvCell(true)).toBe('true');
      expect(escapeCsvCell(false)).toBe('false');
    });

    it('neutralizes formula trigger characters (=, +, -, @, tab, carriage return) with a prepended single quote', () => {
      // Basic formula triggers
      expect(escapeCsvCell('=1+1')).toBe("'=1+1");
      expect(escapeCsvCell('+123456789')).toBe("'+123456789");
      expect(escapeCsvCell('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
      expect(escapeCsvCell('@SUM(B1:B5)')).toBe("'@SUM(B1:B5)");
      expect(escapeCsvCell('\tTabIndented')).toBe("'\tTabIndented");
      expect(escapeCsvCell('\rCarriageReturn')).toBe("\"'\rCarriageReturn\"");

      // Formula triggers combined with commas, quotes, and line breaks
      expect(escapeCsvCell('=cmd|"/C calc"!A0')).toBe("\"'=cmd|\"\"/C calc\"\"!A0\"");
      expect(escapeCsvCell('+1,234.56')).toBe("\"'+1,234.56\"");
      expect(escapeCsvCell('-foo\nbar')).toBe("\"'-foo\nbar\"");
      expect(escapeCsvCell('@org,"test"')).toBe("\"'@org,\"\"test\"\"\"");
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

    it('neutralizes formula injection characters across records generated by generateCsvContent', () => {
      const records = [
        { 'Guest Name': '=cmd|"/C calc"!A0', Code: '+12345', Notes: '-alert(1)', Role: '@admin' },
        { 'Guest Name': '\tTabGuest', Code: '\rCRGuest', Notes: 'Normal Note', Role: 'Member' },
      ];
      const csv = generateCsvContent(records);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Guest Name,Code,Notes,Role');
      expect(lines[1]).toBe('"\'=cmd|""/C calc""!A0",\'+12345,\'-alert(1),\'@admin');
      expect(lines[2]).toBe("'\tTabGuest,\"'\rCRGuest\",Normal Note,Member");
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

    it('concatenates split first and last names into guestName when single name mapping is absent', () => {
      const row = {
        'First Name': 'Jane',
        'Last Name': 'Doe',
        Code: 'JANE12',
      };
      const freqMap = new Map([['JANE12', 1]]);
      const dbCodes = new Set<string>();

      const result = validateSingleCsvRow(
        row,
        0,
        { guestFirstNameCol: 'First Name', guestLastNameCol: 'Last Name', codeCol: 'Code' },
        freqMap,
        dbCodes
      );

      expect(result.isValid).toBe(true);
      expect(result.guestName).toBe('Jane Doe');
      expect(result.errors).toHaveLength(0);
    });

    it('handles rows with only a first name or only a last name gracefully', () => {
      const freqMap = new Map();
      const dbCodes = new Set<string>();
      const mapping = { guestFirstNameCol: 'First Name', guestLastNameCol: 'Last Name' };

      const onlyFirst = validateSingleCsvRow(
        { 'First Name': 'Cher', 'Last Name': '' },
        0,
        mapping,
        freqMap,
        dbCodes
      );
      expect(onlyFirst.guestName).toBe('Cher');

      const onlyLast = validateSingleCsvRow(
        { 'First Name': '', 'Last Name': 'Madonna' },
        1,
        mapping,
        freqMap,
        dbCodes
      );
      expect(onlyLast.guestName).toBe('Madonna');
    });

    it('trims whitespace and avoids duplicate inner spaces during concatenation', () => {
      const freqMap = new Map();
      const dbCodes = new Set<string>();
      const mapping = { guestFirstNameCol: 'First Name', guestLastNameCol: 'Last Name' };

      const result = validateSingleCsvRow(
        { 'First Name': '   Mary    Ann   ', 'Last Name': '   Smith   ' },
        0,
        mapping,
        freqMap,
        dbCodes
      );
      expect(result.guestName).toBe('Mary Ann Smith');
    });

    it('adds guestFirstNameCol and guestLastNameCol to mapped columns to prevent unmapped extra fields', () => {
      const row = {
        'First Name': 'John',
        'Last Name': 'Doe',
        'Custom Note': 'Vegetarian meal requested',
      };
      const freqMap = new Map();
      const dbCodes = new Set<string>();

      const result = validateSingleCsvRow(
        row,
        0,
        { guestFirstNameCol: 'First Name', guestLastNameCol: 'Last Name' },
        freqMap,
        dbCodes
      );

      expect(result.extraFields).toEqual({
        'Custom Note': 'Vegetarian meal requested',
      });
      expect(result.extraFields).not.toHaveProperty('First Name');
      expect(result.extraFields).not.toHaveProperty('Last Name');
    });

    it('prioritizes guestNameCol when explicitly provided', () => {
      const row = {
        'Full Name': 'Dr. John Doe',
        'First Name': 'John',
        'Last Name': 'Doe',
      };
      const freqMap = new Map();
      const dbCodes = new Set<string>();

      const result = validateSingleCsvRow(
        row,
        0,
        { guestNameCol: 'Full Name', guestFirstNameCol: 'First Name', guestLastNameCol: 'Last Name' },
        freqMap,
        dbCodes
      );

      expect(result.guestName).toBe('Dr. John Doe');
    });

    it('maps row validation errors to individual columns in fieldErrors', () => {
      const freqMap = new Map([['DUP100', 2]]);
      const dbCodes = new Set<string>();

      const result = validateSingleCsvRow(
        {
          'Guest Name': '',
          Code: 'DUP100',
          Email: 'not-an-email',
          'Plus Ones': '-2',
        },
        0,
        {
          guestNameCol: 'Guest Name',
          codeCol: 'Code',
          emailCol: 'Email',
          plusOneCol: 'Plus Ones',
        },
        freqMap,
        dbCodes
      );

      expect(result.isValid).toBe(false);
      expect(result.fieldErrors).toEqual({
        guestName: ['Guest name is required.'],
        email: ['Invalid email format.'],
        plusOneAllocations: ['Plus-one allocation must be a non-negative integer.'],
        code: ['Duplicate code "DUP100" within CSV file.'],
      });
    });
  });

  describe('combineFirstAndLastName', () => {
    it('combines first and last name with a single space', () => {
      expect(combineFirstAndLastName('John', 'Doe')).toBe('John Doe');
    });

    it('handles only first name or only last name', () => {
      expect(combineFirstAndLastName('Alice', '')).toBe('Alice');
      expect(combineFirstAndLastName('', 'Smith')).toBe('Smith');
      expect(combineFirstAndLastName('Bob', undefined)).toBe('Bob');
      expect(combineFirstAndLastName(undefined, 'Jones')).toBe('Jones');
    });

    it('normalizes multiple spaces and trims', () => {
      expect(combineFirstAndLastName('   Mary    Jane   ', '   Watson   ')).toBe('Mary Jane Watson');
    });

    it('returns empty string when both are empty or undefined', () => {
      expect(combineFirstAndLastName('', '')).toBe('');
      expect(combineFirstAndLastName(undefined, undefined)).toBe('');
      expect(combineFirstAndLastName('   ', '   ')).toBe('');
    });
  });
});

