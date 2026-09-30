export interface ParsedCsvRow {
  rowIndex: number;
  raw: Record<string, string>;
  guestName: string;
  code: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CsvParseResult {
  headers: string[];
  suggestedGuestNameCol: string;
  suggestedCodeCol: string;
  rows: Record<string, string>[];
}

export const MAX_CSV_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export function parseCsvContent(text: string): CsvParseResult {
  // Strip UTF-8 BOM if present
  let sanitizedText = text;
  if (sanitizedText.charCodeAt(0) === 0xfeff) {
    sanitizedText = sanitizedText.slice(1);
  }

  const lines = parseCsvLines(sanitizedText);
  if (lines.length === 0) {
    return {
      headers: [],
      suggestedGuestNameCol: '',
      suggestedCodeCol: '',
      rows: [],
    };
  }

  const rawHeaders = lines[0].map((h) => h.trim());
  // Ensure non-empty unique headers
  const headers = rawHeaders.map((h, idx) => (h ? h : `Column ${idx + 1}`));

  let suggestedGuestNameCol = '';
  let suggestedCodeCol = '';

  for (const h of headers) {
    const lower = h.toLowerCase();
    if (!suggestedGuestNameCol) {
      if (
        lower.includes('guest name') ||
        lower.includes('full name') ||
        lower === 'guest' ||
        lower === 'name'
      ) {
        suggestedGuestNameCol = h;
      }
    }
    if (!suggestedCodeCol) {
      if (
        lower.includes('invitation code') ||
        lower.includes('invite code') ||
        lower === 'code' ||
        lower === 'passcode'
      ) {
        suggestedCodeCol = h;
      }
    }
  }

  // Fallback defaults if heuristics didn't match
  if (!suggestedGuestNameCol && headers.length > 0) {
    suggestedGuestNameCol = headers[0];
  }
  if (!suggestedCodeCol && headers.length > 1) {
    suggestedCodeCol = headers[1];
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines
    if (line.length === 0 || (line.length === 1 && line[0].trim() === '')) {
      continue;
    }

    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = line[idx] !== undefined ? line[idx].trim() : '';
    });
    rows.push(rowObj);
  }

  return {
    headers,
    suggestedGuestNameCol,
    suggestedCodeCol,
    rows,
  };
}

export function parseCsvLines(text: string): string[][] {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentField);
        result.push(currentRow);
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField);
        result.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    result.push(currentRow);
  }

  return result;
}

export function validateCsvRows(
  rows: Record<string, string>[],
  guestNameCol: string,
  codeCol: string,
  existingDbCodes: Set<string> = new Set()
): ParsedCsvRow[] {
  const codeFrequency = new Map<string, number>();

  // Count code frequencies in batch
  rows.forEach((r) => {
    const rawCode = (r[codeCol] || '').trim().toUpperCase();
    if (rawCode) {
      codeFrequency.set(rawCode, (codeFrequency.get(rawCode) || 0) + 1);
    }
  });

  return rows.map((r, idx) => {
    const guestName = (r[guestNameCol] || '').trim();
    const code = (r[codeCol] || '').trim().toUpperCase();

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!guestName) {
      errors.push('Guest name is required.');
    }

    if (code) {
      if ((codeFrequency.get(code) || 0) > 1) {
        errors.push(`Duplicate code "${code}" within CSV file.`);
      } else if (existingDbCodes.has(code)) {
        warnings.push(`Code "${code}" already exists in database.`);
      }
    } else {
      warnings.push('Blank code: Auto-generated 8-char code will be assigned.');
    }

    return {
      rowIndex: idx + 1,
      raw: r,
      guestName,
      code,
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  });
}
