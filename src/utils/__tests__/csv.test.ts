import {
  parseCsvContent,
  parseCsvLines,
  validateCsvRows,
  generateCsvContent,
  escapeCsvCell,
} from '../csv';

describe('CSV Parser Utility', () => {
  it('parses standard CSV lines with quotes and commas', () => {
    const csv = 'Guest Name,Invitation Code\n"Doe, John",CODE123\n"Smith, Jane",CODE456';
    const lines = parseCsvLines(csv);
    expect(lines).toEqual([
      ['Guest Name', 'Invitation Code'],
      ['Doe, John', 'CODE123'],
      ['Smith, Jane', 'CODE456'],
    ]);
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

  it('auto-detects column headers intelligently for multi-column spreadsheets', () => {
    const csv = 'Full Name,Invite Code,Email Address,Dietary Allergies,Plus One Count,Table Group\nJane Doe,JANE12,jane@example.com,Gluten Free,2,VIP Table';
    const parsed = parseCsvContent(csv);
    expect(parsed.suggestedGuestNameCol).toBe('Full Name');
    expect(parsed.suggestedCodeCol).toBe('Invite Code');
    expect(parsed.suggestedEmailCol).toBe('Email Address');
    expect(parsed.suggestedDietaryNotesCol).toBe('Dietary Allergies');
    expect(parsed.suggestedPlusOneCol).toBe('Plus One Count');
  });

  it('disambiguates duplicate CSV headers gracefully', () => {
    const csv = 'Name,Code,Notes,Notes\nAlice,A100,First Note,Second Note';
    const parsed = parseCsvContent(csv);
    expect(parsed.headers).toEqual(['Name', 'Code', 'Notes', 'Notes (2)']);
    expect(parsed.rows[0]['Notes']).toBe('First Note');
    expect(parsed.rows[0]['Notes (2)']).toBe('Second Note');
  });

  it('validates CSV rows highlighting errors, duplicate codes, and warnings', () => {
    const rows = [
      { 'Guest Name': 'Alice', 'Code': 'CODE1' },
      { 'Guest Name': '', 'Code': 'CODE2' },
      { 'Guest Name': 'Bob', 'Code': 'CODE1' },
      { 'Guest Name': 'Charlie', 'Code': '' },
    ];

    const existingDbCodes = new Set(['DBCODE']);
    const validated = validateCsvRows(rows, 'Guest Name', 'Code', existingDbCodes);

    expect(validated[0].isValid).toBe(false);
    expect(validated[0].errors).toContain('Duplicate code "CODE1" within CSV file.');

    expect(validated[1].isValid).toBe(false);
    expect(validated[1].errors).toContain('Guest name is required.');

    expect(validated[2].isValid).toBe(false);
    expect(validated[2].errors).toContain('Duplicate code "CODE1" within CSV file.');

    expect(validated[3].isValid).toBe(true);
    expect(validated[3].warnings).toContain('Blank code: Auto-generated 8-char code will be assigned.');
  });

  it('validates email formats, plus-one counts, and captures extra fields', () => {
    const rows = [
      {
        'Guest Name': 'David',
        'Code': 'DAV100',
        'Email': 'invalid-email',
        'Dietary': 'Nut Allergy',
        'Plus Ones': '-1',
        'Custom Field': 'Extra Data',
      },
      {
        'Guest Name': 'Eve',
        'Code': 'EVE200',
        'Email': 'eve@example.com',
        'Dietary': 'Vegan',
        'Plus Ones': '2',
        'Custom Field': 'Table 5',
      },
    ];

    const validated = validateCsvRows(rows, {
      guestNameCol: 'Guest Name',
      codeCol: 'Code',
      emailCol: 'Email',
      dietaryNotesCol: 'Dietary',
      plusOneCol: 'Plus Ones',
    });

    expect(validated[0].isValid).toBe(false);
    expect(validated[0].errors).toContain('Invalid email format.');
    expect(validated[0].errors).toContain('Plus-one allocation must be a non-negative integer.');

    expect(validated[1].isValid).toBe(true);
    expect(validated[1].email).toBe('eve@example.com');
    expect(validated[1].dietaryNotes).toBe('Vegan');
    expect(validated[1].plusOneAllocations).toBe(2);
    expect(validated[1].extraFields).toEqual({ 'Custom Field': 'Table 5' });
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
});

