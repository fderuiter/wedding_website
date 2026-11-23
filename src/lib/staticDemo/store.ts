import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import { buildArchetypeSeedSnapshot, isValidArchetypeId } from './seeds';
import { createDemoSvgDataUrl } from './svgAssets';
import {
  STATIC_DEMO_MAX_STORAGE_BYTES,
  STATIC_DEMO_STORAGE_KEY,
  STATIC_DEMO_STORE_VERSION,
  type StaticDemoSnapshot,
  type StaticDemoStore,
} from './types';

function cloneSnapshot(snapshot: StaticDemoSnapshot): StaticDemoSnapshot {
  if (typeof structuredClone === 'function') {
    return structuredClone(snapshot);
  }
  return JSON.parse(JSON.stringify(snapshot)) as StaticDemoSnapshot;
}

function measureUtf8Bytes(serialized: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(serialized, 'utf8');
  }
  return new TextEncoder().encode(serialized).length;
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: unknown; code?: unknown; message?: unknown };
  if (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  ) {
    return true;
  }
  return typeof candidate.message === 'string' && /quota/i.test(candidate.message);
}

/**
 * Compacts snapshot history and oversized inline media URLs if serialized state approaches
 * the 2 MB `localStorage` budget or encounters `QuotaExceededError`.
 */
function compactSnapshotForStorage(
  snapshot: StaticDemoSnapshot,
  aggressive = false,
): StaticDemoSnapshot {
  const next = cloneSnapshot(snapshot);

  const maxSnapshots = aggressive ? 5 : 40;
  if (next.snapshotVersion.length > maxSnapshots) {
    next.snapshotVersion = next.snapshotVersion.slice(-maxSnapshots);
  }

  const maxDataUrlChars = aggressive ? 950 : 2400;
  const replacedMediaUrls = new Map<string, string>();
  next.media = next.media.map((m) => {
    if (m.url.startsWith('data:image/') && m.url.length > maxDataUrlChars) {
      const compactUrl = createDemoSvgDataUrl(m.altText || 'Wedding Photo', 'Saved Locally', 'neutral');
      replacedMediaUrls.set(m.id, compactUrl);
      return { ...m, url: compactUrl };
    }
    return m;
  });

  if (replacedMediaUrls.size > 0 || aggressive) {
    next.contentNode = next.contentNode.map((node) => {
      if (node.type !== 'Photo') return node;
      const mediaId = typeof node.data.mediaId === 'string' ? node.data.mediaId : '';
      const mapped = mediaId ? replacedMediaUrls.get(mediaId) : undefined;
      if (mapped) {
        return { ...node, data: { ...node.data, url: mapped } };
      }
      const rawUrl = typeof node.data.url === 'string' ? node.data.url : '';
      if (rawUrl.startsWith('data:image/') && rawUrl.length > maxDataUrlChars) {
        const title = typeof node.data.title === 'string' ? node.data.title : 'Wedding Photo';
        return {
          ...node,
          data: {
            ...node.data,
            url: createDemoSvgDataUrl(title, 'Saved Locally', 'neutral'),
          },
        };
      }
      return node;
    });
  }

  return next;
}

function isValidStoredSnapshot(parsed: unknown): parsed is StaticDemoSnapshot {
  if (!parsed || typeof parsed !== 'object') return false;
  const record = parsed as Record<string, unknown>;
  return (
    record.storeVersion === STATIC_DEMO_STORE_VERSION &&
    isValidArchetypeId(record.activeArchetype) &&
    Array.isArray(record.appConfig) &&
    record.appConfig.length > 0 &&
    Array.isArray(record.registryItem) &&
    Array.isArray(record.invitationCode) &&
    Array.isArray(record.seatingTable) &&
    Array.isArray(record.subEvent) &&
    Array.isArray(record.contentNode) &&
    Array.isArray(record.media)
  );
}

export interface CreateDemoStoreOptions {
  storage?: Storage | null;
  storageKey?: string;
  initialArchetype?: ArchetypeId;
  maxBytes?: number;
  syncAdminLocalStorage?: boolean;
}

export function createDemoStore(options: CreateDemoStoreOptions = {}): StaticDemoStore {
  const storageKey = options.storageKey || STATIC_DEMO_STORAGE_KEY;
  const maxBytes = options.maxBytes ?? STATIC_DEMO_MAX_STORAGE_BYTES;
  const initialArchetype: ArchetypeId = isValidArchetypeId(options.initialArchetype)
    ? options.initialArchetype
    : 'classic';
  const listeners = new Set<() => void>();

  const getStorage = (): Storage | null => {
    if (options.storage !== undefined) {
      return options.storage;
    }
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  const syncAdminFlag = (isAdmin: boolean) => {
    if (!options.syncAdminLocalStorage) return;
    const storage = getStorage();
    if (!storage) return;
    try {
      if (isAdmin) {
        storage.setItem('isAdminLoggedIn', 'true');
      } else {
        storage.removeItem('isAdminLoggedIn');
      }
    } catch {
      // Ignore storage access errors
    }
  };

  let lastSerializedLength = 0;

  const persistSnapshot = (candidate: StaticDemoSnapshot): StaticDemoSnapshot => {
    let working = compactSnapshotForStorage(candidate, false);
    working.storageWarning = null;

    let serialized = JSON.stringify(working);
    let byteLength = measureUtf8Bytes(serialized);

    if (byteLength > maxBytes) {
      working = compactSnapshotForStorage(working, true);
      working.storageWarning =
        'Local demo storage neared the 2 MB browser limit; older history thumbnails were compacted.';
      serialized = JSON.stringify(working);
      byteLength = measureUtf8Bytes(serialized);
    }

    lastSerializedLength = byteLength;

    const storage = getStorage();
    if (!storage) {
      return working;
    }

    try {
      storage.setItem(storageKey, serialized);
      syncAdminFlag(working.isAdminAuthenticated);
      return working;
    } catch (err: unknown) {
      if (isQuotaExceededError(err)) {
        const compacted = compactSnapshotForStorage(working, true);
        compacted.snapshotVersion = [];
        compacted.storageWarning =
          'Browser storage quota reached; changes remain active in memory for this session.';
        const retrySerialized = JSON.stringify(compacted);
        lastSerializedLength = measureUtf8Bytes(retrySerialized);
        try {
          storage.setItem(storageKey, retrySerialized);
          compacted.storageWarning =
            'Storage was compacted automatically after reaching browser localStorage quota.';
        } catch {
          // Keep compacted snapshot in memory without throwing
        }
        return compacted;
      }

      working.storageWarning = 'Local browser storage is unavailable; running in session memory.';
      return working;
    }
  };

  const loadInitialSnapshot = (): StaticDemoSnapshot => {
    const storage = getStorage();
    if (storage) {
      try {
        const raw = storage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isValidStoredSnapshot(parsed)) {
            lastSerializedLength = measureUtf8Bytes(raw);
            syncAdminFlag(parsed.isAdminAuthenticated);
            return parsed;
          }
        }
      } catch {
        // Corrupted or unreadable storage entry: re-seed cleanly below
      }
    }
    const seeded = buildArchetypeSeedSnapshot(initialArchetype);
    return persistSnapshot(seeded);
  };

  let state: StaticDemoSnapshot = loadInitialSnapshot();

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Prevent individual subscriber errors from breaking notifications
      }
    });
  };

  if (
    options.storage === undefined &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const incoming: unknown = JSON.parse(event.newValue);
        if (isValidStoredSnapshot(incoming)) {
          state = incoming;
          lastSerializedLength = measureUtf8Bytes(event.newValue);
          notify();
        }
      } catch {
        // Ignore malformed cross-tab storage payloads
      }
    });
  }

  return {
    getSnapshot: () => state,

    mutate<T>(updater: (_draft: StaticDemoSnapshot) => T): T {
      const draft = cloneSnapshot(state);
      const result = updater(draft);
      draft.updatedAt = new Date().toISOString();
      state = persistSnapshot(draft);
      notify();
      return result;
    },

    replaceSnapshot: (next: StaticDemoSnapshot) => {
      const copy = cloneSnapshot(next);
      copy.storeVersion = STATIC_DEMO_STORE_VERSION;
      copy.updatedAt = new Date().toISOString();
      state = persistSnapshot(copy);
      notify();
    },

    reset: (archetype?: ArchetypeId): StaticDemoSnapshot => {
      const targetArchetype = isValidArchetypeId(archetype) ? archetype : state.activeArchetype;
      const storage = getStorage();
      if (storage) {
        try {
          storage.removeItem(storageKey);
          storage.removeItem('wedding_setup_wizard_draft');
          storage.removeItem('admin_onboarding_checklist_collapsed');
          if (typeof window !== 'undefined') {
            window.sessionStorage?.removeItem('setup_wizard_draft');
          }
        } catch {
          // Ignore storage removal errors
        }
      }
      const fresh = buildArchetypeSeedSnapshot(targetArchetype);
      state = persistSnapshot(fresh);
      notify();
      return state;
    },

    switchArchetype: (archetype: ArchetypeId): StaticDemoSnapshot => {
      const resolved = isValidArchetypeId(archetype) ? archetype : 'classic';
      const fresh = buildArchetypeSeedSnapshot(resolved);
      state = persistSnapshot(fresh);
      notify();
      return state;
    },

    setSetupMode: (enabled: boolean): StaticDemoSnapshot => {
      const draft = cloneSnapshot(state);
      draft.isSetupMode = enabled;
      if (draft.appConfig[0]) {
        draft.appConfig[0].setupCompleted = !enabled;
      }
      draft.updatedAt = new Date().toISOString();
      state = persistSnapshot(draft);
      notify();
      return state;
    },

    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSerializedByteLength: () => {
      if (lastSerializedLength === 0) {
        lastSerializedLength = measureUtf8Bytes(JSON.stringify(state));
      }
      return lastSerializedLength;
    },
  };
}
