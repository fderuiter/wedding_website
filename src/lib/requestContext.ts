import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import type { NextRequest } from 'next/server';
import { normalizePlusOneNames } from '@/utils/rsvpPrompts';

export interface HydratedGuestInvitation {
  id: string;
  code: string;
  guestName: string;
  householdName: string | null;
  partyGroup: string | null;
  partyTags: string[];
  email: string | null;
  plusOneAllocations: number;
  plusOneFirstName: string | null;
  plusOneLastName: string | null;
  savedPlusOneNames: string[];
  used: boolean;
  usedAt: Date | null;
  dietaryNotes: string | null;
  extraFields: unknown;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  isSample: boolean;
}

interface RequestContextStore {
  request?: object;
  guestSessionsByKey: Map<string, Promise<unknown>>;
  invitationsByCode: Map<string, HydratedGuestInvitation>;
  appConfigByKey: Map<string, Promise<unknown>>;
}

function createRequestContextStore(request?: object): RequestContextStore {
  return {
    request,
    guestSessionsByKey: new Map<string, Promise<unknown>>(),
    invitationsByCode: new Map<string, HydratedGuestInvitation>(),
    appConfigByKey: new Map<string, Promise<unknown>>(),
  };
}

const requestAsyncLocalStorage = new AsyncLocalStorage<RequestContextStore>();
const requestWeakMap = new WeakMap<object, RequestContextStore>();
const getServerRenderContextStore = cache(() => createRequestContextStore());

function resolveRequestContextStore(req?: NextRequest): RequestContextStore {
  const activeStore = requestAsyncLocalStorage.getStore();
  if (activeStore && (!req || !activeStore.request || activeStore.request === req)) {
    return activeStore;
  }

  if (req && typeof req === 'object') {
    let existing = requestWeakMap.get(req);
    if (!existing) {
      existing = createRequestContextStore(req);
      requestWeakMap.set(req, existing);
    }
    return existing;
  }

  return getServerRenderContextStore();
}

function parseExtraFieldsRecord(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function computeSavedPlusOneNames(invite: {
  plusOneFirstName?: unknown;
  plusOneLastName?: unknown;
  extraFields?: unknown;
}): string[] {
  const extra = parseExtraFieldsRecord(invite.extraFields);
  const extraNames = normalizePlusOneNames(extra.plusOneNames).filter(Boolean);
  if (extraNames.length > 0) {
    return extraNames;
  }

  const combined = [invite.plusOneFirstName, invite.plusOneLastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');

  return combined ? [combined] : [];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function buildHydratedGuestInvitation(
  raw: Record<string, unknown>,
  fallbackCode: string,
  resolvedGuestName: string
): HydratedGuestInvitation {
  const normalizedCode = (typeof raw.code === 'string' && raw.code.trim() ? raw.code : fallbackCode)
    .trim()
    .toUpperCase();
  const rawPartyTags = Array.isArray(raw.partyTags)
    ? raw.partyTags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const rawPlusOnes =
    typeof raw.plusOneAllocations === 'number' && Number.isFinite(raw.plusOneAllocations)
      ? Math.max(0, raw.plusOneAllocations)
      : 0;
  const rawUsedAt =
    raw.usedAt instanceof Date
      ? raw.usedAt
      : typeof raw.usedAt === 'string' && !Number.isNaN(Date.parse(raw.usedAt))
        ? new Date(raw.usedAt)
        : null;

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    code: normalizedCode,
    guestName: resolvedGuestName,
    householdName: toNullableString(raw.householdName),
    partyGroup: toNullableString(raw.partyGroup),
    partyTags: rawPartyTags,
    email: toNullableString(raw.email),
    plusOneAllocations: rawPlusOnes,
    plusOneFirstName: toNullableString(raw.plusOneFirstName),
    plusOneLastName: toNullableString(raw.plusOneLastName),
    savedPlusOneNames: computeSavedPlusOneNames(raw),
    used: Boolean(raw.used),
    usedAt: rawUsedAt,
    dietaryNotes: toNullableString(raw.dietaryNotes),
    extraFields: raw.extraFields ?? null,
    addressLine1: toNullableString(raw.addressLine1),
    addressLine2: toNullableString(raw.addressLine2),
    city: toNullableString(raw.city),
    state: toNullableString(raw.state),
    zipCode: toNullableString(raw.zipCode),
    country: toNullableString(raw.country),
    isSample: Boolean(raw.isSample),
  };
}

/**
 * Executes `fn` inside an isolated per-request `AsyncLocalStorage` context and binds a
 * matching `WeakMap` entry to `req` until the request completes.
 */
export async function runWithRequestContext<T>(
  req: NextRequest | undefined,
  fn: () => Promise<T> | T
): Promise<T> {
  const reqObj = req && typeof req === 'object' ? req : undefined;
  const store = createRequestContextStore(reqObj);
  if (reqObj) {
    requestWeakMap.set(reqObj, store);
  }

  try {
    return await requestAsyncLocalStorage.run(store, fn);
  } finally {
    if (reqObj && requestWeakMap.get(reqObj) === store) {
      requestWeakMap.delete(reqObj);
    }
  }
}

export function getOrLoadGuestSession<T>(
  req: NextRequest | undefined,
  cacheKey: string,
  loader: () => Promise<T>
): Promise<T> {
  const store = resolveRequestContextStore(req);
  const existing = store.guestSessionsByKey.get(cacheKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const pending = loader().catch((err) => {
    if (store.guestSessionsByKey.get(cacheKey) === pending) {
      store.guestSessionsByKey.delete(cacheKey);
    }
    throw err;
  });
  store.guestSessionsByKey.set(cacheKey, pending);
  return pending;
}

export function setHydratedGuestInvitation(
  invite: HydratedGuestInvitation,
  req?: NextRequest
): void {
  const normalizedCode = invite.code.trim().toUpperCase();
  if (!normalizedCode || invite.isSample) {
    return;
  }
  const store = resolveRequestContextStore(req);
  store.invitationsByCode.set(normalizedCode, invite);
}

export function getHydratedGuestInvitation(
  code?: string | null,
  req?: NextRequest
): HydratedGuestInvitation | null {
  if (!code || typeof code !== 'string') {
    return null;
  }
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  const store = resolveRequestContextStore(req);
  const invite = store.invitationsByCode.get(normalizedCode);
  if (!invite || invite.isSample) {
    return null;
  }
  return invite;
}

export function updateHydratedGuestInvitation(
  code: string,
  patch: Partial<HydratedGuestInvitation>,
  req?: NextRequest
): void {
  if (!code || typeof code !== 'string') {
    return;
  }
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return;
  }

  const store = resolveRequestContextStore(req);
  const existing = store.invitationsByCode.get(normalizedCode);
  if (!existing) {
    return;
  }

  const merged: HydratedGuestInvitation = {
    ...existing,
    ...patch,
  };
  if (
    patch.plusOneFirstName !== undefined ||
    patch.plusOneLastName !== undefined ||
    patch.extraFields !== undefined
  ) {
    merged.savedPlusOneNames =
      patch.savedPlusOneNames ??
      computeSavedPlusOneNames({
        plusOneFirstName: merged.plusOneFirstName,
        plusOneLastName: merged.plusOneLastName,
        extraFields: merged.extraFields,
      });
  }
  store.invitationsByCode.set(normalizedCode, merged);
}

export function getOrLoadRequestAppConfig<T>(
  cacheKey: string,
  loader: () => Promise<T>
): Promise<T> | null {
  const activeStore = requestAsyncLocalStorage.getStore();
  if (!activeStore) {
    return null;
  }

  const existing = activeStore.appConfigByKey.get(cacheKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const pending = loader().catch((err) => {
    if (activeStore.appConfigByKey.get(cacheKey) === pending) {
      activeStore.appConfigByKey.delete(cacheKey);
    }
    throw err;
  });
  activeStore.appConfigByKey.set(cacheKey, pending);
  return pending;
}
