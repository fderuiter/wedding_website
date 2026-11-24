import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import { normalizePartyTags } from '@/utils/invitationValidation';
import { dispatchDemoApiRequest } from '@/lib/demo/demoApiHandler';
import {
  getActiveArchetypeDataset,
  getDemoState,
  hydrateDemoStateFromStorage,
  isDemoAdminSession,
  resetDemoState,
  setDemoArchetype,
  setDemoGuestSession,
  setDemoPersona,
  setDemoRuntimeActive,
  setDemoSetupAuthenticated,
  subscribeDemoState,
  type DemoGuestSession,
  type DemoPersona,
} from '@/lib/demo/demoStore';
import { createStaticDemoRouter, type StaticDemoRequestHandler } from '@/lib/staticDemo/router';
import { createDemoStore } from '@/lib/staticDemo/store';
import {
  STATIC_DEMO_STORAGE_KEY,
  type StaticDemoStore,
} from '@/lib/staticDemo/types';

export type ExplorerMode = 'sandbox' | 'external';
export type SandboxPersona = DemoPersona;

export const DEMO_SHOWCASE_STORAGE_KEY = 'wedding_showcase_demo_v1';
export { STATIC_DEMO_STORAGE_KEY };

export interface SandboxStateSnapshot {
  persona: SandboxPersona;
  archetype: ArchetypeId;
  isAdminSession: boolean;
  setupAuthenticated: boolean;
  guestSession: DemoGuestSession | null;
  resetCounter: number;
}

export type TargetServerValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export interface ExternalTargetOriginAssessment {
  isCrossOrigin: boolean;
  targetOrigin: string;
  currentOrigin: string;
}

interface InstalledStaticDemoGlobal {
  store: StaticDemoStore;
  routeRequest: StaticDemoRequestHandler;
  uninstall: () => void;
}

declare global {
  interface Window {
    __STATIC_DEMO_INSTALLED__?: InstalledStaticDemoGlobal;
  }
}

const PUBLIC_ADMIN_AUTH_PATHS = new Set<string>([
  '/api/admin/me',
  '/api/admin/setup',
  '/api/admin/login',
  '/api/admin/logout',
]);

function isAddressCollectionOnly(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

function findDefaultArchetypeGuestSession(): DemoGuestSession | null {
  const dataset = getActiveArchetypeDataset();
  const primaryHousehold = dataset.guests.find(
    (guest) => !isAddressCollectionOnly(guest.partyTags)
  );
  if (!primaryHousehold) return null;
  return {
    invitationCode: primaryHousehold.code,
    guestName: primaryHousehold.guestName,
  };
}

function ensureStaticDemoBridgeInstalled(): StaticDemoStore | null {
  if (typeof window === 'undefined') return null;
  if (window.__STATIC_DEMO_INSTALLED__?.store) {
    return window.__STATIC_DEMO_INSTALLED__.store;
  }

  const store = createDemoStore({ syncAdminLocalStorage: true });
  const routeRequest = createStaticDemoRouter({
    store,
    mode: 'browser',
  });

  window.__STATIC_DEMO_INSTALLED__ = {
    store,
    routeRequest,
    uninstall: () => {
      if (window.__STATIC_DEMO_INSTALLED__?.store === store) {
        delete window.__STATIC_DEMO_INSTALLED__;
      }
    },
  };

  return store;
}

function readSavedStorageFlags(): { hasShowcaseSaved: boolean; hasStaticSaved: boolean } {
  if (typeof window === 'undefined') {
    return { hasShowcaseSaved: false, hasStaticSaved: false };
  }
  try {
    return {
      hasShowcaseSaved: Boolean(window.localStorage.getItem(DEMO_SHOWCASE_STORAGE_KEY)),
      hasStaticSaved: Boolean(window.localStorage.getItem(STATIC_DEMO_STORAGE_KEY)),
    };
  } catch {
    return { hasShowcaseSaved: false, hasStaticSaved: false };
  }
}

function reconcileStoresFromStorage(
  staticStore: StaticDemoStore | null,
  flags: { hasShowcaseSaved: boolean; hasStaticSaved: boolean }
): void {
  if (typeof window === 'undefined') return;

  if (flags.hasShowcaseSaved) {
    hydrateDemoStateFromStorage();
    return;
  }

  if (flags.hasStaticSaved && staticStore) {
    const snap = staticStore.getSnapshot();
    const derivedPersona: SandboxPersona = snap.isSetupMode
      ? 'setup'
      : snap.isAdminAuthenticated
        ? 'admin'
        : 'guest';
    setDemoArchetype(snap.activeArchetype);
    setDemoSetupAuthenticated(Boolean(snap.isSetupMode && snap.isAdminAuthenticated));
    setDemoPersona(derivedPersona);
    if (snap.guestSession) {
      setDemoGuestSession({
        invitationCode: snap.guestSession.code,
        guestName: snap.guestSession.guestName,
      });
    }
    return;
  }

  resetDemoState();
  setDemoRuntimeActive(true);
  setDemoPersona('guest');
}

function seedDefaultGuestSessionIfNeeded(): void {
  const state = getDemoState();
  if (state.persona === 'guest' && !state.guestSession) {
    const defaultSession = findDefaultArchetypeGuestSession();
    if (defaultSession) {
      setDemoGuestSession(defaultSession);
    }
  }
}

export function normalizeTargetServerUrl(rawValue: unknown): TargetServerValidationResult {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Enter an http:// or https:// server URL to enable external requests.',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Target server URL must use http:// or https://.' };
    }
    const normalized = parsed.toString().replace(/\/+$/, '');
    return { ok: true, url: normalized };
  } catch {
    return {
      ok: false,
      error: 'Enter a valid full URL (for example http://localhost:3000).',
    };
  }
}

export function evaluateExternalTargetOrigin(
  targetUrl: string,
  currentOrigin?: string
): ExternalTargetOriginAssessment {
  const effectiveCurrent =
    currentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  try {
    const parsedTarget = new URL(targetUrl);
    return {
      isCrossOrigin: Boolean(effectiveCurrent && parsedTarget.origin !== effectiveCurrent),
      targetOrigin: parsedTarget.origin,
      currentOrigin: effectiveCurrent,
    };
  } catch {
    return {
      isCrossOrigin: false,
      targetOrigin: '',
      currentOrigin: effectiveCurrent,
    };
  }
}

function normalizeSandboxRequestUrl(rawInput: RequestInfo | URL): URL | null {
  if (typeof window === 'undefined') return null;
  let rawUrl = '';
  if (typeof rawInput === 'string') {
    rawUrl = rawInput;
  } else if (rawInput instanceof URL) {
    rawUrl = rawInput.toString();
  } else if (typeof Request !== 'undefined' && rawInput instanceof Request) {
    rawUrl = rawInput.url;
  }
  if (!rawUrl) return null;

  try {
    const resolved = new URL(rawUrl, window.location.origin);
    let path = resolved.pathname;
    if (!path.startsWith('/api/')) {
      const apiIdx = path.indexOf('/api/');
      if (apiIdx >= 0) {
        path = path.slice(apiIdx);
      }
    }
    if (!path.startsWith('/api/')) return null;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
    resolved.pathname = path;
    return resolved;
  } catch {
    return null;
  }
}

function readInitMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request && input.method) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

function sanitizeRequestInit(method: string, init?: RequestInit): RequestInit {
  const sanitized: RequestInit = { method };
  if (init?.headers) {
    sanitized.headers = init.headers;
  }
  if (method !== 'GET' && method !== 'HEAD' && init?.body !== undefined && init?.body !== null) {
    sanitized.body = init.body;
  }
  if (init?.signal) {
    sanitized.signal = init.signal;
  }
  return sanitized;
}

function readJsonPayload(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON payloads
  }
  return {};
}

function errorEnvelopeResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code,
        message,
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

export interface ApiExplorerSandboxController {
  getSnapshot: () => SandboxStateSnapshot;
  setPersona: (persona: SandboxPersona) => SandboxStateSnapshot;
  resetState: () => SandboxStateSnapshot;
  executeFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  subscribe: (listener: (snapshot: SandboxStateSnapshot) => void) => () => void;
  destroy: () => void;
}

function buildSnapshot(): SandboxStateSnapshot {
  const state = getDemoState();
  return {
    persona: state.persona,
    archetype: state.archetype,
    isAdminSession: isDemoAdminSession(),
    setupAuthenticated: state.setupAuthenticated,
    guestSession: state.guestSession ? { ...state.guestSession } : null,
    resetCounter: state.resetCounter,
  };
}

export function createApiExplorerSandbox(): ApiExplorerSandboxController {
  const initialStorageFlags = readSavedStorageFlags();
  const staticStore = ensureStaticDemoBridgeInstalled();
  setDemoRuntimeActive(true);
  reconcileStoresFromStorage(staticStore, initialStorageFlags);
  seedDefaultGuestSessionIfNeeded();

  const listeners = new Set<(snapshot: SandboxStateSnapshot) => void>();
  const notify = () => {
    const snap = buildSnapshot();
    for (const listener of listeners) {
      listener(snap);
    }
  };

  const unsubscribeDemo = subscribeDemoState(notify);

  const handleStorageEvent = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === DEMO_SHOWCASE_STORAGE_KEY ||
      event.key === STATIC_DEMO_STORAGE_KEY
    ) {
      const flags = readSavedStorageFlags();
      const freshStaticStore = createDemoStore({ syncAdminLocalStorage: true });
      if (typeof window !== 'undefined' && window.__STATIC_DEMO_INSTALLED__) {
        window.__STATIC_DEMO_INSTALLED__.store = freshStaticStore;
        window.__STATIC_DEMO_INSTALLED__.routeRequest = createStaticDemoRouter({
          store: freshStaticStore,
          mode: 'browser',
        });
      }
      reconcileStoresFromStorage(freshStaticStore, flags);
      seedDefaultGuestSessionIfNeeded();
      notify();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
  }

  return {
    getSnapshot(): SandboxStateSnapshot {
      return buildSnapshot();
    },

    setPersona(persona: SandboxPersona): SandboxStateSnapshot {
      if (persona === 'admin') {
        setDemoPersona('admin');
      } else if (persona === 'setup') {
        setDemoSetupAuthenticated(false);
        setDemoPersona('setup');
      } else {
        setDemoSetupAuthenticated(false);
        setDemoPersona('guest');
        if (!getDemoState().guestSession) {
          const defaultSession = findDefaultArchetypeGuestSession();
          if (defaultSession) {
            setDemoGuestSession(defaultSession);
          }
        }
      }
      return buildSnapshot();
    },

    resetState(): SandboxStateSnapshot {
      resetDemoState();
      setDemoRuntimeActive(true);
      seedDefaultGuestSessionIfNeeded();
      return buildSnapshot();
    },

    async executeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      setDemoRuntimeActive(true);
      const normalizedUrl = normalizeSandboxRequestUrl(input);
      if (!normalizedUrl) {
        return errorEnvelopeResponse(
          404,
          'SANDBOX_ROUTE_NOT_FOUND',
          'Browser sandbox only handles /api/* endpoints.'
        );
      }

      const method = readInitMethod(input, init);
      const sanitizedInit = sanitizeRequestInit(method, init);
      const path = normalizedUrl.pathname;
      const state = getDemoState();

      if (path === '/api/admin/login' && method === 'POST') {
        const body = readJsonPayload(sanitizedInit);
        const rawPassword = typeof body.password === 'string' ? body.password.trim() : '';
        if (!rawPassword) {
          return errorEnvelopeResponse(400, 'VALIDATION_ERROR', 'Admin password is required.');
        }
        setDemoPersona('admin');
        return new Response(JSON.stringify({ success: true, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path === '/api/admin/setup' && method === 'POST') {
        const body = readJsonPayload(sanitizedInit);
        if (state.persona === 'guest') {
          return errorEnvelopeResponse(403, 'FORBIDDEN', 'Site is already initialized.');
        }
        if (state.persona === 'setup' && !state.setupAuthenticated) {
          const password = typeof body.password === 'string' ? body.password.trim() : '';
          if (!password) {
            return errorEnvelopeResponse(
              401,
              'UNAUTHORIZED',
              'Admin password is required for first-run setup.'
            );
          }
        }
      }

      if (path.startsWith('/api/admin/') && !PUBLIC_ADMIN_AUTH_PATHS.has(path)) {
        if (!isDemoAdminSession()) {
          return errorEnvelopeResponse(
            401,
            'UNAUTHORIZED',
            'Admin authentication required. Switch the sandbox persona to Administrator to execute /api/admin/* endpoints.'
          );
        }
      }

      const response = await dispatchDemoApiRequest(normalizedUrl.toString(), sanitizedInit);
      if (response) {
        return response;
      }

      return errorEnvelopeResponse(
        404,
        'NOT_FOUND',
        `Sandbox endpoint not found: ${method} ${path}`
      );
    },

    subscribe(listener: (snapshot: SandboxStateSnapshot) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    destroy(): void {
      unsubscribeDemo();
      listeners.clear();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageEvent);
      }
    },
  };
}
