import {
  getAttendanceStatus,
  isPlaceholderPlusOneName,
  matchDietaryCategory,
  type AttendanceStatus,
} from '@/features/registry';

export const ADDRESS_COLLECTION_TAG = 'address-collection';

const GUEST_TABLE_SHAPES = [
  'round',
  'rectangular',
  'square',
  'head',
  'sweetheart',
] as const;

const LANDMARK_TABLE_SHAPES = [
  'dance-floor',
  'bar',
  'dj',
  'buffet',
  'cake',
] as const;

export const ALL_SEATING_TABLE_SHAPES = [
  ...GUEST_TABLE_SHAPES,
  ...LANDMARK_TABLE_SHAPES,
] as const;

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

export interface SeatingHouseholdMemberCandidate {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  dietaryNotes?: string | null;
  tags?: unknown;
  displayOrder?: number | null;
  seatNumber?: number | null;
}

export interface SeatingSubEventMemberRsvpCandidate {
  id?: string;
  householdMemberId?: string;
  status?: string | null;
  mealOptionId?: string | null;
  dietaryNotes?: string | null;
}

export interface SeatingGuestCandidate {
  guestName?: string | null;
  used?: boolean | null;
  isSample?: boolean | null;
  extraFields?: unknown;
  partyTags?: unknown;
  dietaryNotes?: string | null;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  members?: ReadonlyArray<SeatingHouseholdMemberCandidate> | null;
  subEventRsvps?: Array<{
    id?: string;
    subEventId?: string;
    status?: string | null;
    plusOneCount?: number | null;
    plusOneNames?: unknown;
    mealSelections?: unknown;
    subEvent?: {
      id?: string;
      title?: string | null;
      mealOptions?: unknown;
    } | null;
    memberRsvps?: ReadonlyArray<SeatingSubEventMemberRsvpCandidate> | null;
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

export interface SeatingPartyGuestCandidate extends SeatingGuestCandidate {
  id?: string;
  guestName?: string | null;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  plusOneSeatNumbers?: number[] | null;
  seatNumber?: number | null;
}

export interface PartyMemberAttendeeInfo {
  memberId?: string;
  role?: string | null;
  attendeeName: string;
  displayNameOverride?: string;
  isPlusOne: boolean;
  plusOneIndex: number | null;
  explicitSeatNumber?: number | null;
  mealChoice: string | null;
  dietaryNotesText?: string | null;
  dietaryBadges: DietaryBadgeInfo[];
}

interface TableMealSummary {
  totalAttendees: number;
  mealCounts: Array<{ label: string; count: number }>;
  unspecifiedMealCount: number;
  dietaryCounts: Array<{ shortLabel: string; label: string; count: number }>;
  formattedMeals: string;
  formattedDietary: string;
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
function hasAddressCollectionTag(partyTags: unknown): boolean {
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

function hasRelationalMembers(
  guest: SeatingGuestCandidate | null | undefined
): guest is SeatingGuestCandidate & { members: ReadonlyArray<SeatingHouseholdMemberCandidate> } {
  return Boolean(guest && Array.isArray(guest.members) && guest.members.length > 0);
}

function sortHouseholdMembers(
  members: ReadonlyArray<SeatingHouseholdMemberCandidate>
): SeatingHouseholdMemberCandidate[] {
  return [...members].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

function collectMemberRsvpDecisions(guest: SeatingGuestCandidate): {
  hasDecidedMemberRsvps: boolean;
  attendingMemberIds: Set<string>;
} {
  const attendingMemberIds = new Set<string>();
  let hasDecidedMemberRsvps = false;

  if (Array.isArray(guest.subEventRsvps)) {
    for (const rsvp of guest.subEventRsvps) {
      if (!rsvp || !Array.isArray(rsvp.memberRsvps)) continue;
      for (const mr of rsvp.memberRsvps) {
        if (!mr || typeof mr.householdMemberId !== 'string' || !mr.householdMemberId) continue;
        const normalized = typeof mr.status === 'string' ? mr.status.trim().toLowerCase() : '';
        if (normalized === 'attending') {
          hasDecidedMemberRsvps = true;
          attendingMemberIds.add(mr.householdMemberId);
        } else if (normalized === 'declined') {
          hasDecidedMemberRsvps = true;
        }
      }
    }
  }

  return { hasDecidedMemberRsvps, attendingMemberIds };
}

/**
 * Resolves ordered eligible/attending `HouseholdMember` rows for seating when `guest.members` is populated.
 * Supports solo partner/companion attendance when the primary guest declines an event.
 */
export function getAttendingHouseholdMembersForSeating(
  guest: SeatingPartyGuestCandidate
): SeatingHouseholdMemberCandidate[] {
  if (!hasRelationalMembers(guest)) {
    return [];
  }

  const sorted = sortHouseholdMembers(guest.members);
  const { hasDecidedMemberRsvps, attendingMemberIds } = collectMemberRsvpDecisions(guest);

  if (hasDecidedMemberRsvps) {
    if (attendingMemberIds.size === 0) {
      return [];
    }
    return sorted.filter((m) => Boolean(m.id && attendingMemberIds.has(m.id)));
  }

  const overallStatus = getGuestAttendanceStatus(guest);
  if (overallStatus === 'declined') {
    return [];
  }

  const extra = normalizeExtraFields(guest.extraFields);
  if (extra && Array.isArray(extra.attendingMemberIds) && extra.attendingMemberIds.length > 0) {
    const idSet = new Set(
      extra.attendingMemberIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    if (idSet.size > 0) {
      const matched = sorted.filter((m) => Boolean(m.id && idSet.has(m.id)));
      if (matched.length > 0) {
        return matched;
      }
    }
  }

  if (overallStatus === 'attending') {
    const legacyPlusOnes = getLegacyGuestPlusOneCount(guest);
    const desiredTotal = 1 + legacyPlusOnes;
    const namedMembers = sorted.filter(
      (m, idx) =>
        idx === 0 ||
        String(m.role || '').toUpperCase() !== 'PLUS_ONE' ||
        !isPlaceholderPlusOneName(m.fullName)
    );
    const explicitExtraCount = extra ? toNonNegativeInt(extra.plusOneCount) : null;
    if (explicitExtraCount !== null && explicitExtraCount === 0 && sorted.length > namedMembers.length) {
      return namedMembers.slice(0, Math.max(1, namedMembers.length));
    }
    const targetCount = Math.max(namedMembers.length, Math.min(sorted.length, desiredTotal));
    return sorted.slice(0, Math.max(1, targetCount));
  }

  // Pending household: include named members plus allocated placeholder plus-ones
  const namedPending = sorted.filter(
    (m, idx) =>
      idx === 0 ||
      String(m.role || '').toUpperCase() !== 'PLUS_ONE' ||
      !isPlaceholderPlusOneName(m.fullName)
  );
  const legacyPendingTotal = 1 + getLegacyGuestPlusOneCount(guest);
  return sorted.slice(0, Math.max(namedPending.length, Math.min(sorted.length, legacyPendingTotal)));
}

/**
 * Returns true if the guest is eligible for reception seating pools and rosters
 * (excludes sample rows, declined RSVPs, and public `address-collection` submissions).
 */
export function isGuestEligibleForSeating(guest: SeatingGuestCandidate): boolean {
  if (!guest || guest.isSample === true) {
    return false;
  }
  if (hasAddressCollectionTag(guest.partyTags)) {
    return false;
  }
  if (hasRelationalMembers(guest)) {
    const { hasDecidedMemberRsvps, attendingMemberIds } = collectMemberRsvpDecisions(guest);
    if (hasDecidedMemberRsvps) {
      return attendingMemberIds.size > 0;
    }
  }
  if (getGuestAttendanceStatus(guest) === 'declined') {
    return false;
  }
  return true;
}

const GENERATIONAL_SUFFIX_PATTERN = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

/**
 * Extracts normalized `{ surname, givenName }` tokens from an attendee display name
 * for alphabetical escort card sorting (surname first, then given name).
 */
export function parseAttendeeSortName(rawName: string): {
  surname: string;
  givenName: string;
} {
  const trimmed = (rawName || '').trim();
  if (!trimmed) {
    return { surname: '', givenName: '' };
  }

  // Strip trailing parenthetical companion annotations such as "(+1)" or "(John Doe +1)"
  const withoutTrailingParen = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim() || trimmed;

  // Handle explicit "Last, First" formatting (excluding generational suffixes like "Smith, Jr.")
  const commaParts = withoutTrailingParen
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    commaParts.length >= 2 &&
    !GENERATIONAL_SUFFIX_PATTERN.test(commaParts[commaParts.length - 1])
  ) {
    return {
      surname: commaParts[0],
      givenName: commaParts.slice(1).join(' '),
    };
  }

  const normalized = withoutTrailingParen.replace(/,/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { surname: '', givenName: '' };
  }
  if (tokens.length === 1) {
    return { surname: tokens[0], givenName: '' };
  }

  let surnameIndex = tokens.length - 1;
  if (tokens.length >= 3 && GENERATIONAL_SUFFIX_PATTERN.test(tokens[surnameIndex])) {
    surnameIndex -= 1;
  }

  const surname = tokens[surnameIndex];
  const givenTokens = [
    ...tokens.slice(0, surnameIndex),
    ...tokens.slice(surnameIndex + 1),
  ];

  return {
    surname,
    givenName: givenTokens.join(' '),
  };
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
function getLegacyGuestPlusOneCount(guest: SeatingPartyGuestCandidate): number {
  const status = getGuestAttendanceStatus(guest);
  if (status === 'declined') {
    return 0;
  }

  const extra = normalizeExtraFields(guest.extraFields);
  const explicitExtraCount = extra ? toNonNegativeInt(extra.plusOneCount) : null;
  const rawTopCount = (guest as Record<string, unknown>).plusOneCount;
  const topCount = toNonNegativeInt(rawTopCount);
  const legacyFullName = [guest.plusOneFirstName, guest.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
  const allocCount = toNonNegativeInt(guest.plusOneAllocations);

  const extraNamesCount =
    extra && Array.isArray(extra.plusOneNames)
      ? extra.plusOneNames.filter((n) => typeof n === 'string' && n.trim().length > 0).length
      : 0;

  const seatArrCount = Array.isArray(guest.plusOneSeatNumbers)
    ? guest.plusOneSeatNumbers.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1
    ).length
    : 0;

  if (status === 'attending') {
    if (explicitExtraCount !== null) {
      if (explicitExtraCount === 0 && extraNamesCount === 0 && seatArrCount === 0) {
        return 0;
      }
      return Math.max(explicitExtraCount, extraNamesCount, seatArrCount);
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
        return Math.max(maxRsvpPlusOnes, extraNamesCount, seatArrCount);
      }
    }

    if (extraNamesCount > 0) {
      return Math.max(extraNamesCount, seatArrCount);
    }
    if (topCount !== null && topCount > 0) {
      return Math.max(topCount, seatArrCount);
    }
    if (allocCount !== null && allocCount > 0) {
      return Math.max(allocCount, seatArrCount);
    }
    if (legacyFullName) {
      return Math.max(1, seatArrCount);
    }
    if (seatArrCount > 0) {
      return seatArrCount;
    }
    return 0;
  }

  // status === 'pending'
  if (explicitExtraCount !== null && explicitExtraCount > 0) {
    return Math.max(explicitExtraCount, seatArrCount);
  }
  if (allocCount !== null && allocCount > 0) {
    return Math.max(allocCount, extraNamesCount, seatArrCount);
  }
  if (extraNamesCount > 0) {
    return Math.max(extraNamesCount, seatArrCount);
  }
  if (topCount !== null && topCount > 0) {
    return Math.max(topCount, seatArrCount);
  }
  if (legacyFullName) {
    return Math.max(1, seatArrCount);
  }
  if (seatArrCount > 0) {
    return seatArrCount;
  }
  return 0;
}

function getGuestPlusOneCount(guest: SeatingPartyGuestCandidate): number {
  if (hasRelationalMembers(guest)) {
    const attending = getAttendingHouseholdMembersForSeating(guest);
    return Math.max(0, attending.length - 1);
  }
  return getLegacyGuestPlusOneCount(guest);
}

/**
 * Computes total chairs required for an `InvitationCode` party (`1 + plusOneCount`).
 */
export function getGuestPartySize(guest: SeatingGuestCandidate): number {
  if (hasRelationalMembers(guest)) {
    const attending = getAttendingHouseholdMembersForSeating(guest);
    return Math.max(1, attending.length);
  }
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
  if (hasRelationalMembers(guest)) {
    const attending = getAttendingHouseholdMembersForSeating(guest);
    if (attending.length <= 1) {
      return [];
    }
    const primaryName =
      (attending[0]?.fullName || guest.guestName || 'Guest').trim() || 'Guest';
    return attending.slice(1).map((member, idx) => {
      const fullName = (member.fullName || '').trim();
      if (fullName && !isPlaceholderPlusOneName(fullName)) {
        return fullName;
      }
      return attending.length - 1 === 1
        ? `${primaryName} (+1)`
        : `${primaryName} (+${idx + 1})`;
    });
  }
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

/**
 * Returns true when the shape represents a non-seating venue landmark.
 */
export function isLandmarkTableShape(shape: string | null | undefined): boolean {
  if (!shape) return false;
  const normalized = shape.trim().toLowerCase();
  return (LANDMARK_TABLE_SHAPES as readonly string[]).includes(normalized);
}

/**
 * Returns true when a table record is a zero-capacity room landmark.
 */
export function isLandmarkTable(
  table: { shape?: string | null; capacity?: number | null } | null | undefined
): boolean {
  if (!table) return false;
  if (isLandmarkTableShape(table.shape)) return true;
  return typeof table.capacity === 'number' && table.capacity <= 0;
}

/**
 * Human-readable label for landmark or guest table shapes.
 */
export function getSeatingShapeLabel(shape: string | null | undefined): string {
  const normalized = (shape || 'round').trim().toLowerCase();
  switch (normalized) {
    case 'dance-floor':
      return 'Dance Floor';
    case 'bar':
      return 'Bar';
    case 'dj':
      return 'DJ Booth';
    case 'buffet':
      return 'Buffet';
    case 'cake':
      return 'Cake Table';
    case 'head':
      return 'Head Table';
    case 'sweetheart':
      return 'Sweetheart';
    case 'rectangular':
      return 'Rectangular';
    case 'square':
      return 'Square';
    case 'round':
      return 'Round';
    default:
      return shape || 'Round';
  }
}

/**
 * Default canvas dimensions and capacity when switching table/landmark shapes in TableModal.
 */
export function getDefaultShapeDimensions(shape: string): {
  width: number;
  height: number;
  defaultCapacity: number;
} {
  const normalized = shape.trim().toLowerCase();
  switch (normalized) {
    case 'dance-floor':
      return { width: 200, height: 200, defaultCapacity: 0 };
    case 'bar':
      return { width: 180, height: 80, defaultCapacity: 0 };
    case 'dj':
      return { width: 140, height: 80, defaultCapacity: 0 };
    case 'buffet':
      return { width: 200, height: 80, defaultCapacity: 0 };
    case 'cake':
      return { width: 100, height: 100, defaultCapacity: 0 };
    case 'sweetheart':
      return { width: 140, height: 80, defaultCapacity: 2 };
    case 'head':
      return { width: 240, height: 90, defaultCapacity: 8 };
    case 'rectangular':
      return { width: 200, height: 100, defaultCapacity: 8 };
    case 'square':
      return { width: 120, height: 120, defaultCapacity: 8 };
    case 'round':
    default:
      return { width: 120, height: 120, defaultCapacity: 8 };
  }
}

/**
 * Returns trimmed non-empty plus-one display names from synced RSVP `extraFields.plusOneNames`
 * or legacy `plusOneFirstName` / `plusOneLastName`.
 */
export function getGuestPlusOneNamesList(guest: SeatingPartyGuestCandidate): string[] {
  const extra = normalizeExtraFields(guest.extraFields);
  if (extra && Array.isArray(extra.plusOneNames)) {
    const names = extra.plusOneNames
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
    if (names.length > 0) {
      return names;
    }
  }

  const legacy = [guest.plusOneFirstName, guest.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ')
    .trim();

  return legacy ? [legacy] : [];
}

/**
 * Computes the number of attending plus-ones for an invitation.
 * Unsubmitted `plusOneAllocations` alone (when no plus-one RSVP count, name, or seat exists)
 * does not claim extra chairs until plus-ones are attending/named.
 */
export function getAttendingPlusOneCount(guest: SeatingPartyGuestCandidate): number {
  if (!isGuestEligibleForSeating(guest)) {
    return 0;
  }
  return getGuestPlusOneCount(guest);
}

/**
 * Total chairs required to seat an invitation at one table (`1` primary guest + attending/allocated plus-ones).
 */
function getRequiredChairCount(guest: SeatingPartyGuestCandidate): number {
  if (!isGuestEligibleForSeating(guest)) {
    return 0;
  }
  return getGuestPartySize(guest);
}

/**
 * Total occupied chairs across all eligible invitations assigned to a table.
 */
export function getTableOccupiedChairCount(
  guests: ReadonlyArray<SeatingPartyGuestCandidate> | undefined
): number {
  if (!guests || guests.length === 0) return 0;
  let total = 0;
  for (const guest of guests) {
    total += getRequiredChairCount(guest);
  }
  return total;
}

interface ParsedAttendeeMeal {
  label: string | null;
  dietaryTags: string[];
  dietaryNoteHint: string | null;
}

function extractAttendeeMeals(
  guest: SeatingPartyGuestCandidate,
  attendeeNames: string[]
): ParsedAttendeeMeal[] {
  const results: ParsedAttendeeMeal[] = attendeeNames.map(() => ({
    label: null,
    dietaryTags: [],
    dietaryNoteHint: null,
  }));

  const extra = normalizeExtraFields(guest.extraFields);
  if (!extra) return results;

  // 1. Structured `extraFields.mealSelections` synced from SubEventService
  if (Array.isArray(extra.mealSelections) && extra.mealSelections.length > 0) {
    const perAttendeeLabels: string[][] = attendeeNames.map(() => []);
    const perAttendeeTags: string[][] = attendeeNames.map(() => []);

    const ingestSelectionItem = (sel: unknown, selIdx: number) => {
      if (!sel || typeof sel !== 'object') return;
      const entry = sel as {
        attendee?: unknown;
        attendeeName?: unknown;
        label?: unknown;
        mealOptionLabel?: unknown;
        optionId?: unknown;
        dietaryTags?: unknown;
      };
      const rawLabel =
        typeof entry.label === 'string' && entry.label.trim()
          ? entry.label.trim()
          : typeof entry.mealOptionLabel === 'string' && entry.mealOptionLabel.trim()
            ? entry.mealOptionLabel.trim()
            : typeof entry.optionId === 'string' && entry.optionId.trim()
              ? entry.optionId.trim()
              : null;
      if (!rawLabel) return;

      const rawAttendee =
        typeof entry.attendee === 'string' && entry.attendee.trim()
          ? entry.attendee.trim()
          : typeof entry.attendeeName === 'string' && entry.attendeeName.trim()
            ? entry.attendeeName.trim()
            : null;

      let targetIdx = -1;
      if (rawAttendee) {
        const needle = rawAttendee.toLowerCase();
        targetIdx = attendeeNames.findIndex((n) => n.toLowerCase() === needle);
      }
      if (targetIdx < 0 && selIdx < attendeeNames.length) {
        targetIdx = selIdx;
      }
      if (targetIdx < 0) return;

      if (!perAttendeeLabels[targetIdx].includes(rawLabel)) {
        perAttendeeLabels[targetIdx].push(rawLabel);
      }
      if (Array.isArray(entry.dietaryTags)) {
        for (const tag of entry.dietaryTags) {
          if (typeof tag === 'string' && tag.trim()) {
            perAttendeeTags[targetIdx].push(tag.trim());
          }
        }
      }
    };

    extra.mealSelections.forEach((block, blockIdx) => {
      if (!block || typeof block !== 'object') return;
      const selections = (block as { selections?: unknown }).selections;
      if (Array.isArray(selections)) {
        selections.forEach((sel, selIdx) => ingestSelectionItem(sel, selIdx));
      } else {
        ingestSelectionItem(block, blockIdx);
      }
    });

    let matchedAny = false;
    for (let i = 0; i < attendeeNames.length; i++) {
      if (perAttendeeLabels[i].length > 0) {
        matchedAny = true;
        results[i] = {
          label: perAttendeeLabels[i].join(' / '),
          dietaryTags: perAttendeeTags[i],
          dietaryNoteHint: null,
        };
      }
    }
    if (matchedAny) {
      return results;
    }
  }

  // 2. Fallback string `extraFields.mealSummary` (e.g., "Jane Doe: Herb Salmon (gluten-free); John Doe: Short Rib")
  if (typeof extra.mealSummary === 'string' && extra.mealSummary.trim()) {
    const segments = extra.mealSummary
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    segments.forEach((segment, segIdx) => {
      const colonIdx = segment.indexOf(':');
      let parsedName: string | null = null;
      let rawChoice = segment;
      if (colonIdx > 0) {
        parsedName = segment.slice(0, colonIdx).trim();
        rawChoice = segment.slice(colonIdx + 1).trim();
      }

      // Extract optional trailing dietary parenthetical e.g. "Herb Salmon (gluten-free)"
      let cleanLabel = rawChoice;
      let dietaryHint: string | null = null;
      const parenMatch = rawChoice.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (parenMatch && parenMatch[1].trim()) {
        cleanLabel = parenMatch[1].trim();
        dietaryHint = parenMatch[2].trim();
      }

      let targetIdx = -1;
      if (parsedName) {
        const lower = parsedName.toLowerCase();
        targetIdx = attendeeNames.findIndex((n) => n.toLowerCase() === lower);
        if (targetIdx < 0 && parsedName.includes(' - ')) {
          const strippedName = parsedName.slice(parsedName.lastIndexOf(' - ') + 3).trim().toLowerCase();
          if (strippedName) {
            targetIdx = attendeeNames.findIndex((n) => n.toLowerCase() === strippedName);
          }
        }
      }
      if (targetIdx < 0 && segIdx < attendeeNames.length) {
        targetIdx = segIdx;
      }
      if (targetIdx >= 0 && cleanLabel) {
        results[targetIdx] = {
          label: cleanLabel,
          dietaryTags: [],
          dietaryNoteHint: dietaryHint,
        };
      }
    });
  }

  return results;
}

function resolveRelationalMemberMealAndNotes(
  guest: SeatingPartyGuestCandidate,
  member: SeatingHouseholdMemberCandidate,
  fallbackMeal: ParsedAttendeeMeal
): {
  mealChoice: string | null;
  dietaryTags: string[];
  dietaryNotesText: string | null;
} {
  const mealLabels: string[] = [];
  const dietaryTags: string[] = [];
  const noteParts: string[] = [];

  const pushUniqueNote = (raw: string | null | undefined) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) return;
    if (!noteParts.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      noteParts.push(trimmed);
    }
  };

  pushUniqueNote(member.dietaryNotes);

  const extra = normalizeExtraFields(guest.extraFields);
  const structuredMealLookup = new Map<
    string,
    { label: string; dietaryTags: string[] }
  >();

  if (extra && Array.isArray(extra.mealSelections)) {
    for (const block of extra.mealSelections) {
      if (!block || typeof block !== 'object') continue;
      const subEventId =
        typeof (block as { subEventId?: unknown }).subEventId === 'string'
          ? (block as { subEventId: string }).subEventId
          : '';
      const selections = Array.isArray((block as { selections?: unknown }).selections)
        ? ((block as { selections: unknown[] }).selections)
        : [block];
      for (const sel of selections) {
        if (!sel || typeof sel !== 'object') continue;
        const entry = sel as {
          memberId?: unknown;
          attendeeName?: unknown;
          attendee?: unknown;
          optionId?: unknown;
          label?: unknown;
          mealOptionLabel?: unknown;
          dietaryTags?: unknown;
        };
        const resolvedLabel =
          (typeof entry.label === 'string' && entry.label.trim()) ||
          (typeof entry.mealOptionLabel === 'string' && entry.mealOptionLabel.trim()) ||
          (typeof entry.optionId === 'string' && entry.optionId.trim()) ||
          '';
        if (!resolvedLabel) continue;
        const tags = Array.isArray(entry.dietaryTags)
          ? entry.dietaryTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          : [];
        if (typeof entry.memberId === 'string' && entry.memberId) {
          structuredMealLookup.set(`${subEventId}:member:${entry.memberId}`, {
            label: resolvedLabel,
            dietaryTags: tags,
          });
          structuredMealLookup.set(`member:${entry.memberId}`, {
            label: resolvedLabel,
            dietaryTags: tags,
          });
        }
        if (typeof entry.optionId === 'string' && entry.optionId) {
          structuredMealLookup.set(`${subEventId}:opt:${entry.optionId}`, {
            label: resolvedLabel,
            dietaryTags: tags,
          });
          structuredMealLookup.set(`opt:${entry.optionId}`, {
            label: resolvedLabel,
            dietaryTags: tags,
          });
        }
      }
    }
  }

  if (Array.isArray(guest.subEventRsvps) && member.id) {
    for (const rsvp of guest.subEventRsvps) {
      if (!rsvp || !Array.isArray(rsvp.memberRsvps)) continue;
      const subEventId = typeof rsvp.subEventId === 'string' ? rsvp.subEventId : '';
      const rawOptions = Array.isArray(rsvp.subEvent?.mealOptions)
        ? (rsvp.subEvent!.mealOptions as Array<Record<string, unknown>>)
        : [];

      for (const mr of rsvp.memberRsvps) {
        if (!mr || mr.householdMemberId !== member.id) continue;
        const mrStatus = typeof mr.status === 'string' ? mr.status.trim().toLowerCase() : '';
        if (mrStatus === 'declined') continue;

        pushUniqueNote(mr.dietaryNotes);

        const optId = typeof mr.mealOptionId === 'string' ? mr.mealOptionId.trim() : '';
        if (!optId) continue;

        let matchedLabel: string | null = null;
        let matchedTags: string[] = [];

        const matchedSubEventOpt = rawOptions.find(
          (opt) =>
            opt &&
            typeof opt === 'object' &&
            (opt.id === optId ||
              (typeof opt.label === 'string' && opt.label.trim().toLowerCase() === optId.toLowerCase()))
        );
        if (matchedSubEventOpt) {
          matchedLabel =
            typeof matchedSubEventOpt.label === 'string' && matchedSubEventOpt.label.trim()
              ? matchedSubEventOpt.label.trim()
              : optId;
          if (Array.isArray(matchedSubEventOpt.dietaryTags)) {
            matchedTags = matchedSubEventOpt.dietaryTags.filter(
              (t): t is string => typeof t === 'string' && t.trim().length > 0
            );
          }
        } else {
          const fromStructured =
            structuredMealLookup.get(`${subEventId}:member:${member.id}`) ||
            structuredMealLookup.get(`${subEventId}:opt:${optId}`) ||
            structuredMealLookup.get(`opt:${optId}`);
          if (fromStructured) {
            matchedLabel = fromStructured.label;
            matchedTags = fromStructured.dietaryTags;
          } else {
            matchedLabel = optId;
          }
        }

        if (matchedLabel && !mealLabels.includes(matchedLabel)) {
          mealLabels.push(matchedLabel);
        }
        for (const tag of matchedTags) {
          if (!dietaryTags.includes(tag)) {
            dietaryTags.push(tag);
          }
        }
      }
    }
  }

  if (mealLabels.length === 0 && member.id) {
    const directStructured = structuredMealLookup.get(`member:${member.id}`);
    if (directStructured) {
      mealLabels.push(directStructured.label);
      for (const tag of directStructured.dietaryTags) {
        if (!dietaryTags.includes(tag)) {
          dietaryTags.push(tag);
        }
      }
    }
  }

  if (mealLabels.length === 0 && fallbackMeal.label) {
    mealLabels.push(fallbackMeal.label);
    for (const tag of fallbackMeal.dietaryTags) {
      if (!dietaryTags.includes(tag)) {
        dietaryTags.push(tag);
      }
    }
    pushUniqueNote(fallbackMeal.dietaryNoteHint);
  }

  return {
    mealChoice: mealLabels.length > 0 ? mealLabels.join(' / ') : null,
    dietaryTags,
    dietaryNotesText: noteParts.length > 0 ? noteParts.join(', ') : null,
  };
}

/**
 * Expands an eligible invitation into its ordered party members (primary guest + attending plus-ones)
 * with individual display names, entrée choices, and dietary badges.
 */
export function getInvitationPartyMembers(
  guest: SeatingPartyGuestCandidate
): PartyMemberAttendeeInfo[] {
  if (!isGuestEligibleForSeating(guest)) {
    return [];
  }

  if (hasRelationalMembers(guest)) {
    const attendingMembers = getAttendingHouseholdMembersForSeating(guest);
    if (attendingMembers.length === 0) {
      return [];
    }

    const primaryDisplay =
      (attendingMembers[0]?.fullName || guest.guestName || 'Guest').trim() || 'Guest';
    const attendeeNames = attendingMembers.map((member, idx) => {
      const rawName = (member.fullName || '').trim();
      if (rawName && (idx === 0 || !isPlaceholderPlusOneName(rawName))) {
        return rawName;
      }
      return idx === 0
        ? primaryDisplay
        : attendingMembers.length - 1 === 1
          ? `${primaryDisplay} (+1)`
          : `${primaryDisplay} (+${idx})`;
    });

    const fallbackMeals = extractAttendeeMeals(guest, attendeeNames);

    return attendingMembers.map((member, index) => {
      const attendeeName = attendeeNames[index];
      const { mealChoice, dietaryTags, dietaryNotesText } = resolveRelationalMemberMealAndNotes(
        guest,
        member,
        fallbackMeals[index]
      );

      const memberRole = typeof member.role === 'string' ? member.role.trim().toUpperCase() : null;
      const memberTags: string[] = Array.isArray(member.tags)
        ? member.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
      if (memberRole === 'CHILD' && !memberTags.some((t) => /^kids?$/i.test(t.trim()))) {
        memberTags.push('kids');
      }

      const explicitSeatNumber =
        typeof member.seatNumber === 'number' &&
        Number.isInteger(member.seatNumber) &&
        member.seatNumber >= 1
          ? member.seatNumber
          : null;

      return {
        memberId: member.id,
        role: memberRole,
        attendeeName,
        displayNameOverride: attendeeName,
        isPlusOne: index > 0,
        plusOneIndex: index > 0 ? index - 1 : null,
        explicitSeatNumber,
        mealChoice,
        dietaryNotesText,
        dietaryBadges: getDietaryBadges(
          dietaryNotesText,
          dietaryTags.length > 0 ? { dietaryTags } : undefined,
          memberTags
        ),
      };
    });
  }

  const primaryName = (guest.guestName || 'Guest').trim() || 'Guest';
  const companionNames = getGuestCompanionNames(guest);
  const attendeeNames: string[] = [primaryName, ...companionNames];

  const parsedMeals = extractAttendeeMeals(guest, attendeeNames);

  return attendeeNames.map((name, index) => {
    const mealInfo = parsedMeals[index];
    const structuredSource =
      mealInfo.dietaryTags.length > 0
        ? { dietaryTags: mealInfo.dietaryTags }
        : index === 0
          ? guest.extraFields
          : undefined;
    const notesForAttendee =
      index === 0
        ? [guest.dietaryNotes, mealInfo.dietaryNoteHint].filter(Boolean).join(', ') || null
        : mealInfo.dietaryNoteHint;

    return {
      attendeeName: name,
      isPlusOne: index > 0,
      plusOneIndex: index > 0 ? index - 1 : null,
      mealChoice: mealInfo.label,
      dietaryNotesText: notesForAttendee,
      dietaryBadges: getDietaryBadges(
        notesForAttendee,
        structuredSource,
        index === 0 ? guest.partyTags : undefined
      ),
    };
  });
}

/**
 * Aggregates entrée counts and dietary restriction counts from pre-resolved party members or seat occupants
 * without re-parsing guest extraFields or dietary regular expressions.
 */
export function summarizeAttendeeMeals(
  attendees: Iterable<Pick<PartyMemberAttendeeInfo, 'mealChoice' | 'dietaryBadges'>>
): TableMealSummary {
  const mealMap = new Map<string, number>();
  const dietaryMap = new Map<string, { shortLabel: string; label: string; count: number }>();
  let totalAttendees = 0;
  let unspecifiedMealCount = 0;

  for (const member of attendees) {
    totalAttendees++;
    if (member.mealChoice) {
      mealMap.set(member.mealChoice, (mealMap.get(member.mealChoice) ?? 0) + 1);
    } else {
      unspecifiedMealCount++;
    }

    for (const badge of member.dietaryBadges) {
      const existing = dietaryMap.get(badge.shortLabel);
      if (existing) {
        existing.count++;
      } else {
        dietaryMap.set(badge.shortLabel, {
          shortLabel: badge.shortLabel,
          label: badge.label,
          count: 1,
        });
      }
    }
  }

  const mealCounts = Array.from(mealMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const dietaryCounts = Array.from(dietaryMap.values()).sort(
    (a, b) => b.count - a.count || a.shortLabel.localeCompare(b.shortLabel)
  );

  const mealParts = mealCounts.map((m) => `${m.label}: ${m.count}`);
  if (unspecifiedMealCount > 0 && mealCounts.length > 0) {
    mealParts.push(`Unspecified: ${unspecifiedMealCount}`);
  }

  const formattedMeals =
    mealParts.length > 0
      ? mealParts.join(', ')
      : totalAttendees > 0
        ? `No entrée selected (${totalAttendees})`
        : 'No seated guests';

  const formattedDietary =
    dietaryCounts.length > 0
      ? dietaryCounts.map((d) => `${d.shortLabel}: ${d.count}`).join(', ')
      : 'None';

  return {
    totalAttendees,
    mealCounts,
    unspecifiedMealCount,
    dietaryCounts,
    formattedMeals,
    formattedDietary,
  };
}

/**
 * Computes aggregated entrée counts and dietary restriction counts across all eligible attendees seated at a table.
 */
export function computeTableMealCounts(
  guests: ReadonlyArray<SeatingPartyGuestCandidate> | undefined
): TableMealSummary {
  const members: PartyMemberAttendeeInfo[] = [];
  for (const guest of guests ?? []) {
    members.push(...getInvitationPartyMembers(guest));
  }
  return summarizeAttendeeMeals(members);
}
