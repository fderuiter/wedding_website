'use client';

import React, { useMemo, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { PublicAppConfig } from '@/lib/config';
import { resolveModuleConfig, type ModuleConfig } from '@/lib/modules';
import type { ContentNodeDTO } from '@/features/content';
import type { AttractionDTO } from '@/features/attractions';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { createDemoStore } from './store';
import { createStaticDemoRouter } from './router';
import { StaticDemoToolbar } from './StaticDemoToolbar';
import { resolveCanonicalApiPathname } from './url';
import { extractVenueDateAndTime } from '@/utils/venueDateTime';
import {
  getActiveAppConfig,
  toAttractionDto,
  toPhotoDto,
  toPublicConfigDto,
  toWeddingPartyDto,
} from './dtoMappers';
import type { StaticDemoSnapshot, StaticDemoStore } from './types';

interface InstalledDemoState {
  store: StaticDemoStore;
  routeRequest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response | null>;
  uninstall: () => void;
}

declare global {
  interface Window {
    __STATIC_DEMO_INSTALLED__?: InstalledDemoState;
  }
}

function parseFilenameFromDisposition(
  disposition: string | null,
  fallbackPathname: string,
): string {
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  const clean = fallbackPathname.split('/').pop() || 'download';
  return clean.includes('.') ? clean : `${clean}.dat`;
}

async function triggerBlobDownloadFromResponse(
  response: Response,
  fallbackPathname: string,
): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = await response.blob();
  if (typeof URL.createObjectURL !== 'function') return;
  const objectUrl = URL.createObjectURL(blob);
  const filename = parseFilenameFromDisposition(
    response.headers.get('content-disposition'),
    fallbackPathname,
  );
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.dataset.staticDemoBypass = 'true';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

export function installStaticDemoFetchRouter(options?: {
  store?: StaticDemoStore;
  basePath?: string;
}): StaticDemoStore | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (window.__STATIC_DEMO_INSTALLED__) {
    return window.__STATIC_DEMO_INSTALLED__.store;
  }

  const store =
    options?.store ??
    createDemoStore({
      syncAdminLocalStorage: true,
    });
  const routeRequest = createStaticDemoRouter({
    store,
    mode: 'browser',
    basePath: options?.basePath,
  });

  const nativeFetch = window.fetch.bind(window);
  const wrappedFetch: typeof window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const demoResponse = await routeRequest(input, init);
    if (demoResponse) {
      return demoResponse;
    }
    return nativeFetch(input, init);
  };

  window.fetch = wrappedFetch;

  const handleDocumentClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.dataset.staticDemoBypass === 'true') return;

    const href = anchor.getAttribute('href') || '';
    let parsed: URL;
    try {
      parsed = new URL(href, window.location.origin);
    } catch {
      return;
    }
    if (parsed.origin !== window.location.origin) return;
    const apiPath = resolveCanonicalApiPathname(parsed.pathname, options?.basePath);
    if (!apiPath) return;

    event.preventDefault();
    void routeRequest(parsed.toString(), { method: 'GET' }).then((res) => {
      if (res && res.ok) {
        return triggerBlobDownloadFromResponse(res, apiPath);
      }
      return undefined;
    });
  };

  const originalFormSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function patchedDemoFormSubmit(
    this: HTMLFormElement,
  ) {
    try {
      const actionUrl = new URL(
        this.getAttribute('action') || window.location.href,
        window.location.origin,
      );
      const apiPath = resolveCanonicalApiPathname(
        actionUrl.pathname,
        options?.basePath,
      );
      if (actionUrl.origin === window.location.origin && apiPath) {
        const method = (this.getAttribute('method') || 'GET').toUpperCase();
        const formData = new FormData(this);
        const bodyObj: Record<string, unknown> = {};
        formData.forEach((val, key) => {
          if (key === 'ids') {
            const arr = Array.isArray(bodyObj.ids) ? bodyObj.ids : [];
            arr.push(String(val));
            bodyObj.ids = arr;
          } else {
            bodyObj[key] = String(val);
          }
        });
        void routeRequest(actionUrl.toString(), {
          method,
          headers:
            method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
          body: method === 'GET' ? undefined : JSON.stringify(bodyObj),
        }).then((res) => {
          if (res && res.ok) {
            return triggerBlobDownloadFromResponse(res, apiPath);
          }
          return undefined;
        });
        return;
      }
    } catch {
      // Fall back to native submit
    }
    originalFormSubmit.call(this);
  };

  document.addEventListener('click', handleDocumentClick, true);

  const uninstall = () => {
    window.fetch = nativeFetch;
    HTMLFormElement.prototype.submit = originalFormSubmit;
    document.removeEventListener('click', handleDocumentClick, true);
    delete window.__STATIC_DEMO_INSTALLED__;
  };

  window.__STATIC_DEMO_INSTALLED__ = { store, routeRequest, uninstall };
  return store;
}

/**
 * Ensures the synchronous browser fetch router is active in static export builds.
 * Skipped automatically in Jest (`NODE_ENV === 'test'`) unless explicitly installed
 * via `installStaticDemoFetchRouter` so unit tests using MSW remain isolated.
 */
export function ensureStaticDemoRuntime(): StaticDemoStore | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (window.__STATIC_DEMO_INSTALLED__) {
    return window.__STATIC_DEMO_INSTALLED__.store;
  }
  if (process.env.NODE_ENV === 'test') {
    return null;
  }
  return installStaticDemoFetchRouter();
}

// Synchronously install at module evaluation time in browser static exports
// BEFORE any React component, hook, or QueryClient mounts.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
  ensureStaticDemoRuntime();
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;

function useStaticDemoSnapshot(): StaticDemoSnapshot | null {
  const activeStore =
    typeof window !== 'undefined'
      ? (window.__STATIC_DEMO_INSTALLED__?.store ?? ensureStaticDemoRuntime())
      : null;

  return useSyncExternalStore(
    activeStore ? activeStore.subscribe : noopSubscribe,
    activeStore ? activeStore.getSnapshot : nullSnapshot,
    nullSnapshot,
  );
}

export interface StaticDemoPageOverrides {
  isActive: boolean;
  isSetupMode: boolean;
  isAdminAuthenticated: boolean;
  config: PublicAppConfig;
  contentNodes: ContentNodeDTO[];
  faqs: ContentNodeDTO[];
  attractions: AttractionDTO[];
  weddingParty: WeddingPartyMemberDTO[];
  galleryPhotos: Array<{
    id: string;
    mediaId?: string;
    url: string;
    title: string;
    caption?: string;
    uploaderName?: string;
    isGuestUpload: boolean;
    category: 'curated' | 'guest';
  }>;
}

export function useStaticDemoPageOverrides(): StaticDemoPageOverrides | null {
  const snapshot = useStaticDemoSnapshot();

  return useMemo(() => {
    if (!snapshot) return null;

    const rawConfig = getActiveAppConfig(snapshot);
    const config = toPublicConfigDto(rawConfig) as unknown as PublicAppConfig;
    const contentNodes = snapshot.contentNode as unknown as ContentNodeDTO[];
    const faqs = snapshot.contentNode.filter(
      (n) => n.type.toUpperCase() === 'FAQ' && n.data?.isVisible !== false,
    ) as unknown as ContentNodeDTO[];
    const attractions = snapshot.attraction
      .filter((a) => a.isVisible !== false)
      .map((a) => toAttractionDto(snapshot, a)) as unknown as AttractionDTO[];
    const weddingParty = [...snapshot.weddingPartyMember]
      .sort((a, b) => a.order - b.order)
      .map((m) =>
        toWeddingPartyDto(snapshot, m),
      ) as unknown as WeddingPartyMemberDTO[];
    const galleryPhotos = snapshot.contentNode
      .filter((n) => {
        if (n.type.toUpperCase() !== 'PHOTO') return false;
        const status = String(n.data?.status ?? 'APPROVED').toUpperCase();
        return status !== 'PENDING' && status !== 'REJECTED' && n.data?.isVisible !== false;
      })
      .map((n) => {
        const dto = toPhotoDto(snapshot, n);
        const catRaw = String(dto.category ?? 'Curated').toLowerCase();
        const isGuest = catRaw === 'guest';
        return {
          id: String(dto.id),
          mediaId: typeof dto.mediaId === 'string' ? dto.mediaId : undefined,
          url: String(dto.url),
          title: String(dto.title || 'Wedding Photo'),
          caption: typeof dto.caption === 'string' && dto.caption ? dto.caption : undefined,
          uploaderName:
            typeof dto.uploaderName === 'string' && dto.uploaderName
              ? dto.uploaderName
              : undefined,
          isGuestUpload: isGuest,
          category: isGuest ? ('guest' as const) : ('curated' as const),
        };
      });

    return {
      isActive: true,
      isSetupMode: snapshot.isSetupMode,
      isAdminAuthenticated: snapshot.isAdminAuthenticated,
      config,
      contentNodes,
      faqs,
      attractions,
      weddingParty,
      galleryPhotos,
    };
  }, [snapshot]);
}

export interface StaticDemoSavedSetupConfig {
  step?: 1 | 2 | 3 | 4 | 5;
  partner1Name?: string;
  partner2Name?: string;
  weddingDate?: string;
  ceremonyTime?: string;
  baseUrl?: string;
  contactEmail?: string;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  venueState?: string;
  venueZip?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  themePreset?: PublicAppConfig['themePreset'];
  colorPrimary?: string;
  colorSecondary?: string;
  enabledFeatures?: ModuleConfig;
}

export function getStaticDemoSavedSetupConfig():
  | StaticDemoSavedSetupConfig
  | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const activeStore = window.__STATIC_DEMO_INSTALLED__?.store;
  if (!activeStore) {
    return undefined;
  }
  const snapshot = activeStore.getSnapshot();
  const rawConfig = getActiveAppConfig(snapshot);
  if (!snapshot.setupStep2Saved || rawConfig.setupCompleted !== false) {
    return undefined;
  }
  const partner1Name = (
    rawConfig.partner1Name ||
    rawConfig.brideName ||
    ''
  ).trim();
  const partner2Name = (
    rawConfig.partner2Name ||
    rawConfig.groomName ||
    ''
  ).trim();
  const baseUrl = (rawConfig.baseUrl || '').trim();
  if (!partner1Name || !partner2Name || !baseUrl) {
    return undefined;
  }

  const publicCfg = toPublicConfigDto(rawConfig);
  const cleanVenue = (val: string | null | undefined) =>
    val && val.trim().toUpperCase() !== 'TBD' ? val.trim() : '';
  const resolvedTimezone = rawConfig.timezone || 'America/Chicago';
  const hydratedDateTime = extractVenueDateAndTime(
    rawConfig.weddingDate,
    resolvedTimezone,
  );

  return {
    step: 3,
    partner1Name,
    partner2Name,
    weddingDate: hydratedDateTime.date,
    ceremonyTime: hydratedDateTime.time,
    baseUrl,
    contactEmail: (rawConfig.contactEmail || '').trim(),
    venueName: cleanVenue(rawConfig.venueName),
    venueAddress: cleanVenue(rawConfig.venueAddress),
    venueCity: cleanVenue(rawConfig.venueCity),
    venueState: cleanVenue(rawConfig.venueState),
    venueZip: cleanVenue(rawConfig.venueZip),
    ...(typeof rawConfig.latitude === 'number' && Number.isFinite(rawConfig.latitude)
      ? { latitude: rawConfig.latitude }
      : {}),
    ...(typeof rawConfig.longitude === 'number' && Number.isFinite(rawConfig.longitude)
      ? { longitude: rawConfig.longitude }
      : {}),
    timezone: resolvedTimezone,
    themePreset: publicCfg.themePreset as PublicAppConfig['themePreset'],
    colorPrimary: rawConfig.colorPrimary || undefined,
    colorSecondary: rawConfig.colorSecondary || undefined,
    enabledFeatures: resolveModuleConfig(publicCfg.modules),
  };
}

export function completeStaticDemoSetup(): void {
  if (typeof window === 'undefined') return;
  const activeStore = window.__STATIC_DEMO_INSTALLED__?.store;
  if (!activeStore) return;
  activeStore.mutate((draft) => {
    draft.isSetupMode = false;
    draft.setupStep2Saved = false;
    draft.isAdminAuthenticated = true;
    const cfg = getActiveAppConfig(draft);
    cfg.setupCompleted = true;
  });
}

export function StaticDemoMount({
  queryClient,
}: {
  queryClient?: QueryClient;
}) {
  const snapshot = useStaticDemoSnapshot();
  const activeStore =
    typeof window !== 'undefined'
      ? (window.__STATIC_DEMO_INSTALLED__?.store ?? null)
      : null;

  if (!snapshot || !activeStore) {
    return null;
  }

  return React.createElement(StaticDemoToolbar, {
    store: activeStore,
    queryClient,
  });
}
