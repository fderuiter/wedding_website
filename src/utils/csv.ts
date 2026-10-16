export interface ParsedCsvRow {
  rowIndex: number;
  raw: Record<string, string>;
  guestName: string;
  code: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  dietaryNotes?: string;
  plusOneAllocations?: number;
  extraFields?: Record<string, string>;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CsvParseResult {
  headers: string[];
  suggestedGuestNameCol: string;
  suggestedCodeCol: string;
  suggestedEmailCol: string;
  suggestedAddressLine1Col: string;
  suggestedAddressLine2Col: string;
  suggestedCityCol: string;
  suggestedStateCol: string;
  suggestedZipCodeCol: string;
  suggestedCountryCol: string;
  suggestedDietaryNotesCol: string;
  suggestedPlusOneCol: string;
  rows: Record<string, string>[];
}

export interface ColumnMappingOptions {
  guestNameCol: string;
  codeCol?: string;
  emailCol?: string;
  addressLine1Col?: string;
  addressLine2Col?: string;
  cityCol?: string;
  stateCol?: string;
  zipCodeCol?: string;
  countryCol?: string;
  dietaryNotesCol?: string;
  plusOneCol?: string;
  extraCols?: string[];
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
      suggestedEmailCol: '',
      suggestedAddressLine1Col: '',
      suggestedAddressLine2Col: '',
      suggestedCityCol: '',
      suggestedStateCol: '',
      suggestedZipCodeCol: '',
      suggestedCountryCol: '',
      suggestedDietaryNotesCol: '',
      suggestedPlusOneCol: '',
      rows: [],
    };
  }

  const rawHeaders = lines[0].map((h) => h.trim());
  // Ensure non-empty unique headers
  const headerCounts = new Map<string, number>();
  const headers = rawHeaders.map((h, idx) => {
    let base = h ? h : `Column ${idx + 1}`;
    const count = headerCounts.get(base) || 0;
    headerCounts.set(base, count + 1);
    if (count > 0) {
      base = `${base} (${count + 1})`;
    }
    return base;
  });

  let suggestedGuestNameCol = '';
  let suggestedCodeCol = '';
  let suggestedEmailCol = '';
  let suggestedAddressLine1Col = '';
  let suggestedAddressLine2Col = '';
  let suggestedCityCol = '';
  let suggestedStateCol = '';
  let suggestedZipCodeCol = '';
  let suggestedCountryCol = '';
  let suggestedDietaryNotesCol = '';
  let suggestedPlusOneCol = '';

  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (!suggestedGuestNameCol) {
      if (
        lower.includes('guest name') ||
        lower.includes('full name') ||
        lower === 'guest' ||
        lower === 'name' ||
        lower === 'first name'
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
    if (!suggestedEmailCol) {
      if (
        lower.includes('email') ||
        lower.includes('e-mail') ||
        lower.includes('mail address')
      ) {
        suggestedEmailCol = h;
      }
    }
    if (!suggestedAddressLine1Col) {
      if (
        lower.includes('address line 1') ||
        lower.includes('address 1') ||
        lower === 'address' ||
        lower.includes('street address') ||
        lower === 'street' ||
        lower.includes('mailing address')
      ) {
        suggestedAddressLine1Col = h;
      }
    }
    if (!suggestedAddressLine2Col) {
      if (
        lower.includes('address line 2') ||
        lower.includes('address 2') ||
        lower === 'suite' ||
        lower === 'apt' ||
        lower === 'apartment' ||
        lower === 'unit'
      ) {
        suggestedAddressLine2Col = h;
      }
    }
    if (!suggestedCityCol) {
      if (lower === 'city' || lower === 'town' || lower.includes('city')) {
        suggestedCityCol = h;
      }
    }
    if (!suggestedStateCol) {
      if (lower === 'state' || lower === 'province' || lower === 'region' || lower.includes('state')) {
        suggestedStateCol = h;
      }
    }
    if (!suggestedZipCodeCol) {
      if (
        lower.includes('zip') ||
        lower.includes('postal') ||
        lower === 'postcode' ||
        lower === 'zipcode'
      ) {
        suggestedZipCodeCol = h;
      }
    }
    if (!suggestedCountryCol) {
      if (lower === 'country' || lower === 'nation' || lower.includes('country')) {
        suggestedCountryCol = h;
      }
    }
    if (!suggestedDietaryNotesCol) {
      if (
        lower.includes('diet') ||
        lower.includes('dietary') ||
        lower.includes('allerg') ||
        lower.includes('food') ||
        lower.includes('meal') ||
        lower.includes('restriction')
      ) {
        suggestedDietaryNotesCol = h;
      }
    }
    if (!suggestedPlusOneCol) {
      if (
        lower.includes('plus one') ||
        lower.includes('plus-one') ||
        lower.includes('plusone') ||
        lower.includes('+1') ||
        lower.includes('guest count') ||
        lower.includes('max guests') ||
        lower.includes('allocations')
      ) {
        suggestedPlusOneCol = h;
      }
    }
  }

  // Fallback defaults if heuristics didn't match
  if (!suggestedGuestNameCol && headers.length > 0) {
    suggestedGuestNameCol = headers[0];
  }
  if (!suggestedCodeCol && headers.length > 1 && headers[1] !== suggestedGuestNameCol) {
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
    suggestedEmailCol,
    suggestedAddressLine1Col,
    suggestedAddressLine2Col,
    suggestedCityCol,
    suggestedStateCol,
    suggestedZipCodeCol,
    suggestedCountryCol,
    suggestedDietaryNotesCol,
    suggestedPlusOneCol,
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
  columnMappingOrGuestNameCol: string | ColumnMappingOptions,
  codeColOrDbCodes?: string | Set<string>,
  existingDbCodesParam: Set<string> = new Set()
): ParsedCsvRow[] {
  let mapping: ColumnMappingOptions;
  let existingDbCodes: Set<string>;

  if (typeof columnMappingOrGuestNameCol === 'object' && columnMappingOrGuestNameCol !== null) {
    mapping = columnMappingOrGuestNameCol;
    existingDbCodes = codeColOrDbCodes instanceof Set ? codeColOrDbCodes : existingDbCodesParam;
  } else {
    mapping = {
      guestNameCol: columnMappingOrGuestNameCol || '',
      codeCol: typeof codeColOrDbCodes === 'string' ? codeColOrDbCodes : '',
    };
    existingDbCodes = codeColOrDbCodes instanceof Set ? codeColOrDbCodes : existingDbCodesParam;
  }

  const {
    guestNameCol,
    codeCol = '',
    emailCol = '',
    addressLine1Col = '',
    addressLine2Col = '',
    cityCol = '',
    stateCol = '',
    zipCodeCol = '',
    countryCol = '',
    dietaryNotesCol = '',
    plusOneCol = '',
    extraCols,
  } = mapping;

  const codeFrequency = new Map<string, number>();

  // Count code frequencies in batch
  rows.forEach((r) => {
    const rawCode = codeCol ? (r[codeCol] || '').trim().toUpperCase() : '';
    if (rawCode) {
      codeFrequency.set(rawCode, (codeFrequency.get(rawCode) || 0) + 1);
    }
  });

  return rows.map((r, idx) => {
    const guestName = guestNameCol ? (r[guestNameCol] || '').trim() : '';
    const code = codeCol ? (r[codeCol] || '').trim().toUpperCase() : '';
    const email = emailCol ? (r[emailCol] || '').trim() : (r['email'] || r['Email'] || '').trim();
    const addressLine1 = addressLine1Col ? (r[addressLine1Col] || '').trim() : (r['addressLine1'] || r['Address Line 1'] || r['Address'] || '').trim();
    const addressLine2 = addressLine2Col ? (r[addressLine2Col] || '').trim() : (r['addressLine2'] || r['Address Line 2'] || '').trim();
    const city = cityCol ? (r[cityCol] || '').trim() : (r['city'] || r['City'] || '').trim();
    const state = stateCol ? (r[stateCol] || '').trim() : (r['state'] || r['State'] || '').trim();
    const zipCode = zipCodeCol ? (r[zipCodeCol] || '').trim() : (r['zipCode'] || r['Zip Code'] || r['Zip'] || '').trim();
    const country = countryCol ? (r[countryCol] || '').trim() : (r['country'] || r['Country'] || '').trim();
    const dietaryNotes = dietaryNotesCol ? (r[dietaryNotesCol] || '').trim() : (r['dietaryNotes'] || r['Dietary Notes'] || '').trim();
    const rawPlusOne = plusOneCol ? (r[plusOneCol] || '').trim() : (r['plusOneAllocations'] || r['Plus Ones'] || '').trim();

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

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push('Invalid email format.');
      }
    }

    if (addressLine1 && addressLine1.length > 150) {
      errors.push('Address Line 1 must be under 150 characters.');
    }
    if (addressLine2 && addressLine2.length > 150) {
      errors.push('Address Line 2 must be under 150 characters.');
    }
    if (city && city.length > 100) {
      errors.push('City must be under 100 characters.');
    }
    if (state && state.length > 100) {
      errors.push('State must be under 100 characters.');
    }
    if (zipCode && zipCode.length > 20) {
      errors.push('Zip Code must be under 20 characters.');
    }
    if (country && country.length > 100) {
      errors.push('Country must be under 100 characters.');
    }

    let plusOneAllocations: number | undefined = undefined;
    if (rawPlusOne !== '') {
      if (!/^\d+$/.test(rawPlusOne)) {
        errors.push('Plus-one allocation must be a non-negative integer.');
      } else {
        plusOneAllocations = parseInt(rawPlusOne, 10);
      }
    }

    // Collect extra fields
    const extraFields: Record<string, string> = {};
    const mappedCols = new Set([
      guestNameCol,
      codeCol,
      emailCol,
      addressLine1Col,
      addressLine2Col,
      cityCol,
      stateCol,
      zipCodeCol,
      countryCol,
      dietaryNotesCol,
      plusOneCol,
    ].filter(Boolean));

    if (extraCols && Array.isArray(extraCols)) {
      extraCols.forEach((col) => {
        if (r[col] !== undefined && r[col].trim() !== '') {
          extraFields[col] = r[col].trim();
        }
      });
    } else {
      Object.keys(r).forEach((col) => {
        if (!mappedCols.has(col) && r[col] !== undefined && r[col].trim() !== '') {
          extraFields[col] = r[col].trim();
        }
      });
    }

    return {
      rowIndex: idx + 1,
      raw: r,
      guestName,
      code,
      email: email || undefined,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      zipCode: zipCode || undefined,
      country: country || undefined,
      dietaryNotes: dietaryNotes || undefined,
      plusOneAllocations,
      extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  });
}

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsvContent<T extends Record<string, unknown>>(
  records: T[],
  headers?: string[]
): string {
  if (!records || records.length === 0) {
    if (headers && headers.length > 0) {
      return headers.map(escapeCsvCell).join(',') + '\n';
    }
    return '';
  }

  const keys =
    headers && headers.length > 0
      ? headers
      : Array.from(
        records.reduce((acc, rec) => {
          if (rec && typeof rec === 'object') {
            Object.keys(rec).forEach((k) => acc.add(k));
          }
          return acc;
        }, new Set<string>())
      );

  const headerRow = keys.map(escapeCsvCell).join(',');
  const dataRows = records.map((record) =>
    keys.map((key) => escapeCsvCell(record ? record[key] : '')).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
}

