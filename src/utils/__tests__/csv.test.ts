import {
  parseCsvContent,
  detectCsvHeaders,
  combineFirstAndLastName,
  validateSingleCsvRow,
  generateCsvContent,
  escapeCsvCell,
  generateSampleCsvTemplate,
  consolidateHouseholdCsvRows,
  generateFailedRowsCsv,
} from '../csv';
import { formatGuestPlusOneNames, isAddressComplete } from '@/features/registry';
import { getGuestPhone } from '@/features/broadcast';

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

      // Leading whitespace and newline padded formula triggers
      expect(escapeCsvCell(' =1+1')).toBe("' =1+1");
      expect(escapeCsvCell('   +SUM(A1:A5)')).toBe("'   +SUM(A1:A5)");
      expect(escapeCsvCell('  -cmd|"/C calc"!A0')).toBe("\"'  -cmd|\"\"/C calc\"\"!A0\"");
      expect(escapeCsvCell(' @IMPORTXML(A1,B1)')).toBe("\"' @IMPORTXML(A1,B1)\"");
      expect(escapeCsvCell('\n=1+1')).toBe("\"'\n=1+1\"");
      expect(escapeCsvCell('\r\n+1+1')).toBe("\"'\r\n+1+1\"");

      // Padded plain text without formula trigger stays unprefixed with RFC 4180 quoting preserved
      expect(escapeCsvCell('  Warmest congratulations!')).toBe('  Warmest congratulations!');
      expect(escapeCsvCell('  Love, Alice & Bob  ')).toBe('"  Love, Alice & Bob  "');
      expect(escapeCsvCell('\nSo happy for you both!')).toBe('"\nSo happy for you both!"');
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

  describe('consolidateHouseholdCsvRows', () => {
    const baseRow = {
      guestName: '',
      code: '',
      email: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      dietaryNotes: '',
      plusOneAllocations: '0',
      plusOneFirstName: '',
      plusOneLastName: '',
      householdName: '',
      partyGroup: '',
      partyTags: '',
      extraFields: {},
    };

    it('consolidates multi-row households onto one invitation with companion names, allocations, dietary notes, and tags', () => {
      const editableRows = [
        {
          ...baseRow,
          guestName: 'Jane Doe',
          email: 'jane@example.com',
          householdName: 'The Doe Family',
          dietaryNotes: 'Vegetarian',
          partyTags: 'VIP, Bride Side',
          addressLine1: '100 Main St',
          city: 'Boston',
        },
        {
          ...baseRow,
          guestName: 'John Doe',
          householdName: 'the doe family',
          dietaryNotes: 'Nut Allergy; vegetarian',
          partyTags: 'VIP, College',
        },
        {
          ...baseRow,
          guestName: 'Tommy Doe',
          householdName: 'The Doe Family',
          dietaryNotes: 'Dairy Free',
          partyTags: 'Kids',
        },
        {
          ...baseRow,
          guestName: 'Solo Traveler',
          email: 'solo@example.com',
          partyTags: 'Friends',
          addressLine1: '500 Pine Rd',
          city: 'Seattle',
        },
      ];

      const consolidated = consolidateHouseholdCsvRows(editableRows, {
        groupBy: 'householdName',
        rawFirstNames: ['Jane', 'John', 'Tommy', 'Solo'],
        rawLastNames: ['Doe', 'Doe', 'Doe', 'Traveler'],
      });

      expect(consolidated).toHaveLength(2);
      expect(consolidated[0]).toMatchObject({
        guestName: 'Jane Doe',
        email: 'jane@example.com',
        householdName: 'The Doe Family',
        plusOneFirstName: 'John',
        plusOneLastName: 'Doe',
        plusOneAllocations: '2',
        dietaryNotes: 'Vegetarian; Nut Allergy; Dairy Free',
        partyTags: 'VIP, Bride Side, College, Kids',
        addressLine1: '100 Main St',
        city: 'Boston',
        extraFields: { plusOneNames: ['John Doe', 'Tommy Doe'] },
      });
      expect(formatGuestPlusOneNames(consolidated[0])).toBe('John Doe, Tommy Doe');

      expect(consolidated[1]).toMatchObject({
        guestName: 'Solo Traveler',
        email: 'solo@example.com',
        plusOneAllocations: '0',
        partyTags: 'Friends',
        city: 'Seattle',
      });
    });

    it('supports partyGroup consolidation and splits companion full names when rawFirstNames are omitted', () => {
      const editableRows = [
        { ...baseRow, guestName: 'Alex Rivera', partyGroup: 'Rivera Couple', dietaryNotes: 'Gluten-Free' },
        { ...baseRow, guestName: 'Sam Rivera', partyGroup: 'Rivera Couple', dietaryNotes: 'Vegan' },
      ];

      const consolidated = consolidateHouseholdCsvRows(editableRows, {
        groupBy: 'partyGroup',
      });

      expect(consolidated).toHaveLength(1);
      expect(consolidated[0]).toMatchObject({
        guestName: 'Alex Rivera',
        partyGroup: 'Rivera Couple',
        plusOneFirstName: 'Sam',
        plusOneLastName: 'Rivera',
        plusOneAllocations: '1',
        dietaryNotes: 'Gluten-Free; Vegan',
      });
    });
  });

  describe('generateFailedRowsCsv', () => {
    it('exports failed rows with Validation Errors column and neutralizes CSV formula injection payloads', () => {
      const csv = generateFailedRowsCsv(
        [
          {
            row: {
              guestName: '=cmd|"/C calc"!A0',
              code: '+BADCODE',
              email: '@malicious-email',
              householdName: '-Household',
              partyGroup: '\tTabGroup',
              partyTags: 'VIP',
              dietaryNotes: '\rCRNote',
              plusOneAllocations: '-2',
              plusOneFirstName: '',
              plusOneLastName: '',
              addressLine1: '123 St',
              addressLine2: '',
              city: 'Boston',
              state: 'MA',
              zipCode: '02101',
              country: 'USA',
              extraFields: { TablePref: '=HYPERLINK("http://evil.example")' },
            },
            errors: ['Invalid email format.', 'Plus-one allocation must be a non-negative integer.'],
          },
        ],
        ['TablePref']
      );

      const lines = csv.split('\n');
      expect(lines[0]).toContain('Guest Name,Invitation Code,Email');
      expect(lines[0]).toContain('TablePref,Validation Errors');
      // Formula-prefixed cells must be escaped with leading single quote
      expect(csv).toContain('\'=cmd|""/C calc""!A0');
      expect(csv).toContain("'+BADCODE");
      expect(csv).toContain("'@malicious-email");
      expect(csv).toContain("'-Household");
      expect(csv).toContain("'\tTabGroup");
      expect(csv).toContain('\'=HYPERLINK(""http://evil.example"")');
      expect(csv).toContain(
        'Invalid email format.; Plus-one allocation must be a non-negative integer.'
      );
    });
  });

  describe('phoneCol, plusOneNameCol, and Meal Selections header contracts', () => {
    it('detects Phone Number and Plus-One Name while excluding Meal Selections from suggestedDietaryNotesCol', () => {
      const exportedHeaders = [
        'Guest Name',
        'Invitation Code',
        'RSVP Link',
        'Email',
        'Phone Number',
        'Plus-One Name',
        'Household Name',
        'Party Group',
        'Party Tags',
        'Address Line 1',
        'Address Line 2',
        'City',
        'State',
        'ZIP Code',
        'Country',
        'Meal Selections',
        'Custom Answers',
      ];
      const detected = detectCsvHeaders(exportedHeaders);

      expect(detected.suggestedPhoneCol).toBe('Phone Number');
      expect(detected.suggestedPlusOneNameCol).toBe('Plus-One Name');
      expect(detected.suggestedDietaryNotesCol).toBe('');
      expect(detected.suggestedAddressLine1Col).toBe('Address Line 1');
      expect(detected.suggestedAddressLine2Col).toBe('Address Line 2');
      expect(detected.suggestedCityCol).toBe('City');
      expect(detected.suggestedStateCol).toBe('State');
      expect(detected.suggestedZipCodeCol).toBe('ZIP Code');
      expect(detected.suggestedCountryCol).toBe('Country');
    });

    it('validates and normalizes phoneCol (including formula-escaped E.164) into extraFields.phone and splits Plus-One Name', () => {
      const validRow = validateSingleCsvRow(
        {
          'Guest Name': 'Clara Oswald',
          'Invitation Code': 'CLARA26',
          'Phone Number': "'+1 (555) 234-5678",
          'Plus-One Name': 'Danny Pink, Rupert Pink',
          'Address Line 1': '123 Clara Ln',
          City: 'London',
          State: 'LDN',
          'ZIP Code': 'SW1A',
          Country: 'UK',
        },
        0,
        {
          guestNameCol: 'Guest Name',
          codeCol: 'Invitation Code',
          phoneCol: 'Phone Number',
          plusOneNameCol: 'Plus-One Name',
          addressLine1Col: 'Address Line 1',
          cityCol: 'City',
          stateCol: 'State',
          zipCodeCol: 'ZIP Code',
          countryCol: 'Country',
          extraCols: [],
        },
        new Map([['CLARA26', 1]]),
        new Set()
      );

      expect(validRow.isValid).toBe(true);
      expect(validRow.extraFields).toEqual({
        phone: '+15552345678',
        plusOneNames: ['Danny Pink', 'Rupert Pink'],
      });
      expect(validRow.plusOneFirstName).toBe('Danny');
      expect(validRow.plusOneLastName).toBe('Pink');
      expect(validRow.plusOneAllocations).toBeUndefined();
      expect(getGuestPhone(validRow)).toBe('+15552345678');
      expect(isAddressComplete(validRow)).toBe(true);
      expect(formatGuestPlusOneNames(validRow)).toBe('Danny Pink, Rupert Pink');

      const invalidPhoneRow = validateSingleCsvRow(
        {
          'Guest Name': 'Bad Phone Guest',
          'Phone Number': 'not-a-phone',
        },
        0,
        {
          guestNameCol: 'Guest Name',
          phoneCol: 'Phone Number',
          extraCols: [],
        },
        new Map(),
        new Set()
      );

      expect(invalidPhoneRow.isValid).toBe(false);
      expect(invalidPhoneRow.fieldErrors?.phone).toContain('Invalid phone number format.');
    });
  });
});

