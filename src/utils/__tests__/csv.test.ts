import {
  parseCsvContent,
  parseCsvLines,
  validateCsvRows,
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

  it('auto-detects column headers intelligently', () => {
    const csv = 'Full Name,Passcode,Notes\nJane Doe,JANE12,VIP';
    const parsed = parseCsvContent(csv);
    expect(parsed.suggestedGuestNameCol).toBe('Full Name');
    expect(parsed.suggestedCodeCol).toBe('Passcode');
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
});
