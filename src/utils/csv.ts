import {
  PLUS_ONE_NAME_MAX_LENGTH,
  mergeDietaryNotes,
  normalizeGuestPhone,
  normalizeInvitationCode,
  normalizePartyTags,
  sanitizeGuestPhoneInput,
  validateInvitationGuestFieldsWithColumns,
} from './invitationValidation';

export interface ParsedCsvRow {
  rowIndex: number;
  raw: Record<string, string>;
  guestName: string;
  code: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  dietaryNotes?: string;
  plusOneAllocations?: number;
  plusOneFirstName?: string;
  plusOneLastName?: string;
  householdName?: string;
  partyGroup?: string;
  partyTags?: string[];
  extraFields?: Record<string, string | string[]>;
  isValid: boolean;
  errors: string[];
  fieldErrors?: Record<string, string[]>;
  warnings: string[];
}

export interface CsvParseResult {
  headers: string[];
  suggestedGuestNameCol: string;
  suggestedGuestFirstNameCol?: string;
  suggestedGuestLastNameCol?: string;
  guestFirstNameCol?: string;
  guestLastNameCol?: string;
  suggestedCodeCol: string;
  suggestedEmailCol: string;
  suggestedPhoneCol?: string;
  suggestedAddressLine1Col: string;
  suggestedAddressLine2Col: string;
  suggestedCityCol: string;
  suggestedStateCol: string;
  suggestedZipCodeCol: string;
  suggestedCountryCol: string;
  suggestedDietaryNotesCol: string;
  suggestedPlusOneCol: string;
  suggestedPlusOneNameCol?: string;
  suggestedPlusOneFirstNameCol?: string;
  suggestedPlusOneLastNameCol?: string;
  suggestedHouseholdNameCol?: string;
  suggestedPartyGroupCol?: string;
  suggestedPartyTagsCol?: string;
  rows: Record<string, string>[];
}

export interface ColumnMappingOptions {
  guestNameCol?: string;
  guestFirstNameCol?: string;
  guestLastNameCol?: string;
  codeCol?: string;
  emailCol?: string;
  phoneCol?: string;
  addressLine1Col?: string;
  addressLine2Col?: string;
  cityCol?: string;
  stateCol?: string;
  zipCodeCol?: string;
  countryCol?: string;
  dietaryNotesCol?: string;
  plusOneCol?: string;
  plusOneNameCol?: string;
  plusOneFirstNameCol?: string;
  plusOneLastNameCol?: string;
  householdNameCol?: string;
  partyGroupCol?: string;
  partyTagsCol?: string;
  extraCols?: string[];
}

export const MAX_CSV_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export function combineFirstAndLastName(firstName?: string, lastName?: string): string {
  const cleanFirst = (firstName || '').trim().replace(/\s+/g, ' ');
  const cleanLast = (lastName || '').trim().replace(/\s+/g, ' ');
  return [cleanFirst, cleanLast].filter(Boolean).join(' ').trim();
}

export function detectCsvHeaders(headers: string[]): {
  suggestedGuestNameCol: string;
  suggestedGuestFirstNameCol: string;
  suggestedGuestLastNameCol: string;
  guestFirstNameCol: string;
  guestLastNameCol: string;
  suggestedCodeCol: string;
  suggestedEmailCol: string;
  suggestedPhoneCol: string;
  suggestedAddressLine1Col: string;
  suggestedAddressLine2Col: string;
  suggestedCityCol: string;
  suggestedStateCol: string;
  suggestedZipCodeCol: string;
  suggestedCountryCol: string;
  suggestedDietaryNotesCol: string;
  suggestedPlusOneCol: string;
  suggestedPlusOneNameCol: string;
  suggestedPlusOneFirstNameCol: string;
  suggestedPlusOneLastNameCol: string;
  suggestedHouseholdNameCol: string;
  suggestedPartyGroupCol: string;
  suggestedPartyTagsCol: string;
} {
  let suggestedGuestNameCol = '';
  let suggestedGuestFirstNameCol = '';
  let suggestedGuestLastNameCol = '';
  let suggestedCodeCol = '';
  let suggestedEmailCol = '';
  let suggestedPhoneCol = '';
  let suggestedAddressLine1Col = '';
  let suggestedAddressLine2Col = '';
  let suggestedCityCol = '';
  let suggestedStateCol = '';
  let suggestedZipCodeCol = '';
  let suggestedCountryCol = '';
  let suggestedDietaryNotesCol = '';
  let suggestedPlusOneCol = '';
  let suggestedPlusOneNameCol = '';
  let suggestedPlusOneFirstNameCol = '';
  let suggestedPlusOneLastNameCol = '';
  let suggestedHouseholdNameCol = '';
  let suggestedPartyGroupCol = '';
  let suggestedPartyTagsCol = '';

  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    const isPlusOne =
      lower.includes('plus one') ||
      lower.includes('plus-one') ||
      lower.includes('plusone') ||
      lower.includes('+1') ||
      lower.includes('companion') ||
      lower.includes('guest 2') ||
      lower.includes('guest2');

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
    if (!suggestedGuestFirstNameCol && !isPlusOne) {
      if (
        lower === 'first name' ||
        lower === 'first' ||
        lower === 'firstname' ||
        lower === 'given name' ||
        lower === 'givenname' ||
        lower === 'forename' ||
        lower.includes('guest first name') ||
        lower.includes('guest first') ||
        lower.includes('first name') ||
        lower.includes('given name')
      ) {
        suggestedGuestFirstNameCol = h;
      }
    }
    if (!suggestedGuestLastNameCol && !isPlusOne) {
      if (
        lower === 'last name' ||
        lower === 'last' ||
        lower === 'lastname' ||
        lower === 'surname' ||
        lower.includes('guest last name') ||
        lower.includes('guest last') ||
        lower.includes('last name') ||
        lower.includes('surname')
      ) {
        suggestedGuestLastNameCol = h;
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
    if (!suggestedPhoneCol) {
      if (
        lower.includes('phone') ||
        lower.includes('mobile') ||
        lower.includes('cell') ||
        lower.includes('telephone') ||
        lower === 'tel' ||
        lower.includes('sms')
      ) {
        suggestedPhoneCol = h;
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
      const isMealSelectionHeader =
        lower.includes('meal selection') ||
        lower.includes('meal choice') ||
        lower.includes('meal option') ||
        lower.includes('meal summary') ||
        lower === 'meal' ||
        lower === 'meals';
      if (
        !isMealSelectionHeader &&
        (lower.includes('diet') ||
          lower.includes('dietary') ||
          lower.includes('allerg') ||
          lower.includes('food') ||
          lower.includes('meal') ||
          lower.includes('restriction'))
      ) {
        suggestedDietaryNotesCol = h;
      }
    }
    if (!suggestedPlusOneNameCol) {
      if (
        (lower === 'plus-one name' ||
          lower === 'plus one name' ||
          lower === 'plusone name' ||
          lower === 'plus-one names' ||
          lower === 'plus one names' ||
          lower === '+1 name' ||
          lower === '+1 names' ||
          lower === 'companion name' ||
          lower === 'companion names' ||
          lower === 'guest 2 name' ||
          lower === 'guest2 name') &&
        !lower.includes('first') &&
        !lower.includes('last')
      ) {
        suggestedPlusOneNameCol = h;
      }
    }
    if (!suggestedPlusOneFirstNameCol) {
      if (
        lower.includes('plus-one first name') ||
        lower.includes('plus one first name') ||
        lower.includes('plusone first name') ||
        lower.includes('plus-one first') ||
        lower.includes('plus one first') ||
        lower.includes('companion first name') ||
        lower.includes('guest 2 first name')
      ) {
        suggestedPlusOneFirstNameCol = h;
      }
    }
    if (!suggestedPlusOneLastNameCol) {
      if (
        lower.includes('plus-one last name') ||
        lower.includes('plus one last name') ||
        lower.includes('plusone last name') ||
        lower.includes('plus-one last') ||
        lower.includes('plus one last') ||
        lower.includes('companion last name') ||
        lower.includes('guest 2 last name')
      ) {
        suggestedPlusOneLastNameCol = h;
      }
    }
    if (!suggestedPlusOneCol) {
      if (
        (lower.includes('plus one') ||
          lower.includes('plus-one') ||
          lower.includes('plusone') ||
          lower.includes('+1') ||
          lower.includes('guest count') ||
          lower.includes('max guests') ||
          lower.includes('allocations')) &&
        !lower.includes('first') &&
        !lower.includes('last') &&
        !lower.includes('name')
      ) {
        suggestedPlusOneCol = h;
      }
    }
    if (!suggestedHouseholdNameCol) {
      if (
        lower.includes('household') ||
        lower.includes('family name')
      ) {
        suggestedHouseholdNameCol = h;
      }
    }
    if (!suggestedPartyGroupCol) {
      if (
        lower.includes('party group') ||
        lower.includes('party side') ||
        lower.includes('family side') ||
        lower === 'side' ||
        lower === 'party'
      ) {
        suggestedPartyGroupCol = h;
      }
    }
    if (!suggestedPartyTagsCol) {
      if (
        lower.includes('party tags') ||
        lower.includes('party tag') ||
        lower === 'tags' ||
        lower === 'tag' ||
        lower.includes('guest tags')
      ) {
        suggestedPartyTagsCol = h;
      }
    }
  }

  // Fallback defaults if heuristics didn't match
  if (!suggestedGuestNameCol && !suggestedGuestFirstNameCol && headers.length > 0) {
    suggestedGuestNameCol = headers[0];
  }
  const claimedNonCodeCols = new Set(
    [
      suggestedGuestNameCol,
      suggestedGuestFirstNameCol,
      suggestedGuestLastNameCol,
      suggestedEmailCol,
      suggestedPhoneCol,
      suggestedAddressLine1Col,
      suggestedAddressLine2Col,
      suggestedCityCol,
      suggestedStateCol,
      suggestedZipCodeCol,
      suggestedCountryCol,
      suggestedDietaryNotesCol,
      suggestedPlusOneCol,
      suggestedPlusOneNameCol,
      suggestedPlusOneFirstNameCol,
      suggestedPlusOneLastNameCol,
      suggestedHouseholdNameCol,
      suggestedPartyGroupCol,
      suggestedPartyTagsCol,
    ].filter(Boolean)
  );
  if (
    !suggestedCodeCol &&
    headers.length > 1 &&
    !claimedNonCodeCols.has(headers[1])
  ) {
    suggestedCodeCol = headers[1];
  }

  return {
    suggestedGuestNameCol,
    suggestedGuestFirstNameCol,
    suggestedGuestLastNameCol,
    guestFirstNameCol: suggestedGuestFirstNameCol,
    guestLastNameCol: suggestedGuestLastNameCol,
    suggestedCodeCol,
    suggestedEmailCol,
    suggestedPhoneCol,
    suggestedAddressLine1Col,
    suggestedAddressLine2Col,
    suggestedCityCol,
    suggestedStateCol,
    suggestedZipCodeCol,
    suggestedCountryCol,
    suggestedDietaryNotesCol,
    suggestedPlusOneCol,
    suggestedPlusOneNameCol,
    suggestedPlusOneFirstNameCol,
    suggestedPlusOneLastNameCol,
    suggestedHouseholdNameCol,
    suggestedPartyGroupCol,
    suggestedPartyTagsCol,
  };
}

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
      suggestedGuestFirstNameCol: '',
      suggestedGuestLastNameCol: '',
      guestFirstNameCol: '',
      guestLastNameCol: '',
      suggestedCodeCol: '',
      suggestedEmailCol: '',
      suggestedPhoneCol: '',
      suggestedAddressLine1Col: '',
      suggestedAddressLine2Col: '',
      suggestedCityCol: '',
      suggestedStateCol: '',
      suggestedZipCodeCol: '',
      suggestedCountryCol: '',
      suggestedDietaryNotesCol: '',
      suggestedPlusOneCol: '',
      suggestedPlusOneNameCol: '',
      suggestedPlusOneFirstNameCol: '',
      suggestedPlusOneLastNameCol: '',
      suggestedHouseholdNameCol: '',
      suggestedPartyGroupCol: '',
      suggestedPartyTagsCol: '',
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

  const detected = detectCsvHeaders(headers);

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
    ...detected,
    rows,
  };
}

function parseCsvLines(text: string): string[][] {
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

export function validateSingleCsvRow(
  r: Record<string, string>,
  idx: number,
  mapping: ColumnMappingOptions,
  codeFrequency: Map<string, number>,
  existingDbCodes: Set<string>,
  mappedColsSet?: Set<string>
): ParsedCsvRow {
  const {
    guestNameCol = '',
    guestFirstNameCol = '',
    guestLastNameCol = '',
    codeCol = '',
    emailCol = '',
    phoneCol = '',
    addressLine1Col = '',
    addressLine2Col = '',
    cityCol = '',
    stateCol = '',
    zipCodeCol = '',
    countryCol = '',
    dietaryNotesCol = '',
    plusOneCol = '',
    plusOneNameCol = '',
    plusOneFirstNameCol = '',
    plusOneLastNameCol = '',
    householdNameCol = '',
    partyGroupCol = '',
    partyTagsCol = '',
    extraCols,
  } = mapping;

  const mappedCols =
    mappedColsSet ||
    new Set(
      [
        guestNameCol,
        guestFirstNameCol,
        guestLastNameCol,
        codeCol,
        emailCol,
        phoneCol,
        addressLine1Col,
        addressLine2Col,
        cityCol,
        stateCol,
        zipCodeCol,
        countryCol,
        dietaryNotesCol,
        plusOneCol,
        plusOneNameCol,
        plusOneFirstNameCol,
        plusOneLastNameCol,
        householdNameCol,
        partyGroupCol,
        partyTagsCol,
      ].filter(Boolean)
    );

  let guestName = guestNameCol ? (r[guestNameCol] || '').trim() : '';
  if (!guestNameCol) {
    const firstName = guestFirstNameCol
      ? (r[guestFirstNameCol] || '').trim()
      : (r['guestFirstName'] || r['First Name'] || r['Guest First Name'] || '').trim();
    const lastName = guestLastNameCol
      ? (r[guestLastNameCol] || '').trim()
      : (r['guestLastName'] || r['Last Name'] || r['Guest Last Name'] || '').trim();
    if (firstName || lastName) {
      guestName = combineFirstAndLastName(firstName, lastName);
    }
  }
  const code = codeCol ? normalizeInvitationCode(r[codeCol]) : '';
  const email = emailCol ? (r[emailCol] || '').trim() : (r['email'] || r['Email'] || '').trim();
  const rawPhone = sanitizeGuestPhoneInput(
    phoneCol
      ? r[phoneCol]
      : (r['phone'] ?? r['Phone Number'] ?? r['Phone'] ?? r['Mobile'] ?? r['phoneNumber'] ?? '')
  );
  const addressLine1 = addressLine1Col ? (r[addressLine1Col] || '').trim() : (r['addressLine1'] || r['Address Line 1'] || r['Address'] || '').trim();
  const addressLine2 = addressLine2Col ? (r[addressLine2Col] || '').trim() : (r['addressLine2'] || r['Address Line 2'] || '').trim();
  const city = cityCol ? (r[cityCol] || '').trim() : (r['city'] || r['City'] || '').trim();
  const state = stateCol ? (r[stateCol] || '').trim() : (r['state'] || r['State'] || '').trim();
  const zipCode = zipCodeCol ? (r[zipCodeCol] || '').trim() : (r['zipCode'] || r['Zip Code'] || r['Zip'] || '').trim();
  const country = countryCol ? (r[countryCol] || '').trim() : (r['country'] || r['Country'] || '').trim();
  const dietaryNotes = dietaryNotesCol ? (r[dietaryNotesCol] || '').trim() : (r['dietaryNotes'] || r['Dietary Notes'] || '').trim();
  const rawPlusOne = plusOneCol ? (r[plusOneCol] || '').trim() : (r['plusOneAllocations'] || r['Plus Ones'] || '').trim();
  let plusOneFirstName = plusOneFirstNameCol ? (r[plusOneFirstNameCol] || '').trim() : (r['plusOneFirstName'] || r['Plus-One First Name'] || r['Plus One First Name'] || '').trim();
  let plusOneLastName = plusOneLastNameCol ? (r[plusOneLastNameCol] || '').trim() : (r['plusOneLastName'] || r['Plus-One Last Name'] || r['Plus One Last Name'] || '').trim();
  const rawPlusOneFullName = plusOneNameCol
    ? (r[plusOneNameCol] || '').trim()
    : (r['plusOneName'] || r['Plus-One Name'] || r['Plus One Name'] || '').trim();
  let parsedPlusOneNames: string[] | undefined;
  if (rawPlusOneFullName) {
    const parsedCompanion = parsePlusOneNameCell(rawPlusOneFullName);
    if (!plusOneFirstName && !plusOneLastName) {
      plusOneFirstName = parsedCompanion.firstName;
      plusOneLastName = parsedCompanion.lastName;
    }
    if (parsedCompanion.plusOneNames && parsedCompanion.plusOneNames.length > 0) {
      parsedPlusOneNames = parsedCompanion.plusOneNames;
    }
  }
  const householdName = householdNameCol ? (r[householdNameCol] || '').trim() : (r['householdName'] || r['Household Name'] || r['Household'] || '').trim();
  const partyGroup = partyGroupCol ? (r[partyGroupCol] || '').trim() : (r['partyGroup'] || r['Party Group'] || r['Party Side'] || r['Family Side'] || r['Side'] || '').trim();
  const rawPartyTags = partyTagsCol ? (r[partyTagsCol] || '').trim() : (r['partyTags'] || r['Party Tags'] || r['Tags'] || '').trim();
  const partyTags = normalizePartyTags(rawPartyTags, { dedupe: true });

  const plusOneAllocations =
    rawPlusOne !== '' && /^\d+$/.test(rawPlusOne) ? parseInt(rawPlusOne, 10) : undefined;
  const { errors, fieldErrors } = validateInvitationGuestFieldsWithColumns(
    {
      guestName,
      code: codeCol ? r[codeCol] : undefined,
      email,
      plusOneAllocations: rawPlusOne === '' ? undefined : (plusOneAllocations ?? NaN),
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      country,
      plusOneFirstName,
      plusOneLastName,
      householdName,
      partyGroup,
      extraFields: rawPhone ? { phone: rawPhone } : undefined,
    },
    { mode: 'row' }
  );
  const warnings: string[] = [];

  if (code) {
    if ((codeFrequency.get(code) || 0) > 1) {
      const dupMsg = `Duplicate code "${code}" within CSV file.`;
      errors.push(dupMsg);
      if (!fieldErrors.code) {
        fieldErrors.code = [dupMsg];
      } else {
        fieldErrors.code.push(dupMsg);
      }
    } else if (existingDbCodes.has(code)) {
      warnings.push(`Code "${code}" already exists in database.`);
    }
  } else {
    warnings.push('Blank code: Auto-generated 8-char code will be assigned.');
  }

  // Collect extra fields
  const extraFields: Record<string, string | string[]> = {};

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

  const normalizedPhone =
    rawPhone && !fieldErrors.phone ? normalizeGuestPhone(rawPhone) || undefined : undefined;
  if (normalizedPhone) {
    extraFields.phone = normalizedPhone;
  }
  if (parsedPlusOneNames && parsedPlusOneNames.length > 0) {
    extraFields.plusOneNames = parsedPlusOneNames;
  }

  return {
    rowIndex: idx + 1,
    raw: r,
    guestName,
    code,
    email: email || undefined,
    phone: normalizedPhone ?? (rawPhone || undefined),
    addressLine1: addressLine1 || undefined,
    addressLine2: addressLine2 || undefined,
    city: city || undefined,
    state: state || undefined,
    zipCode: zipCode || undefined,
    country: country || undefined,
    dietaryNotes: dietaryNotes || undefined,
    plusOneAllocations,
    plusOneFirstName: plusOneFirstName || undefined,
    plusOneLastName: plusOneLastName || undefined,
    householdName: householdName || undefined,
    partyGroup: partyGroup || undefined,
    partyTags: partyTags.length > 0 ? partyTags : undefined,
    extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined,
    isValid: errors.length === 0,
    errors,
    fieldErrors: errors.length > 0 ? fieldErrors : undefined,
    warnings,
  };
}

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
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

export function generateSampleCsvTemplate(): string {
  const sampleRows = [
    {
      'Guest Name': 'Jane Doe',
      'Invitation Code': 'WED2026-JANE',
      Email: 'jane.doe@example.com',
      'Household Name': 'Doe Family',
      'Party Group': 'Bride',
      'Party Tags': 'VIP, Rehearsal Dinner',
      'Dietary Notes': 'Vegetarian',
      'Plus-One Allocations': 1,
    },
    {
      'Guest Name': 'John Smith',
      'Invitation Code': 'WED2026-JOHN',
      Email: 'john.smith@example.com',
      'Household Name': 'Smith Family',
      'Party Group': 'Groom',
      'Party Tags': 'VIP',
      'Dietary Notes': 'None',
      'Plus-One Allocations': 0,
    },
    {
      'Guest Name': 'Alex Johnson',
      'Invitation Code': '',
      Email: 'alex.johnson@example.com',
      'Household Name': 'Johnson Family',
      'Party Group': 'Joint',
      'Party Tags': 'Local',
      'Dietary Notes': 'Gluten-Free',
      'Plus-One Allocations': 2,
    },
  ];

  return generateCsvContent(sampleRows, [
    'Guest Name',
    'Invitation Code',
    'Email',
    'Household Name',
    'Party Group',
    'Party Tags',
    'Dietary Notes',
    'Plus-One Allocations',
  ]);
}

export interface EditableCsvRow {
  guestName: string;
  code: string;
  email: string;
  phone?: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  dietaryNotes: string;
  plusOneAllocations: string;
  plusOneFirstName: string;
  plusOneLastName: string;
  householdName: string;
  partyGroup: string;
  partyTags: string;
  extraFields: Record<string, string | string[]>;
}

export interface FailedCsvExportRow {
  row: EditableCsvRow;
  errors: string[];
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    return {
      firstName: parts[0].slice(0, PLUS_ONE_NAME_MAX_LENGTH),
      lastName: '',
    };
  }
  return {
    firstName: parts[0].slice(0, PLUS_ONE_NAME_MAX_LENGTH),
    lastName: parts.slice(1).join(' ').slice(0, PLUS_ONE_NAME_MAX_LENGTH),
  };
}

export function parsePlusOneNameCell(rawValue: string): {
  firstName: string;
  lastName: string;
  plusOneNames?: string[];
} {
  const names = rawValue
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((part) => part.slice(0, PLUS_ONE_NAME_MAX_LENGTH * 2));
  if (names.length === 0) {
    return { firstName: '', lastName: '' };
  }
  const firstSplit = splitFullName(names[0]);
  return {
    firstName: firstSplit.firstName,
    lastName: firstSplit.lastName,
    plusOneNames: names.length > 1 ? names : undefined,
  };
}

/**
 * Consolidates mapped CSV rows sharing a non-empty `householdName` or `partyGroup`
 * onto a single invitation row in memory (zero DB calls).
 */
export function consolidateHouseholdCsvRows(
  rows: EditableCsvRow[],
  options: {
    groupBy: 'householdName' | 'partyGroup';
    rawFirstNames?: string[];
    rawLastNames?: string[];
  }
): EditableCsvRow[] {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return rows;
  }

  type GroupBucket = {
    indices: number[];
    items: EditableCsvRow[];
  };

  const orderedEntries: Array<{ type: 'single'; row: EditableCsvRow } | { type: 'group'; key: string }> = [];
  const buckets = new Map<string, GroupBucket>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawGroupVal = row[options.groupBy] || '';
    const normKey = rawGroupVal.trim().replace(/\s+/g, ' ').toLowerCase();

    if (!normKey) {
      orderedEntries.push({ type: 'single', row });
      continue;
    }

    const existing = buckets.get(normKey);
    if (existing) {
      existing.indices.push(i);
      existing.items.push(row);
    } else {
      buckets.set(normKey, { indices: [i], items: [row] });
      orderedEntries.push({ type: 'group', key: normKey });
    }
  }

  const consolidated: EditableCsvRow[] = [];

  for (const entry of orderedEntries) {
    if (entry.type === 'single') {
      consolidated.push(entry.row);
      continue;
    }

    const bucket = buckets.get(entry.key)!;
    if (bucket.items.length === 1) {
      consolidated.push(bucket.items[0]);
      continue;
    }

    const [primary, ...companions] = bucket.items;
    const [, ...companionIndices] = bucket.indices;

    const pickFirst = (getter: (_r: EditableCsvRow) => string): string => {
      for (const item of bucket.items) {
        const val = (getter(item) || '').trim();
        if (val) return val;
      }
      return '';
    };

    let plusOneFirstName = primary.plusOneFirstName.trim();
    let plusOneLastName = primary.plusOneLastName.trim();
    let extraCompanionStartIdx = 0;

    if (!plusOneFirstName && !plusOneLastName && companions.length > 0) {
      const firstCompIdx = companionIndices[0];
      const explicitFirst = (options.rawFirstNames?.[firstCompIdx] || '').trim();
      const explicitLast = (options.rawLastNames?.[firstCompIdx] || '').trim();
      if (explicitFirst || explicitLast) {
        plusOneFirstName = explicitFirst.slice(0, PLUS_ONE_NAME_MAX_LENGTH);
        plusOneLastName = explicitLast.slice(0, PLUS_ONE_NAME_MAX_LENGTH);
      } else {
        const split = splitFullName(companions[0].guestName);
        plusOneFirstName = split.firstName;
        plusOneLastName = split.lastName;
      }
      extraCompanionStartIdx = 1;
    }

    // Preserve all consolidated companion names in extraFields.plusOneNames
    const allCompanionNames: string[] = [];
    const primaryCompanionFullName = combineFirstAndLastName(plusOneFirstName, plusOneLastName);
    if (primaryCompanionFullName) {
      allCompanionNames.push(primaryCompanionFullName);
    }
    if (extraCompanionStartIdx === 1 && (companions[0].plusOneFirstName || companions[0].plusOneLastName)) {
      const compPlusOne = combineFirstAndLastName(
        companions[0].plusOneFirstName,
        companions[0].plusOneLastName
      );
      if (compPlusOne) allCompanionNames.push(compPlusOne);
    }
    for (let c = extraCompanionStartIdx; c < companions.length; c++) {
      const compName = companions[c].guestName.trim().replace(/\s+/g, ' ');
      if (compName) allCompanionNames.push(compName);
      const compPlusOne = combineFirstAndLastName(
        companions[c].plusOneFirstName,
        companions[c].plusOneLastName
      );
      if (compPlusOne) allCompanionNames.push(compPlusOne);
    }

    // Allocations: preserve malformed string if any; else Math.max(sum of explicit allocations, allCompanionNames.length, companions.length)
    let malformedAlloc: string | null = null;
    let explicitSum = 0;
    for (const item of bucket.items) {
      const raw = (item.plusOneAllocations || '').trim();
      if (raw === '') continue;
      if (!/^\d+$/.test(raw)) {
        malformedAlloc = raw;
        break;
      }
      explicitSum += parseInt(raw, 10);
    }
    const resolvedAllocations =
      malformedAlloc !== null
        ? malformedAlloc
        : String(Math.max(explicitSum, allCompanionNames.length, companions.length));

    const mergedDietary = mergeDietaryNotes(bucket.items.map((item) => item.dietaryNotes)) || '';
    const mergedTags = normalizePartyTags(
      bucket.items
        .map((item) => item.partyTags)
        .filter(Boolean)
        .join(','),
      { dedupe: true }
    ).join(', ');

    const mergedExtra: Record<string, string | string[]> = {};
    const existingPlusOneNames: string[] = [];
    for (let k = bucket.items.length - 1; k >= 0; k--) {
      const ef = bucket.items[k].extraFields;
      if (ef) {
        for (const [fieldKey, fieldVal] of Object.entries(ef)) {
          if (fieldKey === 'additionalGuests') {
            continue;
          }
          if (fieldKey === 'plusOneNames' && Array.isArray(fieldVal)) {
            for (const n of fieldVal) {
              if (typeof n === 'string' && n.trim()) {
                existingPlusOneNames.push(n.trim());
              }
            }
            continue;
          }
          if (typeof fieldVal === 'string' && fieldVal.trim()) {
            mergedExtra[fieldKey] = fieldVal.trim();
          }
        }
      }
    }

    for (const existingName of existingPlusOneNames) {
      if (!allCompanionNames.includes(existingName)) {
        allCompanionNames.push(existingName);
      }
    }

    if (allCompanionNames.length > 0) {
      mergedExtra.plusOneNames = allCompanionNames;
    }

    const consolidatedPhone = pickFirst((r) =>
      sanitizeGuestPhoneInput(
        r.phone ?? (typeof r.extraFields?.phone === 'string' ? r.extraFields.phone : '')
      )
    );

    const consolidatedRow: EditableCsvRow = {
      guestName: primary.guestName.trim() || pickFirst((r) => r.guestName),
      code: pickFirst((r) => r.code),
      email: pickFirst((r) => r.email),
      addressLine1: pickFirst((r) => r.addressLine1),
      addressLine2: pickFirst((r) => r.addressLine2),
      city: pickFirst((r) => r.city),
      state: pickFirst((r) => r.state),
      zipCode: pickFirst((r) => r.zipCode),
      country: pickFirst((r) => r.country),
      dietaryNotes: mergedDietary,
      plusOneAllocations: resolvedAllocations,
      plusOneFirstName,
      plusOneLastName,
      householdName: pickFirst((r) => r.householdName),
      partyGroup: pickFirst((r) => r.partyGroup),
      partyTags: mergedTags,
      extraFields: mergedExtra,
    };
    if (consolidatedPhone) {
      consolidatedRow.phone = consolidatedPhone;
    }

    consolidated.push(consolidatedRow);
  }

  return consolidated;
}

const FAILED_ROWS_STANDARD_HEADERS = [
  'Guest Name',
  'Invitation Code',
  'Email',
  'Phone Number',
  'Address Line 1',
  'Address Line 2',
  'City',
  'State',
  'ZIP Code',
  'Country',
  'Dietary Notes',
  'Plus-One Allocations',
  'Plus-One First Name',
  'Plus-One Last Name',
  'Household Name',
  'Party Group',
  'Party Tags',
] as const;

/**
 * Generates a UTF-8 CSV string of skipped/invalid rows with a `Validation Errors` column,
 * sanitizing every cell via `generateCsvContent` -> `escapeCsvCell` to prevent CSV formula injection.
 */
export function generateFailedRowsCsv(
  failedRows: ReadonlyArray<FailedCsvExportRow>,
  extraCols: ReadonlyArray<string> = []
): string {
  const dynamicExtraCols = Array.from(
    new Set([
      ...extraCols,
      ...failedRows.flatMap((entry) => Object.keys(entry.row.extraFields || {})),
    ])
  ).filter(
    (col) =>
      col !== 'Validation Errors' &&
      col !== 'phone' &&
      col !== 'plusOneNames' &&
      !(FAILED_ROWS_STANDARD_HEADERS as readonly string[]).includes(col)
  );

  const headers = [...FAILED_ROWS_STANDARD_HEADERS, ...dynamicExtraCols, 'Validation Errors'];

  const records = failedRows.map(({ row, errors }) => {
    const phoneCell =
      row.phone || (typeof row.extraFields?.phone === 'string' ? row.extraFields.phone : '');
    const rec: Record<string, unknown> = {
      'Guest Name': row.guestName,
      'Invitation Code': row.code,
      Email: row.email,
      'Phone Number': phoneCell,
      'Address Line 1': row.addressLine1,
      'Address Line 2': row.addressLine2,
      'City': row.city,
      State: row.state,
      'ZIP Code': row.zipCode,
      Country: row.country,
      'Dietary Notes': row.dietaryNotes,
      'Plus-One Allocations': row.plusOneAllocations,
      'Plus-One First Name': row.plusOneFirstName,
      'Plus-One Last Name': row.plusOneLastName,
      'Household Name': row.householdName,
      'Party Group': row.partyGroup,
      'Party Tags': row.partyTags,
    };
    for (const col of dynamicExtraCols) {
      const val = row.extraFields?.[col];
      rec[col] = Array.isArray(val) ? val.join(', ') : (val ?? '');
    }
    rec['Validation Errors'] = errors.join('; ');
    return rec;
  });

  return generateCsvContent(records, headers);
}


