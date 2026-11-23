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
export const PHONE_MAX_LENGTH = 30;

export const INVITATION_COLLISION_STRATEGIES = ['skip', 'update', 'reject'] as const;
export type InvitationCollisionStrategy = (typeof INVITATION_COLLISION_STRATEGIES)[number];

/**
 * Pure, client-bundle-safe input shape for batch invitation validation and import.
 */
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
  partial?: boolean;
}

const NULLABLE_INVITATION_STRING_FIELDS = [
  'email',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'country',
  'dietaryNotes',
  'plusOneFirstName',
  'plusOneLastName',
  'householdName',
  'partyGroup',
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_PHONE_PATTERN = /^\+?[\d\s()./-]{7,30}$/;

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

export function validateGuestPhone(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    return 'Invalid phone number format.';
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PHONE_MAX_LENGTH) {
    return `Phone number must be under ${PHONE_MAX_LENGTH} characters.`;
  }
  if (!GUEST_PHONE_PATTERN.test(trimmed)) {
    return 'Invalid phone number format.';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return 'Invalid phone number format.';
  }
  return null;
}

export function normalizeGuestPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d+]/g, '');
  return normalized || null;
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

export function normalizePartialInvitationFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const finalData: Record<string, unknown> = { ...data };

  if (typeof finalData.guestName === 'string') {
    finalData.guestName = finalData.guestName.trim();
  }

  for (const field of NULLABLE_INVITATION_STRING_FIELDS) {
    if (finalData[field] !== undefined) {
      finalData[field] = normalizeNullableString(finalData[field]);
    }
  }

  if (finalData.partyTags !== undefined) {
    finalData.partyTags = Array.isArray(finalData.partyTags)
      ? normalizePartyTags(finalData.partyTags)
      : [];
  }

  return finalData;
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

export function validateInvitationGuestFieldsWithColumns(
  data: unknown,
  options?: InvitationValidationOptions
): { errors: string[]; fieldErrors: Record<string, string[]> } {
  const mode: InvitationValidationMode = options?.mode ?? 'row';
  const rowNumber = options?.rowNumber ?? 1;
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  const pushError = (field: string, message: string) => {
    errors.push(message);
    if (!fieldErrors[field]) {
      fieldErrors[field] = [message];
    } else {
      fieldErrors[field].push(message);
    }
  };

  const isPartial = Boolean(options?.partial);

  if (!isPartial || record.guestName !== undefined) {
    if (!record.guestName || typeof record.guestName !== 'string' || record.guestName.trim() === '') {
      pushError(
        'guestName',
        formatModeMessage(mode, rowNumber, 'Guest name is required.', 'has an empty guest name.')
      );
    }
  }

  if (
    mode === 'service' &&
    record.code !== undefined &&
    (isPartial || record.code !== null) &&
    (typeof record.code !== 'string' || record.code.trim() === '')
  ) {
    pushError('code', 'Validation Error: Code cannot be empty.');
  }

  if (typeof record.email === 'string') {
    const trimmedEmail = record.email.trim();
    if (trimmedEmail !== '' && !EMAIL_REGEX.test(trimmedEmail)) {
      pushError(
        'email',
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
      pushError(
        'plusOneAllocations',
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
      pushError(rule.key, formatModeMessage(mode, rowNumber, baseMsg, rule.batchCustomMessage));
    }
  }

  if (mode === 'service' && record.partyTags !== undefined && record.partyTags !== null) {
    if (!Array.isArray(record.partyTags)) {
      pushError('partyTags', 'Validation Error: Party tags must be an array of strings.');
    }
  }

  if (
    mode === 'service' &&
    record.extraFields &&
    typeof record.extraFields === 'object' &&
    !Array.isArray(record.extraFields)
  ) {
    const extraRecord = record.extraFields as Record<string, unknown>;
    if (extraRecord.phone !== undefined && extraRecord.phone !== null) {
      const phoneErr = validateGuestPhone(extraRecord.phone);
      if (phoneErr) {
        pushError('phone', formatModeMessage(mode, rowNumber, phoneErr));
      }
    }
  }

  return { errors, fieldErrors };
}

export function validateInvitationGuestFields(
  data: unknown,
  options?: InvitationValidationOptions
): string[] {
  return validateInvitationGuestFieldsWithColumns(data, options).errors;
}

interface ExistingGuestMatchCandidate {
  id: string;
  code: string;
  guestName: string;
  email?: string | null;
  householdName?: string | null;
  partyTags?: string[] | null;
}

const ADDRESS_COLLECTION_PARTY_TAG = 'address-collection';

function hasAddressCollectionPartyTag(tags: unknown): boolean {
  return (
    Array.isArray(tags) &&
    tags.some(
      (t) => typeof t === 'string' && t.trim().toLowerCase() === ADDRESS_COLLECTION_PARTY_TAG
    )
  );
}

function disambiguateInvitedCandidate(
  candidates: ReadonlyArray<ExistingGuestMatchCandidate>
): ExistingGuestMatchCandidate | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const invitedOnly = candidates.filter((c) => !hasAddressCollectionPartyTag(c.partyTags));
  return invitedOnly.length === 1 ? invitedOnly[0] : null;
}

type CompositeMatchSource = 'code' | 'email' | 'name_household' | 'unique_name';

interface BatchGuestMatchEntry {
  matchedRecord: ExistingGuestMatchCandidate | null;
  matchedBy: CompositeMatchSource | null;
  ambiguityWarning: string | null;
}

function normalizeMatchText(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMatchEmail(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

/**
 * Resolves batch invitation records against existing DB guests in memory (zero DB calls).
 * - Explicit `code` rows match strictly by normalized uppercase code.
 * - Blank-code rows match by precedence: (1) email, (2) name + household, (3) unique name.
 * - Ambiguous multi-guest matches emit a warning instead of overwriting any record.
 */
export function resolveBatchGuestMatches(
  normalizedRows: ReadonlyArray<NormalizedInvitationCodeRecord>,
  existingDbRecords: ReadonlyArray<ExistingGuestMatchCandidate>
): {
  dbCodeMap: Map<string, ExistingGuestMatchCandidate>;
  matches: BatchGuestMatchEntry[];
} {
  const dbCodeMap = new Map<string, ExistingGuestMatchCandidate>();
  const emailMap = new Map<string, ExistingGuestMatchCandidate[]>();
  const nameHouseholdMap = new Map<string, ExistingGuestMatchCandidate[]>();
  const nameMap = new Map<string, ExistingGuestMatchCandidate[]>();

  for (const rawRec of existingDbRecords) {
    if (!rawRec || !rawRec.code) continue;
    const upperCode = rawRec.code.trim().toUpperCase();
    if (!upperCode) continue;

    const rec: ExistingGuestMatchCandidate = {
      id: rawRec.id,
      code: upperCode,
      guestName: rawRec.guestName || '',
      email: rawRec.email ?? null,
      householdName: rawRec.householdName ?? null,
      ...(rawRec.partyTags !== undefined ? { partyTags: rawRec.partyTags } : {}),
    };
    dbCodeMap.set(upperCode, rec);

    const emailKey = normalizeMatchEmail(rec.email);
    if (emailKey) {
      const bucket = emailMap.get(emailKey);
      if (bucket) bucket.push(rec);
      else emailMap.set(emailKey, [rec]);
    }

    const nameKey = normalizeMatchText(rec.guestName);
    const householdKey = normalizeMatchText(rec.householdName);
    if (nameKey) {
      const nBucket = nameMap.get(nameKey);
      if (nBucket) nBucket.push(rec);
      else nameMap.set(nameKey, [rec]);

      if (householdKey) {
        const nhKey = `${nameKey}||${householdKey}`;
        const nhBucket = nameHouseholdMap.get(nhKey);
        if (nhBucket) nhBucket.push(rec);
        else nameHouseholdMap.set(nhKey, [rec]);
      }
    }
  }

  const matches: BatchGuestMatchEntry[] = normalizedRows.map(() => ({
    matchedRecord: null,
    matchedBy: null,
    ambiguityWarning: null,
  }));

  const claimedDbIds = new Set<string>();
  const tier3Indices: number[] = [];
  const unmatchedBatchNameFreq = new Map<string, number>();

  for (let i = 0; i < normalizedRows.length; i++) {
    const row = normalizedRows[i];
    if (row.code) {
      const codeHit = dbCodeMap.get(row.code);
      if (codeHit) {
        matches[i] = { matchedRecord: codeHit, matchedBy: 'code', ambiguityWarning: null };
        claimedDbIds.add(codeHit.id);
      }
      continue;
    }

    const emailKey = normalizeMatchEmail(row.email);
    const nameKey = normalizeMatchText(row.guestName);
    const householdKey = normalizeMatchText(row.householdName);

    // Tier 1: Email match
    if (emailKey && emailMap.has(emailKey)) {
      const emailCandidates = emailMap.get(emailKey)!;
      if (emailCandidates.length === 1) {
        const hit = emailCandidates[0];
        matches[i] = { matchedRecord: hit, matchedBy: 'email', ambiguityWarning: null };
        claimedDbIds.add(hit.id);
        continue;
      }

      // Disambiguate shared email by name + household, then name, then invited vs address-collection
      let narrowed =
        nameKey && householdKey
          ? emailCandidates.filter(
            (c) =>
              normalizeMatchText(c.guestName) === nameKey &&
                normalizeMatchText(c.householdName) === householdKey
          )
          : [];
      if (narrowed.length !== 1 && nameKey) {
        narrowed = emailCandidates.filter((c) => normalizeMatchText(c.guestName) === nameKey);
      }
      const resolvedEmailHit =
        narrowed.length === 1
          ? narrowed[0]
          : disambiguateInvitedCandidate(narrowed.length > 1 ? narrowed : emailCandidates);
      if (resolvedEmailHit) {
        matches[i] = { matchedRecord: resolvedEmailHit, matchedBy: 'email', ambiguityWarning: null };
        claimedDbIds.add(resolvedEmailHit.id);
        continue;
      }

      matches[i] = {
        matchedRecord: null,
        matchedBy: null,
        ambiguityWarning: `Multiple existing guests share email "${row.email}"; a new invitation code will be generated instead of overwriting.`,
      };
      continue;
    }

    // Tier 2: Name + Household match
    if (nameKey && householdKey) {
      const nhKey = `${nameKey}||${householdKey}`;
      const nhCandidates = nameHouseholdMap.get(nhKey);
      if (nhCandidates && nhCandidates.length > 0) {
        const resolvedNhHit =
          nhCandidates.length === 1 ? nhCandidates[0] : disambiguateInvitedCandidate(nhCandidates);
        if (resolvedNhHit) {
          matches[i] = {
            matchedRecord: resolvedNhHit,
            matchedBy: 'name_household',
            ambiguityWarning: null,
          };
          claimedDbIds.add(resolvedNhHit.id);
          continue;
        }
        matches[i] = {
          matchedRecord: null,
          matchedBy: null,
          ambiguityWarning: `Multiple existing guests named "${row.guestName}" in household "${row.householdName}" found; a new invitation code will be generated instead of overwriting.`,
        };
        continue;
      }
    }

    // Defer to Tier 3: Unique Name match
    if (nameKey) {
      tier3Indices.push(i);
      unmatchedBatchNameFreq.set(nameKey, (unmatchedBatchNameFreq.get(nameKey) || 0) + 1);
    }
  }

  for (const idx of tier3Indices) {
    const row = normalizedRows[idx];
    const nameKey = normalizeMatchText(row.guestName);
    const nameCandidates = nameMap.get(nameKey);
    if (!nameCandidates || nameCandidates.length === 0) {
      continue;
    }

    const singleCandidate =
      nameCandidates.length === 1
        ? nameCandidates[0]
        : disambiguateInvitedCandidate(nameCandidates);

    if (!singleCandidate) {
      matches[idx] = {
        matchedRecord: null,
        matchedBy: null,
        ambiguityWarning: `Multiple existing guests named "${row.guestName}" found without matching email or household; a new invitation code will be generated instead of overwriting.`,
      };
      continue;
    }

    if (claimedDbIds.has(singleCandidate.id)) {
      matches[idx] = {
        matchedRecord: null,
        matchedBy: null,
        ambiguityWarning: `Another row in this import already matched "${singleCandidate.guestName}" (${singleCandidate.code}); a new invitation code will be generated instead of overwriting.`,
      };
      continue;
    }

    if ((unmatchedBatchNameFreq.get(nameKey) || 0) > 1) {
      matches[idx] = {
        matchedRecord: null,
        matchedBy: null,
        ambiguityWarning: `Multiple rows in this import share the name "${row.guestName}" without matching email or household; a new invitation code will be generated instead of overwriting.`,
      };
      continue;
    }

    matches[idx] = {
      matchedRecord: singleCandidate,
      matchedBy: 'unique_name',
      ambiguityWarning: null,
    };
  }

  return { dbCodeMap, matches };
}

export function mergeDietaryNotes(notesList: ReadonlyArray<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const collected: string[] = [];

  for (const raw of notesList) {
    if (typeof raw !== 'string') continue;
    const segments = raw
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const seg of segments) {
      const lower = seg.toLowerCase();
      if (lower === 'none' || lower === 'n/a') continue;
      if (!seen.has(lower)) {
        seen.add(lower);
        collected.push(seg);
      }
    }
  }

  if (collected.length === 0) {
    // Preserve explicit "None" if that was the only non-empty note
    for (const raw of notesList) {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed) return trimmed;
    }
    return null;
  }

  return collected.join('; ');
}

interface MergeableGuestProfile {
  id: string;
  code: string;
  guestName: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  dietaryNotes?: string | null;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  householdName?: string | null;
  partyGroup?: string | null;
  partyTags?: string[] | null;
  extraFields?: Record<string, unknown> | null;
  used?: boolean;
  usedAt?: string | Date | null;
  tableId?: string | null;
  seatNumber?: number | null;
}

/**
 * Computes consolidated fields when merging one or more secondary InvitationCode
 * records into a primary InvitationCode record. Pure and safe for both UI preview and DB service.
 */
export function computeMergedInvitationPreview(
  primary: MergeableGuestProfile,
  secondaries: ReadonlyArray<MergeableGuestProfile>
) {
  const all = [primary, ...secondaries];

  const pickFirstString = (
    getter: (_rec: MergeableGuestProfile) => string | null | undefined
  ): string | null => {
    for (const rec of all) {
      const val = normalizeNullableString(getter(rec));
      if (val) return val;
    }
    return null;
  };

  const maxPlusOnes = all.reduce((max, rec) => {
    const count = typeof rec.plusOneAllocations === 'number' ? rec.plusOneAllocations : 0;
    return count > max ? count : max;
  }, 0);

  const hasInvitedRecord = all.some((rec) => !hasAddressCollectionPartyTag(rec.partyTags));
  const mergedTags = normalizePartyTags(
    all.flatMap((rec) => (Array.isArray(rec.partyTags) ? rec.partyTags : [])),
    { dedupe: true }
  ).filter(
    (tag) => !hasInvitedRecord || tag.trim().toLowerCase() !== ADDRESS_COLLECTION_PARTY_TAG
  );

  const mergedDietary = mergeDietaryNotes(all.map((rec) => rec.dietaryNotes));

  const mergedExtra: Record<string, unknown> = {};
  for (let i = all.length - 1; i >= 0; i--) {
    const ef = all[i].extraFields;
    if (ef && typeof ef === 'object' && !Array.isArray(ef)) {
      for (const [k, v] of Object.entries(ef)) {
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          if (
            k === 'attendanceStatus' &&
            String(v).trim().toLowerCase() === 'pending' &&
            typeof mergedExtra.attendanceStatus === 'string' &&
            mergedExtra.attendanceStatus.trim().toLowerCase() !== 'pending'
          ) {
            continue;
          }
          mergedExtra[k] = v;
        }
      }
    }
  }

  const mergedHouseholdNotes = mergeDietaryNotes(
    all.map((rec) => {
      const ef = rec.extraFields;
      return ef && typeof ef === 'object' && !Array.isArray(ef) && typeof ef.householdNotes === 'string'
        ? ef.householdNotes
        : null;
    })
  );
  if (mergedHouseholdNotes) {
    mergedExtra.householdNotes = mergedHouseholdNotes;
  }

  const used = all.some((rec) => Boolean(rec.used));
  const usedAtSource = all.find((rec) => rec.usedAt !== null && rec.usedAt !== undefined);
  const usedAt = usedAtSource?.usedAt ?? null;

  const resolvedAttendance =
    typeof mergedExtra.attendanceStatus === 'string'
      ? mergedExtra.attendanceStatus.trim().toLowerCase()
      : null;
  const isEligibleForSeating = hasInvitedRecord && resolvedAttendance !== 'declined';

  let tableId: string | null = null;
  let seatNumber: number | null = null;
  if (isEligibleForSeating) {
    tableId = primary.tableId ?? null;
    seatNumber = primary.seatNumber ?? null;
    if (!tableId) {
      const seatedSecondary = secondaries.find((rec) => Boolean(rec.tableId));
      if (seatedSecondary) {
        tableId = seatedSecondary.tableId ?? null;
        seatNumber = seatedSecondary.seatNumber ?? null;
      }
    } else if (seatNumber === null || seatNumber === undefined) {
      const matchingTableSecondary = secondaries.find(
        (rec) => rec.tableId === tableId && typeof rec.seatNumber === 'number'
      );
      if (matchingTableSecondary) {
        seatNumber = matchingTableSecondary.seatNumber ?? null;
      }
    }
  }

  return {
    id: primary.id,
    code: primary.code,
    guestName: primary.guestName.trim() || pickFirstString((r) => r.guestName) || primary.guestName,
    email: pickFirstString((r) => r.email),
    addressLine1: pickFirstString((r) => r.addressLine1),
    addressLine2: pickFirstString((r) => r.addressLine2),
    city: pickFirstString((r) => r.city),
    state: pickFirstString((r) => r.state),
    zipCode: pickFirstString((r) => r.zipCode),
    country: pickFirstString((r) => r.country),
    dietaryNotes: mergedDietary,
    plusOneAllocations: maxPlusOnes,
    plusOneFirstName: pickFirstString((r) => r.plusOneFirstName),
    plusOneLastName: pickFirstString((r) => r.plusOneLastName),
    householdName: pickFirstString((r) => r.householdName),
    partyGroup: pickFirstString((r) => r.partyGroup),
    partyTags: mergedTags,
    extraFields: Object.keys(mergedExtra).length > 0 ? mergedExtra : null,
    used,
    usedAt,
    tableId,
    seatNumber,
  };
}

