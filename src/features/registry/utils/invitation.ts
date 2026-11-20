import crypto from 'crypto';

export type AttendanceStatus = 'attending' | 'declined' | 'pending';

export interface AttendanceStatusItem {
  used?: boolean | null;
  isAttending?: boolean | null;
  extraFields?: Record<string, any> | string | null;
}

export interface AddressItem {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

const STANDARD_DIETARY_TAG_SET = new Set([
  'gluten-free',
  'gf',
  'vegetarian',
  'vegan',
  'dairy-free',
  'df',
  'nut-free',
]);

function parseExtraFieldsObject(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  return null;
}

/**
 * Extracts normalized lowercase dietary tags from a tag array, InvitationCode.extraFields,
 * or an item containing extraFields / mealSelections.
 */
export function extractDietaryTags(source?: unknown): string[] {
  if (!source) return [];

  const collected: string[] = [];
  const pushTag = (val: unknown) => {
    if (typeof val !== 'string') return;
    const normalized = val.trim().toLowerCase();
    if (normalized && !collected.includes(normalized)) {
      collected.push(normalized);
    }
  };

  if (Array.isArray(source)) {
    source.forEach(pushTag);
    return collected;
  }

  const record = parseExtraFieldsObject(source);
  if (!record) return [];

  const extra =
    record.extraFields !== undefined ? parseExtraFieldsObject(record.extraFields) ?? record : record;

  if (Array.isArray(extra.dietaryTags)) {
    extra.dietaryTags.forEach(pushTag);
  }

  if (Array.isArray(extra.mealSelections)) {
    for (const entry of extra.mealSelections) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      if (Array.isArray(obj.dietaryTags)) {
        obj.dietaryTags.forEach(pushTag);
      }
      if (Array.isArray(obj.selections)) {
        for (const sel of obj.selections) {
          if (sel && typeof sel === 'object' && Array.isArray((sel as Record<string, unknown>).dietaryTags)) {
            ((sel as Record<string, unknown>).dietaryTags as unknown[]).forEach(pushTag);
          }
        }
      }
    }
  }

  return collected;
}

/**
 * Evaluates whether guest dietary notes or structured meal dietary tags match a given category filter.
 * An empty or 'all' category returns true immediately before inspecting notes or tags.
 */
export function matchDietaryCategory(
  notes: string | null | undefined,
  category?: string | null,
  structuredSource?: unknown
): boolean {
  if (!category || category === 'all') return true;

  const normalizedCategory = category.trim().toLowerCase();
  const hasNotes = Boolean(notes && notes.trim());
  const lower = hasNotes ? notes!.trim().toLowerCase() : '';
  const allTags = extractDietaryTags(structuredSource);
  const restrictionTags = allTags.filter((tag) => tag !== 'kids');

  if (normalizedCategory === 'kids') {
    return allTags.includes('kids') || /\b(kid|kids|child|children)\b/i.test(lower);
  }

  if (!hasNotes && restrictionTags.length === 0) return false;

  const notesGlutenFree = hasNotes && /\b(gf|gluten[- ]free|gluten)\b/i.test(lower);
  const notesVegan = hasNotes && /\b(vegan)\b/i.test(lower);
  const notesVegetarian = hasNotes && /\b(vegetarian|veg)\b/i.test(lower) && !notesVegan;
  const notesDairyFree = hasNotes && /\b(df|dairy[- ]free|dairy|lactose)\b/i.test(lower);
  const notesNutFree = hasNotes && /\b(nut[- ]free|nut|nuts|peanut|allergy|allergies)\b/i.test(lower);
  const notesOther =
    hasNotes &&
    !notesGlutenFree &&
    !notesVegan &&
    !notesVegetarian &&
    !notesDairyFree &&
    !notesNutFree;

  const tagGlutenFree =
    restrictionTags.includes('gluten-free') || restrictionTags.includes('gf');
  const tagVegan = restrictionTags.includes('vegan');
  const tagVegetarian = restrictionTags.includes('vegetarian');
  const tagDairyFree =
    restrictionTags.includes('dairy-free') || restrictionTags.includes('df');
  const tagNutFree = restrictionTags.includes('nut-free');
  const tagOther = restrictionTags.some((tag) => !STANDARD_DIETARY_TAG_SET.has(tag));

  switch (normalizedCategory) {
    case 'gluten-free':
      return notesGlutenFree || tagGlutenFree;
    case 'vegetarian':
      return notesVegetarian || tagVegetarian;
    case 'vegan':
      return notesVegan || tagVegan;
    case 'dairy-free':
      return notesDairyFree || tagDairyFree;
    case 'nut-free':
      return notesNutFree || tagNutFree;
    case 'other':
      return notesOther || tagOther;
    case 'has_restriction':
      return hasNotes || restrictionTags.length > 0;
    default:
      return restrictionTags.includes(normalizedCategory) || hasNotes;
  }
}

/**
 * Derives guest RSVP attendance status ('attending', 'declined', or 'pending').
 * Checks extraFields values first; falls back to item.used (or legacy isAttending) flag.
 */
export function getAttendanceStatus(item: AttendanceStatusItem): AttendanceStatus {
  const extra = parseExtraFieldsObject(item.extraFields);
  const rawVal =
    extra?.attendanceStatus ??
    extra?.rsvpStatus ??
    extra?.attendance ??
    extra?.rsvp ??
    extra?.attending ??
    extra?.status;

  if (rawVal !== undefined && rawVal !== null) {
    if (typeof rawVal === 'boolean') {
      return rawVal ? 'attending' : 'declined';
    }
    if (typeof rawVal === 'string') {
      const val = rawVal.trim().toLowerCase();
      if (['attending', 'accepted', 'yes', 'confirmed', 'true'].includes(val)) {
        return 'attending';
      }
      if (['declined', 'no', 'rejected', 'false'].includes(val)) {
        return 'declined';
      }
      if (['pending'].includes(val)) {
        return 'pending';
      }
    }
  }

  if (typeof item.used === 'boolean') {
    return item.used ? 'attending' : 'pending';
  }
  if (typeof item.isAttending === 'boolean') {
    return item.isAttending ? 'attending' : 'declined';
  }

  return 'pending';
}

/**
 * Formats guest attendance status as a human-readable CSV label.
 */
export function formatAttendanceLabel(item: AttendanceStatusItem): string {
  const status = getAttendanceStatus(item);
  if (status === 'attending') return 'Attending';
  if (status === 'declined') return 'Declined';
  return 'Pending';
}

/**
 * Formats guest plus-one names from synced JSONB extraFields or legacy first/last name columns.
 */
export function formatGuestPlusOneNames(item: {
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  extraFields?: unknown;
}): string {
  const extra = parseExtraFieldsObject(item.extraFields);
  if (extra && Array.isArray(extra.plusOneNames)) {
    const names = extra.plusOneNames
      .filter((val): val is string => typeof val === 'string')
      .map((val) => val.trim())
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(', ');
    }
  }
  return [item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ').trim();
}

/**
 * Formats guest entrée selections across attending sub-events for CSV exports.
 */
export function formatGuestMealSelections(item: { extraFields?: unknown }): string {
  const extra = parseExtraFieldsObject(item.extraFields);
  if (!extra) return '';

  if (typeof extra.mealSummary === 'string' && extra.mealSummary.trim()) {
    return extra.mealSummary.trim();
  }

  if (Array.isArray(extra.mealSelections)) {
    const multipleEvents = extra.mealSelections.length > 1;
    const segments: string[] = [];
    for (const entry of extra.mealSelections) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const eventTitle = typeof obj.subEventTitle === 'string' ? obj.subEventTitle.trim() : '';
      if (Array.isArray(obj.selections)) {
        const selParts = obj.selections
          .map((sel) => {
            if (!sel || typeof sel !== 'object') return '';
            const s = sel as Record<string, unknown>;
            const attendee = typeof s.attendee === 'string' ? s.attendee.trim() : '';
            const label = typeof s.label === 'string' ? s.label.trim() : '';
            const tags = Array.isArray(s.dietaryTags)
              ? s.dietaryTags.filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
              : [];
            if (!label) return '';
            const tagSuffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
            return attendee ? `${attendee}: ${label}${tagSuffix}` : `${label}${tagSuffix}`;
          })
          .filter(Boolean);
        if (selParts.length > 0) {
          const joined = selParts.join('; ');
          segments.push(multipleEvents && eventTitle ? `${eventTitle} - ${joined}` : joined);
        }
      }
    }
    return segments.join(' | ');
  }

  return '';
}

/**
 * Formats guest custom RSVP question answers across attending sub-events for CSV exports.
 */
export function formatGuestCustomAnswers(item: { extraFields?: unknown }): string {
  const extra = parseExtraFieldsObject(item.extraFields);
  if (!extra) return '';

  if (typeof extra.customAnswersSummary === 'string' && extra.customAnswersSummary.trim()) {
    return extra.customAnswersSummary.trim();
  }

  if (Array.isArray(extra.customAnswers)) {
    const multipleEvents = extra.customAnswers.length > 1;
    const segments: string[] = [];
    for (const entry of extra.customAnswers) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const eventTitle = typeof obj.subEventTitle === 'string' ? obj.subEventTitle.trim() : '';
      if (Array.isArray(obj.answers)) {
        const ansParts = obj.answers
          .map((ans) => {
            if (!ans || typeof ans !== 'object') return '';
            const a = ans as Record<string, unknown>;
            const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
            const answer = typeof a.answer === 'string' ? a.answer.trim() : '';
            if (!answer) return '';
            return prompt ? `${prompt}: ${answer}` : answer;
          })
          .filter(Boolean);
        if (ansParts.length > 0) {
          const joined = ansParts.join('; ');
          segments.push(multipleEvents && eventTitle ? `${eventTitle} - ${joined}` : joined);
        }
      }
    }
    return segments.join(' | ');
  }

  return '';
}

/**
 * Checks whether address contains all standard required fields
 * (addressLine1, city, state, zipCode).
 */
export function isAddressComplete(item?: AddressItem | null): boolean {
  return Boolean(
    item?.addressLine1?.trim() &&
      item?.city?.trim() &&
      item?.state?.trim() &&
      item?.zipCode?.trim()
  );
}

/**
 * Generates an eight-character cryptographically random alphanumeric string using uppercase characters and numbers.
 */
export function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return result;
}

