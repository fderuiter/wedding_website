import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import { buildInitialDemoState } from './seedData';
import type { DemoState } from './types';

export const DEMO_STATE_STORAGE_KEY = 'wedding_showcase_demo_state_v1';

type DemoListener = (state: DemoState) => void;

let memoryState: DemoState | null = null;
const listeners = new Set<DemoListener>();

function persistState(state: DemoState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DEMO_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or restricted context errors
  }
}

function syncAdminLocalStorage(isAdmin: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (isAdmin) {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    } else {
      window.localStorage.removeItem('isAdminLoggedIn');
    }
    window.dispatchEvent(new Event('storage'));
  } catch {
    // Ignore storage errors
  }
}

function notifyListeners(state: DemoState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // Prevent one subscriber from breaking others
    }
  }
}

function normalizeDates(state: DemoState): DemoState {
  if (state.config) {
    state.config.weddingDate = new Date(state.config.weddingDate);
    if (state.config.updatedAt) {
      state.config.updatedAt = new Date(state.config.updatedAt);
    }
  }
  return state;
}

export function getDemoState(): DemoState {
  if (memoryState) {
    return memoryState;
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(DEMO_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DemoState>;
        if (
          parsed &&
          parsed.schemaVersion === 1 &&
          parsed.config &&
          Array.isArray(parsed.registryItems) &&
          Array.isArray(parsed.invitationCodes)
        ) {
          memoryState = normalizeDates(parsed as DemoState);
          return memoryState;
        }
      }
    } catch {
      // Fall back to fresh seed state on corrupted storage
    }
  }

  memoryState = normalizeDates(buildInitialDemoState('classic'));
  persistState(memoryState);
  return memoryState;
}

export function updateDemoState(updater: (draft: DemoState) => DemoState | void): DemoState {
  const current = getDemoState();
  const cloned = normalizeDates(JSON.parse(JSON.stringify(current)) as DemoState);
  const maybeNext = updater(cloned);
  const next = normalizeDates(maybeNext ?? cloned);
  memoryState = next;
  persistState(next);
  if (current.isAdmin !== next.isAdmin) {
    syncAdminLocalStorage(next.isAdmin);
  }
  notifyListeners(next);
  return next;
}

export function switchDemoArchetype(archetypeId: ArchetypeId): DemoState {
  const current = getDemoState();
  const fresh = buildInitialDemoState(archetypeId);
  fresh.isAdmin = current.isAdmin;
  fresh.setupWizardPreview = false;
  memoryState = fresh;
  persistState(fresh);
  syncAdminLocalStorage(fresh.isAdmin);
  notifyListeners(fresh);
  return fresh;
}

export function setSetupWizardPreview(enabled: boolean): DemoState {
  return updateDemoState((draft) => {
    draft.setupWizardPreview = enabled;
  });
}

export function resetDemoState(archetypeId: ArchetypeId = 'classic'): DemoState {
  const fresh = buildInitialDemoState(archetypeId);
  memoryState = fresh;
  persistState(fresh);
  syncAdminLocalStorage(true);
  notifyListeners(fresh);
  return fresh;
}

export function subscribeDemoState(listener: DemoListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
