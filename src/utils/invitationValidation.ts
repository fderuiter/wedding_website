export const INVITATION_CODE_MAX_LENGTH = 50;
export const GUEST_NAME_MAX_LENGTH = 100;
export const ADDRESS_LINE_MAX_LENGTH = 150;
export const CITY_MAX_LENGTH = 100;
export const STATE_MAX_LENGTH = 100;
export const ZIP_CODE_MAX_LENGTH = 20;
export const COUNTRY_MAX_LENGTH = 100;
export const PLUS_ONE_NAME_MAX_LENGTH = 100;
export const HOUSEHOLD_NAME_MAX_LENGTH = 100;
export const PARTY_GROUP_MAX_LENGTH = 100;

export interface BatchInvitationCodeRecord {
  guestName: string;
  code?: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  dietaryNotes?: string | null;
  plusOneAllocations?: number;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  householdName?: string | null;
  partyGroup?: string | null;
  partyTags?: string[] | string | null;
  extraFields?: Record<string, unknown> | null;
}

export interface NormalizedInvitationCodeRecord {
  guestName: string;
  code: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  dietaryNotes: string | null;
  plusOneAllocations: number | undefined;
  plusOneFirstName: string | null;
  plusOneLastName: string | null;
  householdName: string | null;
  partyGroup: string | null;
  partyTags: string[];
  extraFields: Record<string, unknown> | null;
}

type InvitationValidationMode = 'service' | 'batch' | 'row';

interface InvitationValidationOptions {
  mode?: InvitationValidationMode;
  rowNumber?: number;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LENGTH_FIELD_RULES: ReadonlyArray<{
  key:
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'state'
    | 'zipCode'
    | 'country'
    | 'plusOneFirstName'
    | 'plusOneLastName'
    | 'householdName'
    | 'partyGroup';
  max: number;
  label: string;
  strictStringInService: boolean;
  strictStringInBatch: boolean;
  batchCustomMessage?: string;
}> = [
  { key: 'addressLine1', max: ADDRESS_LINE_MAX_LENGTH, label: 'Address Line 1', strictStringInService: false, strictStringInBatch: false },
  { key: 'addressLine2', max: ADDRESS_LINE_MAX_LENGTH, label: 'Address Line 2', strictStringInService: false, strictStringInBatch: false },
  { key: 'city', max: CITY_MAX_LENGTH, label: 'City', strictStringInService: false, strictStringInBatch: false },
  { key: 'state', max: STATE_MAX_LENGTH, label: 'State', strictStringInService: false, strictStringInBatch: false },
  { key: 'zipCode', max: ZIP_CODE_MAX_LENGTH, label: 'Zip Code', strictStringInService: false, strictStringInBatch: false },
  { key: 'country', max: COUNTRY_MAX_LENGTH, label: 'Country', strictStringInService: false, strictStringInBatch: false },
  {
    key: 'plusOneFirstName',
    max: PLUS_ONE_NAME_MAX_LENGTH,
    label: 'Plus-one first name',
    strictStringInService: true,
    strictStringInBatch: true,
    batchCustomMessage: 'has an invalid plus-one first name.',
  },
  {
    key: 'plusOneLastName',
    max: PLUS_ONE_NAME_MAX_LENGTH,
    label: 'Plus-one last name',
    strictStringInService: true,
    strictStringInBatch: true,
    batchCustomMessage: 'has an invalid plus-one last name.',
  },
  { key: 'householdName', max: HOUSEHOLD_NAME_MAX_LENGTH, label: 'Household name', strictStringInService: true, strictStringInBatch: false },
  { key: 'partyGroup', max: PARTY_GROUP_MAX_LENGTH, label: 'Party group', strictStringInService: true, strictStringInBatch: false },
];

export function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeInvitationCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : '';
}

export function normalizePartyTags(
  value: unknown,
  options?: { dedupe?: boolean }
): string[] {
  if (!value) return [];

  let tags: string[];
  if (Array.isArray(value)) {
    tags = value.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    tags = trimmed.split(',').map((t) => t.trim()).filter(Boolean);
  } else {
    return [];
  }

  if (options?.dedupe && tags.length > 0) {
    return Array.from(new Set(tags));
  }
  return tags;
}

export function normalizeBatchInvitationRecord(
  item: BatchInvitationCodeRecord
): NormalizedInvitationCodeRecord {
  return {
    guestName: typeof item.guestName === 'string' ? item.guestName.trim() : '',
    code: normalizeInvitationCode(item.code),
    email: normalizeNullableString(item.email),
    addressLine1: normalizeNullableString(item.addressLine1),
    addressLine2: normalizeNullableString(item.addressLine2),
    city: normalizeNullableString(item.city),
    state: normalizeNullableString(item.state),
    zipCode: normalizeNullableString(item.zipCode),
    country: normalizeNullableString(item.country),
    dietaryNotes: normalizeNullableString(item.dietaryNotes),
    plusOneAllocations:
      typeof item.plusOneAllocations === 'number' ? item.plusOneAllocations : undefined,
    plusOneFirstName: normalizeNullableString(item.plusOneFirstName),
    plusOneLastName: normalizeNullableString(item.plusOneLastName),
    householdName: normalizeNullableString(item.householdName),
    partyGroup: normalizeNullableString(item.partyGroup),
    partyTags: normalizePartyTags(item.partyTags),
    extraFields:
      item.extraFields &&
      typeof item.extraFields === 'object' &&
      Object.keys(item.extraFields).length > 0
        ? item.extraFields
        : null,
  };
}

function formatModeMessage(
  mode: InvitationValidationMode,
  rowNumber: number,
  plainMessage: string,
  batchMessage?: string
): string {
  if (mode === 'service') {
    return `Validation Error: ${plainMessage}`;
  }
  if (mode === 'batch') {
    return `Validation Error: Row ${rowNumber} ${batchMessage ?? plainMessage}`;
  }
  return plainMessage;
}

export function validateInvitationGuestFields(
  data: unknown,
  options?: InvitationValidationOptions
): string[] {
  const mode: InvitationValidationMode = options?.mode ?? 'row';
  const rowNumber = options?.rowNumber ?? 1;
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const errors: string[] = [];

  if (!record.guestName || typeof record.guestName !== 'string' || record.guestName.trim() === '') {
    errors.push(
      formatModeMessage(mode, rowNumber, 'Guest name is required.', 'has an empty guest name.')
    );
  }

  if (
    mode === 'service' &&
    record.code !== undefined &&
    record.code !== null &&
    (typeof record.code !== 'string' || record.code.trim() === '')
  ) {
    errors.push('Validation Error: Code cannot be empty.');
  }

  if (typeof record.email === 'string') {
    const trimmedEmail = record.email.trim();
    if (trimmedEmail !== '' && !EMAIL_REGEX.test(trimmedEmail)) {
      errors.push(
        formatModeMessage(mode, rowNumber, 'Invalid email format.', 'has an invalid email format.')
      );
    }
  }

  if (record.plusOneAllocations !== undefined && record.plusOneAllocations !== null) {
    if (
      typeof record.plusOneAllocations !== 'number' ||
      !Number.isInteger(record.plusOneAllocations) ||
      record.plusOneAllocations < 0
    ) {
      errors.push(
        formatModeMessage(
          mode,
          rowNumber,
          'Plus-one allocation must be a non-negative integer.',
          'has an invalid plus-one count.'
        )
      );
    }
  }

  for (let i = 0; i < LENGTH_FIELD_RULES.length; i++) {
    const rule = LENGTH_FIELD_RULES[i];
    const val = record[rule.key];
    if (val === undefined || val === null) {
      continue;
    }

    const strictString =
      (mode === 'service' && rule.strictStringInService) ||
      (mode === 'batch' && rule.strictStringInBatch);

    const isInvalid = strictString
      ? typeof val !== 'string' || val.length > rule.max
      : typeof val === 'string' && val.length > rule.max;

    if (isInvalid) {
      const baseMsg = `${rule.label} must be under ${rule.max} characters.`;
      errors.push(formatModeMessage(mode, rowNumber, baseMsg, rule.batchCustomMessage));
    }
  }

  if (mode === 'service' && record.partyTags !== undefined && record.partyTags !== null) {
    if (!Array.isArray(record.partyTags)) {
      errors.push('Validation Error: Party tags must be an array of strings.');
    }
  }

  return errors;
}
