import {
  extractDietaryTags,
  getAttendanceStatus,
  matchDietaryCategory,
  type AttendanceStatus,
} from '@/features/registry';

export const ADDRESS_COLLECTION_TAG = 'address-collection';

export interface DietaryBadgeInfo {
  category: 'gluten-free' | 'vegan' | 'vegetarian' | 'dairy-free' | 'nut-free' | 'other';
  shortLabel: string;
  label: string;
}

export interface SeatingGuestCandidate {
  used?: boolean | null;
  extraFields?: unknown;
  partyTags?: unknown;
  dietaryNotes?: string | null;
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
 * Returns structured dietary badges for a guest's `dietaryNotes` and/or
 * structured plated meal dietary tags (`extraFields`) using `matchDietaryCategory`
 * from `@/features/registry`.
 */
export function getDietaryBadges(
  notes: string | null | undefined,
  structuredSource?: unknown
): DietaryBadgeInfo[] {
  const trimmed = notes ? notes.trim() : '';
  if (!matchDietaryCategory(trimmed, 'has_restriction', structuredSource)) {
    return [];
  }

  const badges: DietaryBadgeInfo[] = [];

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
  if (matchDietaryCategory(trimmed, 'other', structuredSource)) {
    const otherTags = extractDietaryTags(structuredSource).filter(
      (tag) =>
        !['gluten-free', 'gf', 'vegan', 'vegetarian', 'dairy-free', 'df', 'nut-free', 'kids'].includes(tag)
    );
    const rawOtherLabel = trimmed || otherTags.join(', ') || 'Dietary';
    const cleanLabel =
      rawOtherLabel.length > 24 ? `${rawOtherLabel.slice(0, 22).trimEnd()}…` : rawOtherLabel;
    badges.push({ category: 'other', shortLabel: 'DIET', label: cleanLabel });
  }

  return badges;
}

/**
 * Returns true when the table shape places seats along a single edge ('head' or 'sweetheart').
 */
export function isOneSidedTableShape(shape: string | null | undefined): boolean {
  if (!shape) return false;
  const normalized = shape.trim().toLowerCase();
  return normalized === 'head' || normalized === 'sweetheart';
}
