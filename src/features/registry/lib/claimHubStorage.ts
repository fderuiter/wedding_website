'use client';

export interface StoredSessionClaimHold {
  confirmToken: string;
  cancelToken: string;
  itemId: string;
  itemName?: string;
  amount?: number;
  createdAt: string;
}

const CLAIM_HUB_SESSION_STORAGE_KEY = 'wedding_registry_claim_hub_tokens_v1';
export const CLAIM_HUB_UPDATED_EVENT = 'registry:claim-hub-updated';
const MAX_STORED_CLAIM_TOKENS = 25;

function notifyClaimHubUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLAIM_HUB_UPDATED_EVENT));
  }
}

export function readStoredSessionClaimHolds(): StoredSessionClaimHold[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(CLAIM_HUB_SESSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredSessionClaimHold =>
        Boolean(
          entry &&
            typeof entry === 'object' &&
            typeof entry.confirmToken === 'string' &&
            entry.confirmToken.trim().length > 0 &&
            typeof entry.cancelToken === 'string' &&
            entry.cancelToken.trim().length > 0 &&
            typeof entry.itemId === 'string'
        )
    );
  } catch {
    return [];
  }
}

export function recordStoredSessionClaimHold(hold: {
  confirmToken: string;
  cancelToken: string;
  itemId: string;
  itemName?: string;
  amount?: number;
}): void {
  if (typeof window === 'undefined') return;
  const confirmToken = hold.confirmToken?.trim();
  const cancelToken = hold.cancelToken?.trim();
  if (!confirmToken || !cancelToken) return;

  try {
    const existing = readStoredSessionClaimHolds().filter(
      (entry) => entry.confirmToken !== confirmToken && entry.cancelToken !== cancelToken
    );
    const next: StoredSessionClaimHold[] = [
      {
        confirmToken,
        cancelToken,
        itemId: hold.itemId,
        ...(hold.itemName ? { itemName: hold.itemName } : {}),
        ...(typeof hold.amount === 'number' ? { amount: hold.amount } : {}),
        createdAt: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, MAX_STORED_CLAIM_TOKENS);
    window.sessionStorage.setItem(CLAIM_HUB_SESSION_STORAGE_KEY, JSON.stringify(next));
    notifyClaimHubUpdated();
  } catch {
    // Ignore sessionStorage quota/access errors
  }
}

export function removeStoredSessionClaimHoldByToken(token: string): void {
  if (typeof window === 'undefined' || !token) return;
  try {
    const existing = readStoredSessionClaimHolds();
    const filtered = existing.filter(
      (entry) => entry.confirmToken !== token && entry.cancelToken !== token
    );
    if (filtered.length !== existing.length) {
      window.sessionStorage.setItem(CLAIM_HUB_SESSION_STORAGE_KEY, JSON.stringify(filtered));
      notifyClaimHubUpdated();
    }
  } catch {
    // Ignore sessionStorage errors
  }
}
