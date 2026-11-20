import {
  getAttendanceStatus,
  isAddressComplete,
  matchDietaryCategory,
} from '@/features/registry';
import type { BroadcastChannel, BroadcastTargetFilters } from './types';

export const ADDRESS_COLLECTION_TAG = 'address-collection';

export function hasAddressCollectionTag(tags: unknown): boolean {
  return (
    Array.isArray(tags) &&
    tags.some(
      (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === ADDRESS_COLLECTION_TAG
    )
  );
}

export function parseGuestExtraFields(extraFields: unknown): Record<string, unknown> {
  if (!extraFields) return {};
  if (typeof extraFields === 'string') {
    try {
      const parsed = JSON.parse(extraFields);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof extraFields === 'object' && !Array.isArray(extraFields)) {
    return extraFields as Record<string, unknown>;
  }
  return {};
}

export function getGuestPhone(guest: { extraFields?: unknown } | null | undefined): string {
  if (!guest) return '';
  const extra = parseGuestExtraFields(guest.extraFields);
  const phoneVal = extra.phone ?? extra.mobile;
  return typeof phoneVal === 'string' ? phoneVal.trim() : '';
}

export function hasBroadcastChannelContact(
  guest: { email?: string | null; extraFields?: unknown } | null | undefined,
  channel: BroadcastChannel
): boolean {
  if (!guest) return false;
  if (channel === 'EMAIL') {
    return Boolean(typeof guest.email === 'string' && guest.email.trim());
  }
  return Boolean(getGuestPhone(guest));
}

export function matchesGuestSearchQuery(item: Record<string, any>, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const matchesName = item.guestName ? String(item.guestName).toLowerCase().includes(query) : false;
  const matchesCode = item.code ? String(item.code).toLowerCase().includes(query) : false;
  const matchesEmail = item.email ? String(item.email).toLowerCase().includes(query) : false;
  const matchesPlusOneFirstName = item.plusOneFirstName
    ? String(item.plusOneFirstName).toLowerCase().includes(query)
    : false;
  const matchesPlusOneLastName = item.plusOneLastName
    ? String(item.plusOneLastName).toLowerCase().includes(query)
    : false;
  const matchesAddress = [
    item.addressLine1,
    item.addressLine2,
    item.city,
    item.state,
    item.zipCode,
    item.country,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
  const matchesDietary = item.dietaryNotes
    ? String(item.dietaryNotes).toLowerCase().includes(query)
    : false;
  const matchesHousehold = item.householdName
    ? String(item.householdName).toLowerCase().includes(query)
    : false;
  const matchesPartyGroup = item.partyGroup
    ? String(item.partyGroup).toLowerCase().includes(query)
    : false;
  const matchesTags = Array.isArray(item.partyTags)
    ? item.partyTags.some((t: unknown) => String(t).toLowerCase().includes(query))
    : false;

  return (
    matchesName ||
    matchesCode ||
    matchesEmail ||
    matchesPlusOneFirstName ||
    matchesPlusOneLastName ||
    matchesAddress ||
    matchesDietary ||
    matchesHousehold ||
    matchesPartyGroup ||
    matchesTags
  );
}

/**
 * Evaluates guest records against broadcast target filters using shared domain helpers.
 * Excludes public `address-collection` rows unless explicitly included via `selectedIds` or `partyTags`.
 */
export function filterTargetGuestsInMemory<T extends Record<string, any>>(
  records: T[],
  filters?: BroadcastTargetFilters,
  options?: { applyDbPredicates?: boolean; isPublicSubEvent?: boolean }
): T[] {
  if (!Array.isArray(records)) return records;

  const applyDbPredicates = options?.applyDbPredicates ?? true;

  if (!filters) {
    return records.filter((item) => !hasAddressCollectionTag(item.partyTags));
  }

  const hasSelectedIds = Boolean(filters.selectedIds && filters.selectedIds.length > 0);
  const selectedIdSet = hasSelectedIds ? new Set(filters.selectedIds) : null;

  const explicitlyIncludesAddressCollection = Boolean(
    filters.partyTags &&
      filters.partyTags.some(
        (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === ADDRESS_COLLECTION_TAG
      )
  );

  return records.filter((item) => {
    if (selectedIdSet && applyDbPredicates && !selectedIdSet.has(item.id)) {
      return false;
    }

    if (!explicitlyIncludesAddressCollection && hasAddressCollectionTag(item.partyTags)) {
      if (!selectedIdSet || !selectedIdSet.has(item.id)) {
        return false;
      }
    }

    if (!hasSelectedIds) {
      if (filters.status === 'redeemed' && !item.used) return false;
      if (filters.status === 'unused' && item.used) return false;

      const effectiveAddressStatus = filters.addressStatus ?? filters.addressFilter;
      if (effectiveAddressStatus && effectiveAddressStatus !== 'all') {
        const complete = isAddressComplete(item);
        if (effectiveAddressStatus === 'complete' && !complete) return false;
        if (effectiveAddressStatus === 'missing' && complete) return false;
      }

      const effectiveDietary = filters.dietaryCategory ?? filters.dietaryFilter;
      if (effectiveDietary && effectiveDietary !== 'all') {
        if (!matchDietaryCategory(item.dietaryNotes, effectiveDietary, item.extraFields)) {
          return false;
        }
      }

      if (filters.partyGroup && filters.partyGroup !== 'all') {
        if ((item.partyGroup || '') !== filters.partyGroup) return false;
      }

      if (applyDbPredicates && filters.partyTags && filters.partyTags.length > 0) {
        const itemTags = Array.isArray(item.partyTags) ? item.partyTags : [];
        if (!filters.partyTags.some((tag) => itemTags.includes(tag))) {
          return false;
        }
      }

      if (applyDbPredicates && filters.householdName && filters.householdName.trim()) {
        const targetHh = filters.householdName.trim().toLowerCase();
        const itemHh = item.householdName ? String(item.householdName).toLowerCase() : '';
        if (!itemHh.includes(targetHh)) return false;
      }

      if (filters.searchQuery && filters.searchQuery.trim()) {
        if (!matchesGuestSearchQuery(item, filters.searchQuery)) {
          return false;
        }
      }

      if (filters.subEventId) {
        const rsvpStatus = filters.subEventRsvpStatus || 'all';
        if (!options?.isPublicSubEvent && Array.isArray(item.subEventAccesses)) {
          const hasAccess = item.subEventAccesses.some(
            (acc: any) => acc.subEventId === filters.subEventId
          );
          if (!hasAccess) return false;
        }
        if (Array.isArray(item.subEventRsvps)) {
          const matchingRsvp = item.subEventRsvps.find(
            (r: any) => r.subEventId === filters.subEventId
          );
          if (rsvpStatus === 'pending') {
            if (matchingRsvp && matchingRsvp.status !== 'pending') return false;
          } else if (rsvpStatus !== 'all') {
            if (!matchingRsvp || matchingRsvp.status !== rsvpStatus) return false;
          }
        }
      }
    }

    if (filters.attendanceStatus && filters.attendanceStatus !== 'all') {
      const normalizedItem =
        typeof item.extraFields === 'string'
          ? { ...item, extraFields: parseGuestExtraFields(item.extraFields) }
          : item;
      if (getAttendanceStatus(normalizedItem as any) !== filters.attendanceStatus) {
        return false;
      }
    }

    return true;
  });
}

export function summarizeBroadcastAudience(
  records: Array<Record<string, any>>,
  filters: BroadcastTargetFilters | undefined,
  channel: BroadcastChannel
): {
  matchedCount: number;
  missingContactCount: number;
  reachableCount: number;
} {
  const matched = filterTargetGuestsInMemory(records, filters, { applyDbPredicates: true });
  const missingContactCount = matched.filter(
    (guest) => !hasBroadcastChannelContact(guest, channel)
  ).length;
  return {
    matchedCount: matched.length,
    missingContactCount,
    reachableCount: matched.length - missingContactCount,
  };
}
