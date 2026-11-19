import crypto from 'crypto';

export type AttendanceStatus = 'attending' | 'declined' | 'pending';

export interface AttendanceStatusItem {
  used: boolean;
  extraFields?: Record<string, any> | null;
}

export interface AddressItem {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

/**
 * Evaluates whether guest dietary notes match a given category filter.
 * An empty or 'all' category returns true immediately before inspecting notes.
 */
export function matchDietaryCategory(
  notes: string | null | undefined,
  category?: string | null
): boolean {
  if (!category || category === 'all') return true;
  if (!notes || !notes.trim()) return false;
  const lower = notes.trim().toLowerCase();

  const isGlutenFree = /\b(gf|gluten[- ]free|gluten)\b/i.test(lower);
  const isVegan = /\b(vegan)\b/i.test(lower);
  const isVegetarian = /\b(vegetarian|veg)\b/i.test(lower) && !isVegan;
  const isDairyFree = /\b(df|dairy[- ]free|dairy|lactose)\b/i.test(lower);
  const isNutFree = /\b(nut[- ]free|nut|nuts|peanut|allergy|allergies)\b/i.test(lower);

  switch (category) {
    case 'gluten-free':
      return isGlutenFree;
    case 'vegetarian':
      return isVegetarian;
    case 'vegan':
      return isVegan;
    case 'dairy-free':
      return isDairyFree;
    case 'nut-free':
      return isNutFree;
    case 'other':
      return !isGlutenFree && !isVegan && !isVegetarian && !isDairyFree && !isNutFree;
    case 'has_restriction':
      return true;
    default:
      return true;
  }
}

/**
 * Derives guest RSVP attendance status ('attending', 'declined', or 'pending').
 * Checks extraFields values first; falls back to item.used flag.
 */
export function getAttendanceStatus(item: AttendanceStatusItem): AttendanceStatus {
  const rawVal =
    item.extraFields?.attendanceStatus ??
    item.extraFields?.rsvpStatus ??
    item.extraFields?.attendance ??
    item.extraFields?.rsvp ??
    item.extraFields?.attending ??
    item.extraFields?.status;

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

  return item.used ? 'attending' : 'pending';
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

