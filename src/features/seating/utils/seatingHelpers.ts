import {
  getAttendanceStatus,
  matchDietaryCategory,
  type AttendanceStatus,
} from '@/features/registry';

export const ADDRESS_COLLECTION_TAG = 'address-collection';

export interface DietaryBadgeInfo {
  category:
    | 'gluten-free'
    | 'vegan'
    | 'vegetarian'
    | 'dairy-free'
    | 'nut-free'
    | 'kids'
    | 'other';
  shortLabel: string;
  label: string;
}

export interface SeatingGuestCandidate {
  guestName?: string | null;
  used?: boolean | null;
  extraFields?: unknown;
  partyTags?: unknown;
  dietaryNotes?: string | null;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  subEventRsvps?: Array<{
    status?: string | null;
    plusOneCount?: number | null;
    plusOneNames?: unknown;
  }> | null;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function normalizeExtraFields(extraFields: unknown): Record<string, unknown> | null {
  if (!extraFields) return null;
  if (typeof extraFields === 'string') {
    try {
      const parsed = JSON.parse(extraFields);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof extraFields === 'object' && !Array.isArray(extraFields)) {
    return extraFields as Record<string, unknown>;
  }
  return null;
}

/**
 * Checks whether a guest record carries the public `address-collection` tag.
 */
export function hasAddressCollectionTag(partyTags: unknown): boolean {
  return (
    Array.isArray(partyTags) &&
    partyTags.some(
      (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === ADDRESS_COLLECTION_TAG
    )
  );
}

/**
 * Safely derives guest attendance status ('attending' | 'declined' | 'pending')
 * via the public `@/features/registry` barrel helper.
 */
export function getGuestAttendanceStatus(guest: SeatingGuestCandidate): AttendanceStatus {
  return getAttendanceStatus({
    used: Boolean(guest.used),
    extraFields: normalizeExtraFields(guest.extraFields),
  });
}

/**
 * Returns true if the guest is eligible for reception seating pools and rosters
 * (excludes declined RSVPs and public `address-collection` submissions).
 */
export function isGuestEligibleForSeating(guest: SeatingGuestCandidate): boolean {
  if (hasAddressCollectionTag(guest.partyTags)) {
    return false;
  }
  if (getGuestAttendanceStatus(guest) === 'declined') {
    return false;
  }
  return true;
}

/**
 * Returns structured dietary badges for a guest's `dietaryNotes` (and optional
 * structured meal dietary tags) using `matchDietaryCategory` from `@/features/registry`.
 */
export function getDietaryBadges(
  notes: string | null | undefined,
  structuredSource?: unknown,
  partyTags?: unknown
): DietaryBadgeInfo[] {
  const trimmed = notes ? notes.trim() : '';
  const hasPartyKidsTag =
    Array.isArray(partyTags) &&
    partyTags.some(
      (tag) =>
        typeof tag === 'string' && /^(kid|kids|child|children|kids[-_ ]meal)$/i.test(tag.trim())
    );
  const hasKids = hasPartyKidsTag || matchDietaryCategory(trimmed, 'kids', structuredSource);
  const hasRestriction = matchDietaryCategory(notes, 'has_restriction', structuredSource);

  if (!hasRestriction && !hasKids) {
    return [];
  }

  const badges: DietaryBadgeInfo[] = [];

  if (hasRestriction) {
    if (matchDietaryCategory(trimmed, 'gluten-free', structuredSource)) {
      badges.push({ category: 'gluten-free', shortLabel: 'GF', label: 'Gluten-Free' });
    }
    if (matchDietaryCategory(trimmed, 'vegan', structuredSource)) {
      badges.push({ category: 'vegan', shortLabel: 'VG', label: 'Vegan' });
    }
    if (matchDietaryCategory(trimmed, 'vegetarian', structuredSource)) {
      badges.push({ category: 'vegetarian', shortLabel: 'V', label: 'Vegetarian' });
    }
    if (matchDietaryCategory(trimmed, 'dairy-free', structuredSource)) {
      badges.push({ category: 'dairy-free', shortLabel: 'DF', label: 'Dairy-Free' });
    }
    if (matchDietaryCategory(trimmed, 'nut-free', structuredSource)) {
      badges.push({ category: 'nut-free', shortLabel: 'NF', label: 'Nut-Free' });
    }
  }

  if (hasKids) {
    badges.push({ category: 'kids', shortLabel: 'KIDS', label: 'Kids Meal' });
  }

  if (hasRestriction && matchDietaryCategory(trimmed, 'other', structuredSource)) {
    const isPureKidsNote =
      Boolean(trimmed) &&
      /^(kid|kids|child|children)(\s+meals?)?$/i.test(trimmed) &&
      !matchDietaryCategory(null, 'other', structuredSource);
    if (!isPureKidsNote) {
      const fallbackLabel = trimmed || 'Dietary Restriction';
      const cleanLabel =
        fallbackLabel.length > 24 ? `${fallbackLabel.slice(0, 22).trimEnd()}…` : fallbackLabel;
      badges.push({ category: 'other', shortLabel: 'DIET', label: cleanLabel });
    }
  }

  return badges;
}

/**
 * Computes the number of attending/allocated plus-one companions for a guest record.
 * - Declined RSVPs return 0.
 * - Confirmed ('attending') RSVPs prefer explicit `extraFields.plusOneCount` synced by sub-event RSVPs,
 *   falling back to attending `subEventRsvps`, `extraFields.plusOneNames`, `plusOneAllocations`, or legacy plus-one name columns.
 * - Pending RSVPs prefer positive `extraFields.plusOneCount`, falling back to `plusOneAllocations` or plus-one names.
 */
function getGuestPlusOneCount(guest: SeatingGuestCandidate): number {
  const status = getGuestAttendanceStatus(guest);
  if (status === 'declined') {
    return 0;
  }

  const extra = normalizeExtraFields(guest.extraFields);
  const explicitExtraCount = extra ? toNonNegativeInt(extra.plusOneCount) : null;
  const legacyFullName = [guest.plusOneFirstName, guest.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  const allocCount = toNonNegativeInt(guest.plusOneAllocations);

  const extraNamesCount =
    extra && Array.isArray(extra.plusOneNames)
      ? extra.plusOneNames.filter((n) => typeof n === 'string' && n.trim().length > 0).length
      : 0;

  if (status === 'attending') {
    if (explicitExtraCount !== null) {
      return explicitExtraCount;
    }

    if (Array.isArray(guest.subEventRsvps) && guest.subEventRsvps.length > 0) {
      const attendingRsvps = guest.subEventRsvps.filter(
        (r) => typeof r?.status === 'string' && r.status.trim().toLowerCase() === 'attending'
      );
      if (attendingRsvps.length > 0) {
        let maxRsvpPlusOnes = 0;
        for (const rsvp of attendingRsvps) {
          const cnt = toNonNegativeInt(rsvp.plusOneCount) ?? 0;
          if (cnt > maxRsvpPlusOnes) {
            maxRsvpPlusOnes = cnt;
          }
        }
        return maxRsvpPlusOnes;
      }
    }

    if (extraNamesCount > 0) {
      return extraNamesCount;
    }
    if (allocCount !== null && allocCount > 0) {
      return allocCount;
    }
    if (legacyFullName) {
      return 1;
    }
    return 0;
  }

  // status === 'pending'
  if (explicitExtraCount !== null && explicitExtraCount > 0) {
    return explicitExtraCount;
  }
  if (allocCount !== null && allocCount > 0) {
    return allocCount;
  }
  if (extraNamesCount > 0) {
    return extraNamesCount;
  }
  if (legacyFullName) {
    return 1;
  }
  return 0;
}

/**
 * Computes total chairs required for an `InvitationCode` party (`1 + plusOneCount`).
 */
export function getGuestPartySize(guest: SeatingGuestCandidate): number {
  return 1 + getGuestPlusOneCount(guest);
}

/**
 * Sums total attendee headcount across a collection of guest records.
 */
export function getGuestsHeadcount(
  guests: ReadonlyArray<SeatingGuestCandidate> | null | undefined
): number {
  if (!guests || guests.length === 0) {
    return 0;
  }
  let total = 0;
  for (const guest of guests) {
    total += getGuestPartySize(guest);
  }
  return total;
}

function extractRawCompanionNames(guest: SeatingGuestCandidate): Array<string | null> {
  const plusOneCount = getGuestPlusOneCount(guest);
  if (plusOneCount <= 0) {
    return [];
  }

  const extra = normalizeExtraFields(guest.extraFields);
  let rawNames: string[] = [];

  if (extra && Array.isArray(extra.plusOneNames)) {
    rawNames = extra.plusOneNames
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter(Boolean);
  }

  if (rawNames.length === 0 && Array.isArray(guest.subEventRsvps)) {
    for (const rsvp of guest.subEventRsvps) {
      if (
        typeof rsvp?.status === 'string' &&
        rsvp.status.trim().toLowerCase() === 'attending' &&
        Array.isArray(rsvp.plusOneNames)
      ) {
        const candidateNames = rsvp.plusOneNames
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.trim())
          .filter(Boolean);
        if (candidateNames.length > rawNames.length) {
          rawNames = candidateNames;
        }
      }
    }
  }

  const legacyFullName = [guest.plusOneFirstName, guest.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');

  return Array.from({ length: plusOneCount }, (_, idx) => {
    if (rawNames[idx]) {
      return rawNames[idx];
    }
    if (idx === 0 && legacyFullName) {
      return legacyFullName;
    }
    return null;
  });
}

/**
 * Returns display names for each companion of a multi-person invitation (`length === partySize - 1`).
 */
export function getGuestCompanionNames(guest: SeatingGuestCandidate): string[] {
  const rawList = extractRawCompanionNames(guest);
  if (rawList.length === 0) {
    return [];
  }
  const primaryName = (guest.guestName || 'Guest').trim() || 'Guest';
  return rawList.map((named, idx) => {
    if (named) {
      return named;
    }
    return rawList.length === 1 ? `${primaryName} (+1)` : `${primaryName} (+${idx + 1})`;
  });
}

/**
 * Formats a clear seat/roster label for a specific 0-indexed companion chair.
 */
export function formatCompanionSeatLabel(
  guest: SeatingGuestCandidate,
  companionIndex: number
): string {
  const rawList = extractRawCompanionNames(guest);
  const primaryName = (guest.guestName || 'Guest').trim() || 'Guest';
  const named = rawList[companionIndex];
  const ordinalTag = rawList.length <= 1 ? '+1' : `+${companionIndex + 1}`;
  if (named) {
    return `${named} (${primaryName} ${ordinalTag})`;
  }
  return `${primaryName} (${ordinalTag})`;
}

/**
 * Returns true when the table shape places seats along a single edge ('head' or 'sweetheart').
 */
export function isOneSidedTableShape(shape: string | null | undefined): boolean {
  if (!shape) return false;
  const normalized = shape.trim().toLowerCase();
  return normalized === 'head' || normalized === 'sweetheart';
}
