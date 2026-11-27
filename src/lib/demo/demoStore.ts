import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import type {
  ContributorRecord,
  GuestClaimActions,
  HouseholdMemberDTO,
  HouseholdMemberRole,
  InvitationCodeDTO,
  OrderTrackingDetails,
  RegistryItem,
  RegistryShippingAddress,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import type { AttractionDTO } from '@/features/attractions';
import type { ContentNodeDTO } from '@/features/content';
import type { MediaDTO } from '@/features/media';
import type { SubEventDTO } from '@/features/sub-events';
import { resolveModuleConfig, type ModuleConfig } from '@/lib/modules';
import { CARD_PROCESSING_FEE_RATE } from '@/lib/stripe.client';
import { withBasePath } from '@/lib/basePath';
import { notifyGuestSessionChanged } from '@/utils/guestSessionEvents';
import { normalizePartyTags, splitMemberFullName } from '@/utils/invitationValidation';
import {
  buildArchetypeDataset,
  buildDemoHouseholdMembersForGuest,
  DEMO_SHIPPING_ADDRESS,
  type ArchetypeDataset,
  type DemoBroadcastRecord,
  type DemoFeatureItem,
  type DemoPhotoRecord,
  type DemoSnapshotVersionRecord,
  type DemoSubEventAccessRecord,
  type DemoSubEventMemberRsvpRecord,
} from './demoSeed';
import {
  isDemoRuntimeActive,
  registerDemoRuntimeBridge,
  setDemoBridgeRuntimeActive,
} from './demoRuntimeBridge';

function isDemoAddressCollectionOnly(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

export type DemoPersona = 'guest' | 'admin' | 'setup';

export interface DemoGuestSession {
  invitationCode: string;
  guestName: string;
}

interface DemoClaimTokenRecord {
  itemId: string;
  contributorId: string;
  action: 'confirm' | 'cancel';
}

export interface DemoClaimPreview {
  action: 'confirm' | 'cancel';
  status: ContributorRecord['status'];
  amount: number;
  itemId: string;
  itemName: string;
  itemType: 'PHYSICAL' | 'CASH_FUND' | 'EXPERIENCE_FUND';
  isGroupGift: boolean;
  vendorUrl: string | null;
  shippingAddress: RegistryShippingAddress | null;
  paymentHandle: string | null;
  paymentHandleType: string | null;
  contributorName: string;
}

export interface DemoStoreState {
  persona: DemoPersona;
  archetype: ArchetypeId;
  themePreset: ThemePreset;
  isToolbarCollapsed: boolean;
  setupAuthenticated: boolean;
  configOverrides: Partial<PublicAppConfig>;
  activeModules: string[];
  datasets: Record<ArchetypeId, ArchetypeDataset>;
  guestSession: DemoGuestSession | null;
  claimTokens: Record<string, DemoClaimTokenRecord>;
  resetCounter: number;
}

const DEMO_STORAGE_KEY = 'wedding_showcase_demo_v1';
const SETUP_WIZARD_DRAFT_KEY = 'setup_wizard_draft';
const DEMO_PERSISTENT_PHOTO_CAP_BYTES = 512 * 1024;
const MAX_STORED_SNAPSHOT_VERSIONS = 25;

const ALL_DEMO_MODULES = [
  'registry',
  'guests',
  'seating',
  'weddingParty',
  'attractions',
  'faqs',
  'gallery',
  'subEvents',
];

const VALID_PERSONAS: DemoPersona[] = ['guest', 'admin', 'setup'];
const VALID_ARCHETYPES: ArchetypeId[] = ['classic', 'destination', 'romantic'];

const RAW_DATASETS = Symbol('rawDemoDatasets');

type LazyDatasetMap = Record<ArchetypeId, ArchetypeDataset> & {
  [RAW_DATASETS]?: Partial<Record<ArchetypeId, ArchetypeDataset>>;
};

function createLazyDatasets(
  initial: Partial<Record<ArchetypeId, ArchetypeDataset>> = {}
): Record<ArchetypeId, ArchetypeDataset> {
  const materialized: Partial<Record<ArchetypeId, ArchetypeDataset>> = {
    ...initial,
  };

  return new Proxy(materialized as LazyDatasetMap, {
    get(target, prop, receiver) {
      if (prop === RAW_DATASETS) {
        return target;
      }
      if (prop === 'toJSON') {
        return () => ({ ...target });
      }
      if (
        typeof prop === 'string' &&
        (VALID_ARCHETYPES as readonly string[]).includes(prop)
      ) {
        const key = prop as ArchetypeId;
        if (!target[key]) {
          target[key] = buildArchetypeDataset(key);
        }
        return target[key];
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function getMaterializedDatasets(
  datasets: Record<ArchetypeId, ArchetypeDataset>
): Partial<Record<ArchetypeId, ArchetypeDataset>> {
  const raw = (datasets as LazyDatasetMap)[RAW_DATASETS];
  return raw ? { ...raw } : { ...datasets };
}

function withUpdatedDataset(
  datasets: Record<ArchetypeId, ArchetypeDataset>,
  archetype: ArchetypeId,
  nextDataset: ArchetypeDataset
): Record<ArchetypeId, ArchetypeDataset> {
  return createLazyDatasets({
    ...getMaterializedDatasets(datasets),
    [archetype]: nextDataset,
  });
}

// Active session blob URL tracking for >512 KB uploads (kept out of localStorage)
const sessionBlobFallbacks = new Map<string, string>();

function revokeAllSessionBlobs(): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    for (const blobUrl of sessionBlobFallbacks.keys()) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Ignore blob revocation errors in non-browser test runners
      }
    }
  }
  sessionBlobFallbacks.clear();
}

function createBase64SvgPlaceholder(label: string): string {
  const safe = label
    .slice(0, 32)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="#fdf2f8"/><text x="300" y="205" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="600" fill="#9d174d">${safe || 'Uploaded Photo'}</text></svg>`;
  if (typeof Buffer !== 'undefined') {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export interface EncodedDemoUpload {
  url: string;
  persistentUrl: string;
  isSessionBlob: boolean;
  sizeBytes: number;
  mimeType: string;
}

export async function encodeDemoUploadedFile(
  file: Blob,
  fallbackLabel = 'Guest Photo'
): Promise<EncodedDemoUpload> {
  const mimeType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  const sizeBytes = typeof file.size === 'number' ? file.size : 0;

  if (sizeBytes > DEMO_PERSISTENT_PHOTO_CAP_BYTES) {
    const persistentUrl = createBase64SvgPlaceholder(fallbackLabel);
    let sessionUrl = persistentUrl;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        sessionUrl = URL.createObjectURL(file);
        sessionBlobFallbacks.set(sessionUrl, persistentUrl);
      } catch {
        sessionUrl = persistentUrl;
      }
    }
    return {
      url: sessionUrl,
      persistentUrl,
      isSessionBlob: sessionUrl.startsWith('blob:'),
      sizeBytes,
      mimeType,
    };
  }

  let arrayBuffer: ArrayBuffer;
  if (typeof file.arrayBuffer === 'function') {
    arrayBuffer = await file.arrayBuffer();
  } else {
    arrayBuffer = await new Response(file).arrayBuffer();
  }
  const encoded = `data:${mimeType};base64,${bytesToBase64(new Uint8Array(arrayBuffer))}`;
  return {
    url: encoded,
    persistentUrl: encoded,
    isSessionBlob: false,
    sizeBytes,
    mimeType,
  };
}

function createInitialDemoState(resetCounter = 0): DemoStoreState {
  return {
    persona: 'guest',
    archetype: 'classic',
    themePreset: 'classic',
    isToolbarCollapsed: false,
    setupAuthenticated: false,
    configOverrides: {},
    activeModules: [...ALL_DEMO_MODULES],
    datasets: createLazyDatasets(),
    guestSession: null,
    claimTokens: {},
    resetCounter,
  };
}

function toDateInstance(val: unknown, fallbackIso = '2026-01-15T12:00:00.000Z'): Date {
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  const parsed = new Date(String(val ?? fallbackIso));
  return Number.isNaN(parsed.getTime()) ? new Date(fallbackIso) : parsed;
}

function syncTableGuests(
  tables: SeatingTableDTO[],
  guests: InvitationCodeDTO[]
): SeatingTableDTO[] {
  return tables.map((table) => ({
    ...table,
    invitationCodes: guests.filter((g) => g.tableId === table.id),
  }));
}

function reviveDatasetDates(
  rawDataset: Partial<ArchetypeDataset>,
  fallbackDataset: ArchetypeDataset
): ArchetypeDataset {
  const merged: ArchetypeDataset = {
    ...fallbackDataset,
    ...rawDataset,
    registryItems: Array.isArray(rawDataset.registryItems)
      ? rawDataset.registryItems
      : fallbackDataset.registryItems,
    offlineContributors: Array.isArray(rawDataset.offlineContributors)
      ? rawDataset.offlineContributors
      : fallbackDataset.offlineContributors,
    guests: Array.isArray(rawDataset.guests) ? rawDataset.guests : fallbackDataset.guests,
    seatingTables: Array.isArray(rawDataset.seatingTables)
      ? rawDataset.seatingTables
      : fallbackDataset.seatingTables,
    weddingParty: (Array.isArray(rawDataset.weddingParty)
      ? rawDataset.weddingParty
      : fallbackDataset.weddingParty
    ).map((m) => ({
      ...m,
      createdAt: toDateInstance(m.createdAt),
      updatedAt: toDateInstance(m.updatedAt),
    })),
    attractions: (Array.isArray(rawDataset.attractions)
      ? rawDataset.attractions
      : fallbackDataset.attractions
    ).map((a) => ({
      ...a,
      createdAt: toDateInstance(a.createdAt),
      updatedAt: toDateInstance(a.updatedAt),
    })),
    faqs: (Array.isArray(rawDataset.faqs) ? rawDataset.faqs : fallbackDataset.faqs).map((f) => ({
      ...f,
      createdAt: toDateInstance(f.createdAt),
      updatedAt: toDateInstance(f.updatedAt),
    })),
    logisticsNodes: (Array.isArray(rawDataset.logisticsNodes)
      ? rawDataset.logisticsNodes
      : fallbackDataset.logisticsNodes
    ).map((n) => ({
      ...n,
      createdAt: toDateInstance(n.createdAt),
      updatedAt: toDateInstance(n.updatedAt),
    })),
    scheduleNodes: (Array.isArray(rawDataset.scheduleNodes)
      ? rawDataset.scheduleNodes
      : fallbackDataset.scheduleNodes
    ).map((n) => ({
      ...n,
      createdAt: toDateInstance(n.createdAt),
      updatedAt: toDateInstance(n.updatedAt),
    })),
    customNodes: (Array.isArray(rawDataset.customNodes)
      ? rawDataset.customNodes
      : fallbackDataset.customNodes
    ).map((n) => ({
      ...n,
      createdAt: toDateInstance(n.createdAt),
      updatedAt: toDateInstance(n.updatedAt),
    })),
    photos: Array.isArray(rawDataset.photos) ? rawDataset.photos : fallbackDataset.photos,
    media: (Array.isArray(rawDataset.media) ? rawDataset.media : fallbackDataset.media).map(
      (m) => ({
        ...m,
        createdAt: toDateInstance(m.createdAt),
        updatedAt: toDateInstance(m.updatedAt),
      })
    ),
    subEvents: Array.isArray(rawDataset.subEvents)
      ? rawDataset.subEvents
      : fallbackDataset.subEvents,
    subEventAccess: Array.isArray(rawDataset.subEventAccess)
      ? rawDataset.subEventAccess
      : fallbackDataset.subEventAccess,
    subEventRsvps: Array.isArray(rawDataset.subEventRsvps)
      ? rawDataset.subEventRsvps
      : fallbackDataset.subEventRsvps,
    features: Array.isArray(rawDataset.features) ? rawDataset.features : fallbackDataset.features,
    modules:
      rawDataset.modules && typeof rawDataset.modules === 'object'
        ? resolveModuleConfig(rawDataset.modules)
        : fallbackDataset.modules,
    broadcastMessages: Array.isArray(rawDataset.broadcastMessages)
      ? rawDataset.broadcastMessages
      : fallbackDataset.broadcastMessages,
    snapshotVersions: Array.isArray(rawDataset.snapshotVersions)
      ? rawDataset.snapshotVersions
      : fallbackDataset.snapshotVersions,
    siteConfig:
      rawDataset.siteConfig && typeof rawDataset.siteConfig === 'object'
        ? { ...fallbackDataset.siteConfig, ...rawDataset.siteConfig }
        : fallbackDataset.siteConfig,
  };
  return {
    ...merged,
    seatingTables: syncTableGuests(merged.seatingTables, merged.guests),
  };
}

interface StaticDemoStoreBridge {
  getSnapshot?: () => { activeArchetype?: ArchetypeId };
  switchArchetype: (archetype: ArchetypeId) => unknown;
  setSetupMode: (enabled: boolean) => unknown;
  reset: (archetype?: ArchetypeId) => unknown;
  mutate: <T>(
    mutator: (draft: {
      isAdminAuthenticated: boolean;
      isSetupMode: boolean;
      guestSession: {
        code: string;
        guestName: string;
        sessionType: 'invite' | 'guest';
      } | null;
      appConfig: Array<Record<string, unknown>>;
      registryItem: Array<{ isSample?: boolean }>;
      invitationCode: Array<{ isSample?: boolean }>;
      seatingTable: Array<{ isSample?: boolean }>;
      weddingPartyMember: Array<{ isSample?: boolean }>;
      attraction: Array<{ isSample?: boolean }>;
      contentNode: Array<{ type: string; data?: Record<string, unknown> }>;
    }) => T
  ) => T;
}

function getStaticDemoStoreBridge(): StaticDemoStoreBridge | null {
  if (typeof window === 'undefined') return null;
  const installed = (
    window as Window & {
      __STATIC_DEMO_INSTALLED__?: { store?: StaticDemoStoreBridge };
    }
  ).__STATIC_DEMO_INSTALLED__;
  return installed?.store ?? null;
}

function syncStaticDemoPersona(persona: DemoPersona, setupAuthenticated: boolean): void {
  const bridge = getStaticDemoStoreBridge();
  if (!bridge) return;
  if (persona === 'admin') {
    bridge.setSetupMode(false);
    bridge.mutate((draft) => {
      draft.isAdminAuthenticated = true;
    });
  } else if (persona === 'setup') {
    bridge.setSetupMode(true);
    bridge.mutate((draft) => {
      draft.isAdminAuthenticated = setupAuthenticated;
    });
  } else {
    bridge.setSetupMode(false);
    bridge.mutate((draft) => {
      draft.isAdminAuthenticated = false;
    });
  }
}

function syncStaticDemoThemePreset(themePreset: ThemePreset): void {
  const bridge = getStaticDemoStoreBridge();
  if (!bridge) return;
  bridge.mutate((draft) => {
    const cfg = draft.appConfig[0];
    if (!cfg) return;
    cfg.themePreset = themePreset;
    cfg.colorPrimary = null;
    cfg.colorSecondary = null;
  });
}

function syncStaticDemoGuestSession(session: DemoGuestSession | null): void {
  const bridge = getStaticDemoStoreBridge();
  if (!bridge) return;
  bridge.mutate((draft) => {
    draft.guestSession = session
      ? {
        code: session.invitationCode,
        guestName: session.guestName,
        sessionType: 'invite',
      }
      : null;
  });
}

function syncStaticDemoConfigOverrides(overrides: Partial<PublicAppConfig>): void {
  const bridge = getStaticDemoStoreBridge();
  if (!bridge) return;
  bridge.mutate((draft) => {
    const cfg = draft.appConfig[0];
    if (!cfg) return;
    if (typeof overrides.partner1Name === 'string' && overrides.partner1Name.trim()) {
      cfg.partner1Name = overrides.partner1Name.trim();
      cfg.brideName = overrides.partner1Name.trim();
    }
    if (typeof overrides.partner2Name === 'string' && overrides.partner2Name.trim()) {
      cfg.partner2Name = overrides.partner2Name.trim();
      cfg.groomName = overrides.partner2Name.trim();
    }
    if (overrides.weddingDate instanceof Date && !Number.isNaN(overrides.weddingDate.getTime())) {
      cfg.weddingDate = overrides.weddingDate.toISOString();
    }
    if (typeof overrides.venueName === 'string') cfg.venueName = overrides.venueName;
    if (typeof overrides.venueAddress === 'string') cfg.venueAddress = overrides.venueAddress;
    if (typeof overrides.venueCity === 'string') cfg.venueCity = overrides.venueCity;
    if (typeof overrides.venueState === 'string') cfg.venueState = overrides.venueState;
    if (typeof overrides.venueZip === 'string') cfg.venueZip = overrides.venueZip;
    if (typeof overrides.latitude === 'number' && Number.isFinite(overrides.latitude)) {
      cfg.latitude = overrides.latitude;
    }
    if (typeof overrides.longitude === 'number' && Number.isFinite(overrides.longitude)) {
      cfg.longitude = overrides.longitude;
    }
    if (typeof overrides.timezone === 'string' && overrides.timezone.trim()) {
      cfg.timezone = overrides.timezone.trim();
    }
    if (typeof overrides.contactEmail === 'string') cfg.contactEmail = overrides.contactEmail;
    if (typeof overrides.themePreset === 'string' && overrides.themePreset.trim()) {
      cfg.themePreset = overrides.themePreset.trim();
    }
    if (typeof overrides.colorPrimary === 'string' && overrides.colorPrimary.trim()) {
      cfg.colorPrimary = overrides.colorPrimary.trim();
    }
    if (typeof overrides.colorSecondary === 'string' && overrides.colorSecondary.trim()) {
      cfg.colorSecondary = overrides.colorSecondary.trim();
    }
    if (Array.isArray(overrides.features)) {
      cfg.features = overrides.features;
    }
    if (overrides.modules && typeof overrides.modules === 'object') {
      const existingModules =
        cfg.modules && typeof cfg.modules === 'object'
          ? (cfg.modules as Record<string, unknown>)
          : {};
      cfg.modules = { ...existingModules, ...overrides.modules };
    }
  });
}

let hasHydratedFromStorage = false;
let state: DemoStoreState | null = null;
const listeners = new Set<() => void>();

function ensureState(): DemoStoreState {
  if (!state) {
    state = createInitialDemoState(0);
  }
  return state;
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function sanitizeUrlForStorage(url: string): string {
  if (!url.startsWith('blob:')) return url;
  return sessionBlobFallbacks.get(url) ?? createBase64SvgPlaceholder('Session Upload');
}

function serializeStateForStorage(source: DemoStoreState, compactUploads = false): string {
  return JSON.stringify(source, (key, value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('blob:')) {
        return sanitizeUrlForStorage(value);
      }
      if (compactUploads && key === 'url' && value.startsWith('data:image/') && value.length > 8192) {
        return createBase64SvgPlaceholder('Compacted Photo');
      }
    }
    return value;
  });
}

function persistDemoState(): void {
  if (!isDemoRuntimeActive() || typeof window === 'undefined' || !state) return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, serializeStateForStorage(state, false));
  } catch {
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, serializeStateForStorage(state, true));
    } catch {
      // Ignore storage quota or privacy mode errors
    }
  }
}

export function hydrateDemoStateFromStorage(): void {
  if (typeof window === 'undefined') return;
  hasHydratedFromStorage = true;
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<DemoStoreState>;
    const currentResetCounter = state?.resetCounter ?? 0;

    const persona: DemoPersona =
      parsed.persona && VALID_PERSONAS.includes(parsed.persona) ? parsed.persona : 'guest';
    const archetype: ArchetypeId =
      parsed.archetype && VALID_ARCHETYPES.includes(parsed.archetype)
        ? parsed.archetype
        : 'classic';
    const themePreset: ThemePreset =
      parsed.themePreset && THEME_PRESET_KEYS.includes(parsed.themePreset)
        ? parsed.themePreset
        : 'classic';

    const hydratedSeed: Partial<Record<ArchetypeId, ArchetypeDataset>> = {};
    for (const key of VALID_ARCHETYPES) {
      const savedDataset = parsed.datasets?.[key];
      if (savedDataset) {
        hydratedSeed[key] = reviveDatasetDates(savedDataset, buildArchetypeDataset(key));
      }
    }

    state = {
      persona,
      archetype,
      themePreset,
      isToolbarCollapsed: Boolean(parsed.isToolbarCollapsed),
      setupAuthenticated: Boolean(parsed.setupAuthenticated),
      configOverrides:
        parsed.configOverrides && typeof parsed.configOverrides === 'object'
          ? {
            ...parsed.configOverrides,
            ...(parsed.configOverrides.weddingDate
              ? {
                weddingDate:
                  parsed.configOverrides.weddingDate instanceof Date
                    ? parsed.configOverrides.weddingDate
                    : new Date(String(parsed.configOverrides.weddingDate)),
              }
              : {}),
          }
          : {},
      activeModules: Array.isArray(parsed.activeModules)
        ? parsed.activeModules.filter((m): m is string => typeof m === 'string')
        : [...ALL_DEMO_MODULES],
      datasets: createLazyDatasets(hydratedSeed),
      guestSession:
        parsed.guestSession &&
        typeof parsed.guestSession.invitationCode === 'string' &&
        typeof parsed.guestSession.guestName === 'string'
          ? parsed.guestSession
          : null,
      claimTokens:
        parsed.claimTokens && typeof parsed.claimTokens === 'object' ? parsed.claimTokens : {},
      resetCounter: currentResetCounter,
    };
    const bridge = getStaticDemoStoreBridge();
    if (bridge) {
      if (bridge.getSnapshot?.().activeArchetype !== state.archetype) {
        bridge.switchArchetype(state.archetype);
      }
      syncStaticDemoThemePreset(state.themePreset);
      syncStaticDemoPersona(state.persona, state.setupAuthenticated);
      syncStaticDemoConfigOverrides(state.configOverrides);
      syncStaticDemoGuestSession(state.guestSession);
    }
    emitChange();
  } catch {
    // Ignore malformed saved state
  }
}

export function setDemoRuntimeActive(active: boolean): void {
  setDemoBridgeRuntimeActive(active);
  if (active && !hasHydratedFromStorage && typeof window !== 'undefined') {
    hydrateDemoStateFromStorage();
  }
  emitChange();
}

export { isDemoRuntimeActive };

export function isDemoAdminSession(): boolean {
  if (!isDemoRuntimeActive()) return false;
  const current = ensureState();
  return (
    current.persona === 'admin' ||
    (current.persona === 'setup' && current.setupAuthenticated)
  );
}

export function getDemoState(): DemoStoreState {
  return ensureState();
}

export function subscribeDemoState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateState(updater: (prev: DemoStoreState) => DemoStoreState): void {
  const current = ensureState();
  const prevGuestCode = current.guestSession?.invitationCode ?? null;
  state = updater(current);
  const nextGuestCode = state.guestSession?.invitationCode ?? null;
  persistDemoState();
  emitChange();
  if (isDemoRuntimeActive() && prevGuestCode !== nextGuestCode) {
    notifyGuestSessionChanged();
  }
}

export function setDemoPersona(persona: DemoPersona): void {
  updateState((prev) => ({
    ...prev,
    persona,
  }));
  syncStaticDemoPersona(persona, ensureState().setupAuthenticated);
}

export function setDemoArchetype(archetype: ArchetypeId): void {
  updateState((prev) => {
    const nextDataset = prev.datasets[archetype];
    const currentCode = prev.guestSession?.invitationCode?.toUpperCase() ?? '';
    const matchingGuest = currentCode
      ? nextDataset.guests.find(
        (g) => g.code.toUpperCase() === currentCode && !isDemoAddressCollectionOnly(g.partyTags)
      )
      : undefined;

    return {
      ...prev,
      archetype,
      guestSession: matchingGuest
        ? { invitationCode: matchingGuest.code, guestName: matchingGuest.guestName }
        : null,
    };
  });
  const current = ensureState();
  const bridge = getStaticDemoStoreBridge();
  if (bridge) {
    bridge.switchArchetype(archetype);
    syncStaticDemoPersona(current.persona, current.setupAuthenticated);
    syncStaticDemoConfigOverrides(current.configOverrides);
    syncStaticDemoGuestSession(current.guestSession);
  }
}

export function setDemoThemePreset(themePreset: ThemePreset): void {
  updateState((prev) => {
    const nextOverrides = { ...prev.configOverrides };
    delete nextOverrides.colorPrimary;
    delete nextOverrides.colorSecondary;
    nextOverrides.themePreset = themePreset;
    return {
      ...prev,
      themePreset,
      configOverrides: nextOverrides,
    };
  });
  syncStaticDemoThemePreset(themePreset);
}

export function setDemoToolbarCollapsed(collapsed: boolean): void {
  updateState((prev) => ({
    ...prev,
    isToolbarCollapsed: collapsed,
  }));
}

export function setDemoSetupAuthenticated(authenticated: boolean): void {
  updateState((prev) => ({
    ...prev,
    setupAuthenticated: authenticated,
  }));
  syncStaticDemoPersona(ensureState().persona, authenticated);
}

export function updateDemoConfigOverrides(overrides: Partial<PublicAppConfig>): void {
  updateState((prev) => {
    const nextThemePreset =
      overrides.themePreset && THEME_PRESET_KEYS.includes(overrides.themePreset as ThemePreset)
        ? (overrides.themePreset as ThemePreset)
        : prev.themePreset;
    const hasFeatureOrModuleOverrides =
      Array.isArray(overrides.features) ||
      Boolean(overrides.modules && typeof overrides.modules === 'object');
    if (!hasFeatureOrModuleOverrides) {
      return {
        ...prev,
        themePreset: nextThemePreset,
        configOverrides: {
          ...prev.configOverrides,
          ...overrides,
        },
      };
    }
    const currentDataset = prev.datasets[prev.archetype];
    const nextDataset: ArchetypeDataset = {
      ...currentDataset,
      ...(Array.isArray(overrides.features) ? { features: overrides.features } : {}),
      ...(overrides.modules && typeof overrides.modules === 'object'
        ? { modules: resolveModuleConfig(overrides.modules) }
        : {}),
    };
    return {
      ...prev,
      themePreset: nextThemePreset,
      configOverrides: {
        ...prev.configOverrides,
        ...overrides,
      },
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, nextDataset),
    };
  });
  syncStaticDemoConfigOverrides(overrides);
}

export function applyDemoSampleSelection(archetype: ArchetypeId, modules: string[]): void {
  const normalizedModules = [...modules];
  if (normalizedModules.length > 0) {
    if (!normalizedModules.includes('gallery')) normalizedModules.push('gallery');
    if (!normalizedModules.includes('subEvents')) normalizedModules.push('subEvents');
  }
  updateState((prev) => ({
    ...prev,
    archetype,
    activeModules: normalizedModules,
    datasets: withUpdatedDataset(prev.datasets, archetype, buildArchetypeDataset(archetype)),
  }));
  const current = ensureState();
  const bridge = getStaticDemoStoreBridge();
  if (bridge) {
    bridge.switchArchetype(archetype);
    syncStaticDemoPersona(current.persona, current.setupAuthenticated);
    syncStaticDemoConfigOverrides(current.configOverrides);
  }
}

export function purgeDemoSampleData(): void {
  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const filteredGuests = current.guests.filter((g) => !g.isSample);
    const filteredTables = syncTableGuests(
      current.seatingTables.filter((t) => !t.isSample),
      filteredGuests
    );
    const filteredSubEvents = current.subEvents.filter(
      (se) => !(se as SubEventDTO & { isSample?: boolean }).isSample
    );
    const validSubEventIds = new Set(filteredSubEvents.map((se) => se.id));
    const validGuestIds = new Set(filteredGuests.map((g) => g.id));
    return {
      ...prev,
      activeModules: [],
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...current,
        registryItems: current.registryItems.filter((i) => !i.isSample),
        offlineContributors: current.offlineContributors.filter(
          (c) => !(c.id ?? '').startsWith(`demo-${prev.archetype}-offline-contrib-`)
        ),
        guests: filteredGuests,
        seatingTables: filteredTables,
        weddingParty: current.weddingParty.filter((m) => !m.isSample),
        attractions: current.attractions.filter((a) => !a.isSample),
        faqs: [],
        scheduleNodes: [],
        photos: current.photos.filter((p) => !p.isSample),
        media: current.media.filter((m) => !m.isSample),
        subEvents: filteredSubEvents,
        subEventAccess: current.subEventAccess.filter(
          (a) => validSubEventIds.has(a.subEventId) && validGuestIds.has(a.invitationCodeId)
        ),
        subEventRsvps: current.subEventRsvps.filter(
          (r) => validSubEventIds.has(r.subEventId) && validGuestIds.has(r.invitationCodeId)
        ),
        broadcastMessages: current.broadcastMessages.filter((b) => !b.isSample),
      }),
    };
  });
  getStaticDemoStoreBridge()?.mutate((draft) => {
    draft.registryItem = draft.registryItem.filter((i) => !i.isSample);
    draft.invitationCode = draft.invitationCode.filter((g) => !g.isSample);
    draft.seatingTable = draft.seatingTable.filter((t) => !t.isSample);
    draft.weddingPartyMember = draft.weddingPartyMember.filter((m) => !m.isSample);
    draft.attraction = draft.attraction.filter((a) => !a.isSample);
    draft.contentNode = draft.contentNode.filter(
      (n) => !(n.type.toUpperCase() === 'FAQ' && Boolean(n.data?.isSample))
    );
  });
}

export function resetDemoState(): void {
  const hadGuestSession = Boolean(state?.guestSession);
  revokeAllSessionBlobs();
  const nextResetCounter = (state?.resetCounter ?? 0) + 1;
  state = createInitialDemoState(nextResetCounter);
  hasHydratedFromStorage = true;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      window.localStorage.removeItem(SETUP_WIZARD_DRAFT_KEY);
      window.localStorage.removeItem('isAdminLoggedIn');
    } catch {
      // Ignore storage errors
    }
  }
  const bridge = getStaticDemoStoreBridge();
  if (bridge) {
    bridge.reset('classic');
    syncStaticDemoPersona('guest', false);
  }
  emitChange();
  if (isDemoRuntimeActive() && hadGuestSession) {
    notifyGuestSessionChanged();
  }
}

export function getActiveArchetypeDataset(
  targetState: DemoStoreState = ensureState()
): ArchetypeDataset {
  const current = targetState.datasets[targetState.archetype] ?? targetState.datasets.classic;
  const activeSet = new Set(targetState.activeModules);
  const hasGallery = activeSet.has('gallery') || activeSet.has('faqs');
  const hasSubEvents = activeSet.has('subEvents') || activeSet.has('guests');
  return {
    ...current,
    registryItems: activeSet.has('registry')
      ? current.registryItems
      : current.registryItems.filter((i) => !i.isSample),
    offlineContributors: activeSet.has('registry')
      ? current.offlineContributors
      : current.offlineContributors.filter(
        (c) => !(c.id ?? '').startsWith(`demo-${targetState.archetype}-offline-contrib-`)
      ),
    guests: activeSet.has('guests')
      ? current.guests
      : current.guests.filter((g) => !g.isSample),
    seatingTables: activeSet.has('seating')
      ? current.seatingTables
      : current.seatingTables.filter((t) => !t.isSample),
    weddingParty: activeSet.has('weddingParty')
      ? current.weddingParty
      : current.weddingParty.filter((m) => !m.isSample),
    attractions: activeSet.has('attractions')
      ? current.attractions
      : current.attractions.filter((a) => !a.isSample),
    faqs: activeSet.has('faqs') ? current.faqs : [],
    logisticsNodes: current.logisticsNodes,
    scheduleNodes: hasSubEvents ? current.scheduleNodes : [],
    customNodes: current.customNodes,
    photos: hasGallery ? current.photos : current.photos.filter((p) => !p.isSample),
    media: hasGallery ? current.media : current.media.filter((m) => !m.isSample),
    subEvents: hasSubEvents
      ? current.subEvents
      : current.subEvents.filter(
        (se) => !(se as SubEventDTO & { isSample?: boolean }).isSample
      ),
    subEventAccess: hasSubEvents ? current.subEventAccess : [],
    subEventRsvps: hasSubEvents ? current.subEventRsvps : [],
    features: current.features,
    modules: current.modules,
    broadcastMessages: current.broadcastMessages,
    snapshotVersions: current.snapshotVersions,
    siteConfig: current.siteConfig,
  };
}

export function findDemoGuestByCode(rawCode: string): InvitationCodeDTO | null {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) return null;

  const currentState = ensureState();
  const activeGuests = getActiveArchetypeDataset(currentState).guests;
  const directMatch = activeGuests.find((g) => g.code.toUpperCase() === normalized);
  if (directMatch) {
    return isDemoAddressCollectionOnly(directMatch.partyTags) ? null : directMatch;
  }

  const presetGuests = ARCHETYPE_PRESETS[currentState.archetype]?.guests ?? [];
  const presetMatch = presetGuests.find((g) => g.code.toUpperCase() === normalized);
  if (!presetMatch || isDemoAddressCollectionOnly(presetMatch.partyTags)) {
    return null;
  }

  const fallback: InvitationCodeDTO = {
    id: `demo-${currentState.archetype}-preset-${normalized}`,
    code: presetMatch.code.toUpperCase(),
    guestName: presetMatch.guestName,
    householdName: presetMatch.householdName,
    partyGroup: presetMatch.partyGroup,
    partyTags: [...presetMatch.partyTags],
    plusOneAllocations: presetMatch.plusOnesAllowed ?? 0,
    used: true,
    isSample: true,
  };
  return {
    ...fallback,
    members: buildDemoHouseholdMembersForGuest(fallback),
  };
}

export function setDemoGuestSession(session: DemoGuestSession | null): void {
  updateState((prev) => ({
    ...prev,
    guestSession: session,
  }));
  syncStaticDemoGuestSession(session);
}

export interface DemoGuestAddressUpdateInput {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  householdName?: string;
  members?: Array<{
    id?: string;
    fullName: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: HouseholdMemberRole;
    email?: string | null;
    phone?: string | null;
    dietaryNotes?: string | null;
    tags?: string[];
  }>;
}

export function updateDemoGuestAddress(
  code: string,
  address: DemoGuestAddressUpdateInput
): InvitationCodeDTO | null {
  const normalized = code.trim().toUpperCase();
  let updatedGuest: InvitationCodeDTO | null = null;

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const nowIso = new Date().toISOString();
    let nextSession = prev.guestSession;
    const nextGuests = current.guests.map((g) => {
      if (g.code.toUpperCase() !== normalized) return g;

      let nextMembers = g.members ? [...g.members] : buildDemoHouseholdMembersForGuest(g);
      let nextGuestName = g.guestName;
      let nextEmail = g.email;
      let nextDietary = g.dietaryNotes;
      let nextAllocations = g.plusOneAllocations ?? 0;

      if (Array.isArray(address.members) && address.members.length > 0) {
        const existingById = new Map(nextMembers.map((m) => [m.id, m]));
        nextMembers = address.members.map((m, idx) => {
          const prevMember = m.id ? existingById.get(m.id) : undefined;
          const fullName = m.fullName.trim();
          const split = splitMemberFullName(fullName);
          const role: HouseholdMemberRole =
            idx === 0
              ? 'PRIMARY'
              : m.role && m.role !== 'PRIMARY'
                ? m.role
                : (prevMember?.role && prevMember.role !== 'PRIMARY' ? prevMember.role : 'PARTNER');
          return {
            id: prevMember?.id || m.id || `${g.id}-member-${idx + 1}`,
            invitationCodeId: g.id,
            fullName,
            firstName: m.firstName ?? split.firstName,
            lastName: m.lastName ?? split.lastName,
            role,
            email: m.email !== undefined ? (m.email?.trim() || null) : (prevMember?.email ?? null),
            phone: m.phone !== undefined ? (m.phone?.trim() || null) : (prevMember?.phone ?? null),
            dietaryNotes:
              m.dietaryNotes !== undefined
                ? (m.dietaryNotes?.trim() || null)
                : (prevMember?.dietaryNotes ?? null),
            tags: Array.isArray(m.tags) ? m.tags.map(String) : (prevMember?.tags ?? []),
            displayOrder: idx,
            seatNumber: prevMember?.seatNumber ?? null,
            createdAt: prevMember?.createdAt ?? nowIso,
            updatedAt: nowIso,
          };
        });
        const primary = nextMembers[0];
        if (primary) {
          nextGuestName = primary.fullName;
          nextEmail = primary.email ?? nextEmail ?? null;
          nextDietary = primary.dietaryNotes ?? '';
        }
        nextAllocations = Math.max(nextAllocations, Math.max(0, nextMembers.length - 1));
        if (nextSession && nextSession.invitationCode.toUpperCase() === normalized) {
          nextSession = { ...nextSession, guestName: nextGuestName };
        }
      }

      const next: InvitationCodeDTO = {
        ...g,
        guestName: nextGuestName,
        email: nextEmail,
        dietaryNotes: nextDietary,
        plusOneAllocations: nextAllocations,
        ...(address.householdName !== undefined ? { householdName: address.householdName } : {}),
        addressLine1:
          address.addressLine1 !== undefined ? address.addressLine1 : (g.addressLine1 ?? ''),
        addressLine2:
          address.addressLine2 !== undefined ? address.addressLine2 : (g.addressLine2 ?? ''),
        city: address.city !== undefined ? address.city : (g.city ?? ''),
        state: address.state !== undefined ? address.state : (g.state ?? ''),
        zipCode: address.zipCode !== undefined ? address.zipCode : (g.zipCode ?? ''),
        country: address.country !== undefined ? address.country : (g.country ?? ''),
        members: nextMembers,
        updatedAt: nowIso,
      };
      updatedGuest = next;
      return next;
    });

    return {
      ...prev,
      guestSession: nextSession,
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...current,
        guests: nextGuests,
        seatingTables: syncTableGuests(current.seatingTables, nextGuests),
      }),
    };
  });

  return updatedGuest;
}

export function resolveDemoRegistryItemIdAlias(
  items: RegistryItem[],
  rawItemId: string
): RegistryItem | null {
  const trimmed = rawItemId.trim();
  if (!trimmed) return null;

  const exact = items.find((i) => i.id === trimmed);
  if (exact) return exact;

  if (trimmed === '1' && items.length > 0) {
    return items[0];
  }

  const sampleMatch = /^sample-registry-(classic|destination|romantic)-(\d+)$/.exec(trimmed);
  if (sampleMatch) {
    const mappedId = `demo-${sampleMatch[1]}-item-${sampleMatch[2]}`;
    const mapped = items.find((i) => i.id === mappedId);
    if (mapped) return mapped;
  }

  return null;
}

export interface DemoContributionInput {
  itemId: string;
  purchaserName: string;
  amount: number;
  code?: string;
  message?: string | null;
  coverFee?: boolean;
  email?: string | null;
  paymentIntentId?: string;
  clientSecret?: string;
  retailerOrderNumber?: string;
  carrier?: string;
  trackingNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

export function recordDemoContribution(
  input: DemoContributionInput
): (RegistryItem & { claimActions?: GuestClaimActions }) | null {
  let resultItem: (RegistryItem & { claimActions?: GuestClaimActions }) | null = null;

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const targetItem = resolveDemoRegistryItemIdAlias(current.registryItems, input.itemId);
    if (!targetItem) return prev;

    const nowIso = new Date().toISOString();
    const contributorId = `demo-contrib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const isCardTx = Boolean(input.paymentIntentId);
    const effectiveCoverFee = isCardTx ? Boolean(input.coverFee) : false;
    const feeAmount = effectiveCoverFee
      ? Math.round(input.amount * CARD_PROCESSING_FEE_RATE * 100) / 100
      : 0;

    const normalizedEmail = input.email?.trim() || null;
    const normalizedCode = input.code?.trim().toUpperCase() || '';
    const linkedGuest = normalizedCode
      ? current.guests.find(
        (g) =>
          g.code.toUpperCase() === normalizedCode &&
          !isDemoAddressCollectionOnly(g.partyTags)
      ) ?? null
      : null;

    const addressLine1 = input.addressLine1?.trim() || null;
    const addressLine2 = input.addressLine2?.trim() || null;
    const city = input.city?.trim() || null;
    const stateVal = input.state?.trim() || null;
    const zipCode = input.zipCode?.trim() || null;
    const country = input.country?.trim() || null;

    const newContributor: ContributorRecord = {
      id: contributorId,
      name: input.purchaserName.trim(),
      email: normalizedEmail,
      addressLine1,
      addressLine2,
      city,
      state: stateVal,
      zipCode,
      country,
      isPlusOne: false,
      amount: input.amount,
      refundedAmount: 0,
      status: isCardTx ? 'CONFIRMED' : 'RESERVED',
      coverFee: effectiveCoverFee,
      feeAmount,
      message: input.message ?? null,
      date: nowIso,
      thankYouStatus: 'Unsent',
      thankYouSentAt: null,
      thankYouEmailSentAt: null,
      thankYouNote: null,
      stripePaymentIntentId: input.paymentIntentId ?? null,
      stripeChargeId: null,
      retailerOrderNumber: input.retailerOrderNumber ?? null,
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      transactionTimestamp: nowIso,
      registryItemId: targetItem.id,
      ...(linkedGuest ? { invitationCodeId: linkedGuest.id } : {}),
    };

    const hasCompleteContributorAddress = Boolean(addressLine1 && city && stateVal && zipCode);
    const existingGuestStreet = linkedGuest?.addressLine1?.trim() || '';
    const existingGuestZip = linkedGuest?.zipCode?.trim() || '';
    const hasConflictingStreet =
      Boolean(existingGuestStreet) &&
      existingGuestStreet.toLowerCase() !== addressLine1?.toLowerCase();
    const hasConflictingZip =
      Boolean(existingGuestZip) &&
      existingGuestZip.toLowerCase() !== zipCode?.toLowerCase();
    const nextGuests =
      Boolean(normalizedCode) &&
      linkedGuest &&
      hasCompleteContributorAddress &&
      !hasConflictingStreet &&
      !hasConflictingZip
        ? current.guests.map((g) =>
          g.id === linkedGuest.id
            ? {
              ...g,
              addressLine1: g.addressLine1?.trim() ? g.addressLine1 : (addressLine1 ?? ''),
              addressLine2: g.addressLine2?.trim() ? g.addressLine2 : (addressLine2 ?? ''),
              city: g.city?.trim() ? g.city : (city ?? ''),
              state: g.state?.trim() ? g.state : (stateVal ?? ''),
              zipCode: g.zipCode?.trim() ? g.zipCode : (zipCode ?? ''),
              country: g.country?.trim() ? g.country : (country ?? ''),
            }
            : g
        )
        : current.guests;

    const totalTarget = targetItem.price * Math.max(1, targetItem.quantity ?? 1);
    const nextContributed = Math.min(
      totalTarget,
      Math.round(((targetItem.amountContributed || 0) + input.amount) * 100) / 100
    );
    const nextPurchased = nextContributed >= totalTarget;

    const updatedItem: RegistryItem = {
      ...targetItem,
      amountContributed: nextContributed,
      purchased: nextPurchased,
      purchaserName: targetItem.isGroupGift
        ? targetItem.purchaserName ?? null
        : targetItem.purchaserName
          ? `${targetItem.purchaserName}, ${input.purchaserName.trim()}`
          : input.purchaserName.trim(),
      contributors: [...targetItem.contributors, newContributor],
    };

    const nextClaimTokens = { ...prev.claimTokens };
    let claimActions: GuestClaimActions | undefined;
    if (!isCardTx) {
      const confirmToken = `demo_confirm_${contributorId}`;
      const cancelToken = `demo_cancel_${contributorId}`;
      nextClaimTokens[confirmToken] = {
        itemId: targetItem.id,
        contributorId,
        action: 'confirm',
      };
      nextClaimTokens[cancelToken] = {
        itemId: targetItem.id,
        contributorId,
        action: 'cancel',
      };
      claimActions = {
        confirmToken,
        cancelToken,
        status: 'RESERVED',
      };
    }

    resultItem = claimActions ? { ...updatedItem, claimActions } : updatedItem;

    return {
      ...prev,
      claimTokens: nextClaimTokens,
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...current,
        guests: nextGuests,
        seatingTables: syncTableGuests(current.seatingTables, nextGuests),
        registryItems: current.registryItems.map((i) =>
          i.id === updatedItem.id ? updatedItem : i
        ),
      }),
    };
  });

  return resultItem;
}

function resolveDemoClaimRecord(token: string): DemoClaimTokenRecord | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const currentState = ensureState();
  const normalized = trimmed.replace(/^demo-claim:(confirm|cancel):/, (_, act: string) =>
    act === 'confirm' ? 'demo_confirm_' : 'demo_cancel_'
  );
  const direct = currentState.claimTokens[trimmed] ?? currentState.claimTokens[normalized];
  if (direct) return direct;

  const patternMatch = /^demo_(confirm|cancel)_(.+)$/.exec(normalized);
  if (!patternMatch) return null;

  const action = patternMatch[1] as 'confirm' | 'cancel';
  const contributorId = patternMatch[2];
  const current = currentState.datasets[currentState.archetype];
  for (const item of current.registryItems) {
    if ((item.contributors || []).some((c) => c.id === contributorId)) {
      return {
        itemId: item.id,
        contributorId,
        action,
      };
    }
  }
  return null;
}

export function previewDemoClaimToken(token: string): DemoClaimPreview | null {
  const record = resolveDemoClaimRecord(token);
  if (!record) return null;

  const currentState = ensureState();
  const current = currentState.datasets[currentState.archetype];
  const item = current.registryItems.find((i) => i.id === record.itemId);
  if (!item) return null;

  const contributor = (item.contributors || []).find((c) => c.id === record.contributorId);
  if (!contributor) return null;

  const itemType: DemoClaimPreview['itemType'] =
    item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND'
      ? item.itemType
      : 'PHYSICAL';

  return {
    action: record.action,
    status: contributor.status ?? 'RESERVED',
    amount: contributor.amount,
    itemId: item.id,
    itemName: item.name,
    itemType,
    isGroupGift: Boolean(item.isGroupGift),
    vendorUrl: item.vendorUrl ?? null,
    shippingAddress: itemType === 'PHYSICAL' ? DEMO_SHIPPING_ADDRESS : null,
    paymentHandle: item.paymentHandle || '@alex-and-taylor',
    paymentHandleType: item.paymentHandleType || 'Venmo',
    contributorName: contributor.name,
  };
}

export function processDemoClaimToken(
  token: string,
  orderDetails?: OrderTrackingDetails
): {
  action: 'confirm' | 'cancel';
  status: 'CONFIRMED' | 'CANCELLED';
  changed: boolean;
  item: RegistryItem | null;
} | null {
  const record = resolveDemoClaimRecord(token);
  if (!record) return null;

  let updatedItem: RegistryItem | null = null;
  let changed = false;
  const targetStatus: 'CONFIRMED' | 'CANCELLED' =
    record.action === 'confirm' ? 'CONFIRMED' : 'CANCELLED';
  const trimOpt = (val?: string | null) =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
  const trackingPatch: Partial<ContributorRecord> =
    targetStatus === 'CONFIRMED'
      ? {
        ...(trimOpt(orderDetails?.retailerOrderNumber)
          ? { retailerOrderNumber: trimOpt(orderDetails?.retailerOrderNumber) }
          : {}),
        ...(trimOpt(orderDetails?.carrier) ? { carrier: trimOpt(orderDetails?.carrier) } : {}),
        ...(trimOpt(orderDetails?.trackingNumber)
          ? { trackingNumber: trimOpt(orderDetails?.trackingNumber) }
          : {}),
      }
      : {};

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const item = current.registryItems.find((i) => i.id === record.itemId);
    if (!item) return prev;

    const contributor = item.contributors.find((c) => c.id === record.contributorId);
    if (!contributor) {
      updatedItem = item;
      return prev;
    }

    if (contributor.status === targetStatus && Object.keys(trackingPatch).length === 0) {
      updatedItem = item;
      return prev;
    }

    changed = contributor.status !== targetStatus;
    const nextContributors = item.contributors.map((c) =>
      c.id === record.contributorId ? { ...c, status: targetStatus, ...trackingPatch } : c
    );

    const activeTotal = nextContributors
      .filter((c) => c.status !== 'CANCELLED' && c.status !== 'REFUNDED')
      .reduce((sum, c) => sum + Math.max(0, c.amount - (c.refundedAmount ?? 0)), 0);
    const totalTarget = item.price * Math.max(1, item.quantity ?? 1);
    const nextAmountContributed = Math.min(totalTarget, Math.round(activeTotal * 100) / 100);
    const nextPurchased = nextAmountContributed >= totalTarget;

    const nextItem: RegistryItem = {
      ...item,
      amountContributed: nextAmountContributed,
      purchased: nextPurchased,
      purchaserName: !item.isGroupGift && !nextPurchased ? null : item.purchaserName,
      contributors: nextContributors,
    };
    updatedItem = nextItem;

    return {
      ...prev,
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...current,
        registryItems: current.registryItems.map((i) => (i.id === nextItem.id ? nextItem : i)),
      }),
    };
  });

  return {
    action: record.action,
    status: targetStatus,
    changed,
    item: updatedItem,
  };
}

export function mutateActiveDataset(
  updater: (current: ArchetypeDataset) => ArchetypeDataset
): void {
  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const next = updater(current);
    return {
      ...prev,
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...next,
        seatingTables: syncTableGuests(next.seatingTables, next.guests),
      }),
    };
  });
}

export function getEffectiveDemoSettings(
  targetState: DemoStoreState = ensureState()
): Record<string, unknown> {
  const dataset = targetState.datasets[targetState.archetype] ?? targetState.datasets.classic;
  const cfg = dataset.siteConfig;
  const ov = targetState.configOverrides;

  const weddingDateIso =
    ov.weddingDate instanceof Date && !Number.isNaN(ov.weddingDate.getTime())
      ? ov.weddingDate.toISOString()
      : cfg.weddingDate;

  return {
    id: 'global',
    subdomain: 'global',
    partner1Name: ov.partner1Name ?? cfg.partner1Name,
    partner2Name: ov.partner2Name ?? cfg.partner2Name,
    brideName: ov.partner1Name ?? cfg.partner1Name,
    groomName: ov.partner2Name ?? cfg.partner2Name,
    weddingDate: weddingDateIso,
    baseUrl: ov.baseUrl ?? cfg.baseUrl,
    venueName: ov.venueName ?? cfg.venueName,
    venueAddress: ov.venueAddress ?? cfg.venueAddress,
    venueCity: ov.venueCity ?? cfg.venueCity,
    venueState: ov.venueState ?? cfg.venueState,
    venueZip: ov.venueZip ?? cfg.venueZip,
    latitude: typeof ov.latitude === 'number' ? ov.latitude : cfg.latitude,
    longitude: typeof ov.longitude === 'number' ? ov.longitude : cfg.longitude,
    storyText: ov.storyText ?? cfg.storyText,
    venueDescription: ov.venueDescription ?? cfg.venueDescription,
    travelAdvice: ov.travelAdvice ?? cfg.travelAdvice,
    heroTitle: ov.heroTitle ?? cfg.heroTitle,
    heroSubtitle: ov.heroSubtitle ?? cfg.heroSubtitle,
    seoTitle: ov.seoTitle ?? cfg.seoTitle,
    seoDescription: ov.seoDescription ?? cfg.seoDescription,
    contactEmail: ov.contactEmail ?? cfg.contactEmail,
    faviconUrl: ov.faviconUrl ?? cfg.faviconUrl,
    ogImageUrl: ov.ogImageUrl ?? cfg.ogImageUrl,
    heroImageUrl: ov.heroImageUrl ?? cfg.heroImageUrl,
    heroImageAlt: ov.heroImageAlt ?? cfg.heroImageAlt,
    colorPrimary: ov.colorPrimary ?? cfg.colorPrimary,
    colorSecondary: ov.colorSecondary ?? cfg.colorSecondary,
    themePreset: targetState.themePreset || cfg.themePreset,
    timezone: ov.timezone ?? cfg.timezone,
    autoApproveGuestPhotos: cfg.autoApproveGuestPhotos,
    guestPhotoQrTokenVersion: cfg.guestPhotoQrTokenVersion,
    rsvpOpen: typeof ov.rsvpOpen === 'boolean' ? ov.rsvpOpen : cfg.rsvpOpen,
    rsvpDeadlineDate: cfg.rsvpDeadlineDate,
    rsvpGracePeriodHours: cfg.rsvpGracePeriodHours,
    rsvpClosedMessage: ov.rsvpClosedMessage ?? cfg.rsvpClosedMessage,
    showCountdown:
      typeof ov.showCountdown === 'boolean' ? ov.showCountdown : cfg.showCountdown,
    showAddToCalendar:
      typeof ov.showAddToCalendar === 'boolean'
        ? ov.showAddToCalendar
        : cfg.showAddToCalendar,
    features: ov.features ?? dataset.features,
    modules: ov.modules ?? dataset.modules,
    shippingRecipientName: cfg.shippingRecipientName,
    shippingAddressLine1: cfg.shippingAddressLine1,
    shippingAddressLine2: cfg.shippingAddressLine2,
    shippingCity: cfg.shippingCity,
    shippingState: cfg.shippingState,
    shippingZip: cfg.shippingZip,
    shippingCountry: cfg.shippingCountry,
    shippingPhone: cfg.shippingPhone,
    shippingDeliveryNotes: cfg.shippingDeliveryNotes,
    defaultPaymentHandleType: cfg.defaultPaymentHandleType,
    defaultPaymentHandle: cfg.defaultPaymentHandle,
    registryGiftAccessTier: cfg.registryGiftAccessTier,
    shippingDisclosureTier: cfg.shippingDisclosureTier,
    maxPendingReservations: cfg.maxPendingReservations,
    emailProvider: 'demo-simulated',
    smsProvider: 'demo-simulated',
    isMessagingActive: ov.isMessagingActive !== false,
    setupCompleted: true,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: new Date().toISOString(),
  };
}

export function getDemoContentNodes(dataset: ArchetypeDataset): ContentNodeDTO[] {
  const photoNodes: ContentNodeDTO[] = dataset.photos.map((p) => ({
    id: p.nodeId,
    type: 'Photo',
    tags: p.isGuestUpload ? ['Gallery', 'guest-upload'] : ['Gallery', 'Curated'],
    data: {
      url: p.url,
      mediaId: p.mediaId,
      title: p.title,
      caption: p.caption,
      altText: p.altText,
      status: p.status,
      isVisible: p.isVisible,
      ...(p.uploaderName ? { uploaderName: p.uploaderName } : {}),
      ...(p.uploaderEmail ? { uploaderEmail: p.uploaderEmail } : {}),
    },
    createdAt: toDateInstance(p.createdAt),
    updatedAt: toDateInstance(p.updatedAt),
  }));

  return [
    ...dataset.scheduleNodes,
    ...dataset.logisticsNodes,
    ...dataset.faqs,
    ...dataset.customNodes,
    ...photoNodes,
  ];
}

export function recordDemoAuditVersion(
  entityTypeOrEntry:
    | string
    | {
      entityType: string;
      entityId: string;
      action: string;
      summary: string;
      data?: Record<string, unknown>;
      createdBy?: string;
    },
  entityId?: string,
  action?: string,
  summary?: string,
  data?: Record<string, unknown>,
  createdBy = 'Admin'
): DemoSnapshotVersionRecord {
  const entry =
    typeof entityTypeOrEntry === 'string'
      ? {
        entityType: entityTypeOrEntry,
        entityId: entityId ?? 'global',
        action: action ?? 'UPDATE',
        summary: summary ?? 'Updated record',
        data,
        createdBy,
      }
      : entityTypeOrEntry;
  const nowIso = new Date().toISOString();
  const currentState = ensureState();
  const currentDataset = currentState.datasets[currentState.archetype];
  const { snapshotVersions: _omitSnapshots, ...restDataset } = currentDataset;

  const compactSnapshot = JSON.parse(
    JSON.stringify({
      configOverrides: currentState.configOverrides,
      themePreset: currentState.themePreset,
      dataset: restDataset,
    })
  ) as Record<string, unknown>;

  const record: DemoSnapshotVersionRecord = {
    id: `demo-version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    summary: entry.summary,
    createdBy: entry.createdBy ?? 'Admin',
    createdAt: nowIso,
    data: entry.data ?? { action: entry.action, summary: entry.summary },
    snapshotState: compactSnapshot,
  };

  mutateActiveDataset((curr) => ({
    ...curr,
    snapshotVersions: [record, ...curr.snapshotVersions]
      .slice(0, MAX_STORED_SNAPSHOT_VERSIONS)
      .map((ver, idx) => {
        if (idx < 5 || !ver.snapshotState) return ver;
        const { snapshotState: _trimmed, ...lightweight } = ver;
        return lightweight;
      }),
  }));

  return record;
}

export function restoreDemoAuditVersion(versionId: string): DemoSnapshotVersionRecord | null {
  const currentState = ensureState();
  const current = currentState.datasets[currentState.archetype];
  const target = current.snapshotVersions.find((v) => v.id === versionId);
  if (!target) return null;

  const nowIso = new Date().toISOString();
  const restoreAudit: DemoSnapshotVersionRecord = {
    id: `demo-version-restore-${Date.now()}`,
    entityType: target.entityType,
    entityId: target.entityId,
    action: 'RESTORE',
    summary: `Restored snapshot "${target.summary}"`,
    createdBy: 'Admin',
    createdAt: nowIso,
    data: { restoredVersionId: target.id, ...target.data },
  };

  updateState((prev) => {
    const activeDs = prev.datasets[prev.archetype];
    const defaults = buildArchetypeDataset(prev.archetype);

    if (target.snapshotState && typeof target.snapshotState === 'object') {
      const snap = target.snapshotState as {
        configOverrides?: Partial<PublicAppConfig>;
        themePreset?: ThemePreset;
        dataset?: Partial<ArchetypeDataset>;
      };
      const restoredDataset = snap.dataset
        ? reviveDatasetDates(snap.dataset, defaults)
        : activeDs;
      return {
        ...prev,
        themePreset: snap.themePreset ?? prev.themePreset,
        configOverrides: snap.configOverrides ?? prev.configOverrides,
        datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
          ...restoredDataset,
          snapshotVersions: [restoreAudit, ...activeDs.snapshotVersions].slice(
            0,
            MAX_STORED_SNAPSHOT_VERSIONS
          ),
        }),
      };
    }

    // Seeded initial version fallback: restore features or initial archetype preset
    const nextFeatures = Array.isArray(target.data?.features)
      ? (target.data.features as DemoFeatureItem[])
      : defaults.features;

    return {
      ...prev,
      themePreset: defaults.siteConfig.themePreset,
      configOverrides: {
        ...prev.configOverrides,
        features: nextFeatures,
      },
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, {
        ...defaults,
        features: nextFeatures,
        snapshotVersions: [restoreAudit, ...activeDs.snapshotVersions].slice(
          0,
          MAX_STORED_SNAPSHOT_VERSIONS
        ),
      }),
    };
  });

  return target;
}

function toBackupSafeUrl(rawUrl: string): string {
  if (!rawUrl) return withBasePath('/images/placeholder.png');
  if (rawUrl.startsWith('blob:')) {
    return sessionBlobFallbacks.get(rawUrl) ?? createBase64SvgPlaceholder('Uploaded Photo');
  }
  if (rawUrl.startsWith('data:image/svg+xml,')) {
    const encodedSvg = rawUrl.slice('data:image/svg+xml,'.length);
    try {
      const decoded = decodeURIComponent(encodedSvg);
      const b64 =
        typeof Buffer !== 'undefined'
          ? Buffer.from(decoded, 'utf8').toString('base64')
          : btoa(unescape(encodeURIComponent(decoded)));
      return `data:image/svg+xml;base64,${b64}`;
    } catch {
      return createBase64SvgPlaceholder('Registry Image');
    }
  }
  return rawUrl;
}

export function buildDemoDatabaseBackup(): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const currentState = ensureState();
  const ds = currentState.datasets[currentState.archetype];
  const settings = getEffectiveDemoSettings(currentState);

  const registryMedia: Array<Record<string, unknown>> = ds.registryItems.map((item) => ({
    id: item.imageId || `${item.id}-img`,
    url: toBackupSafeUrl(item.image?.url || ''),
    altText: item.image?.altText || item.name,
    isDecorative: false,
    isSample: Boolean(item.isSample),
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: nowIso,
  }));

  const mediaById = new Map<string, Record<string, unknown>>();
  for (const m of registryMedia) {
    mediaById.set(String(m.id), m);
  }
  for (const m of ds.media) {
    mediaById.set(m.id, {
      id: m.id,
      url: toBackupSafeUrl(m.url),
      altText: m.altText ?? 'Gallery photo',
      isDecorative: Boolean(m.isDecorative),
      isSample: Boolean(m.isSample),
      createdAt: toDateInstance(m.createdAt).toISOString(),
      updatedAt: toDateInstance(m.updatedAt).toISOString(),
    });
  }

  const allContributors: Array<Record<string, unknown>> = [];
  for (const item of ds.registryItems) {
    for (const c of item.contributors) {
      allContributors.push({
        ...c,
        email: c.email || null,
        date: toDateInstance(c.date).toISOString(),
        transactionTimestamp: toDateInstance(c.transactionTimestamp || c.date).toISOString(),
        thankYouSentAt: c.thankYouSentAt ? toDateInstance(c.thankYouSentAt).toISOString() : null,
        thankYouEmailSentAt: c.thankYouEmailSentAt
          ? toDateInstance(c.thankYouEmailSentAt).toISOString()
          : null,
        registryItemId: item.id,
        createdAt: toDateInstance(c.date).toISOString(),
        updatedAt: nowIso,
      });
    }
  }
  for (const c of ds.offlineContributors) {
    allContributors.push({
      ...c,
      email: c.email || null,
      date: toDateInstance(c.date).toISOString(),
      transactionTimestamp: toDateInstance(c.transactionTimestamp || c.date).toISOString(),
      thankYouSentAt: c.thankYouSentAt ? toDateInstance(c.thankYouSentAt).toISOString() : null,
      thankYouEmailSentAt: c.thankYouEmailSentAt
        ? toDateInstance(c.thankYouEmailSentAt).toISOString()
        : null,
      registryItemId: null,
      createdAt: toDateInstance(c.date).toISOString(),
      updatedAt: nowIso,
    });
  }

  const contentNodes = getDemoContentNodes(ds).map((node) => {
    const rawData =
      node.data && typeof node.data === 'object' ? { ...(node.data as Record<string, unknown>) } : {};
    if (typeof rawData.url === 'string') {
      rawData.url = toBackupSafeUrl(rawData.url);
    }
    return {
      id: node.id,
      type: node.type,
      tags: [...node.tags],
      data: rawData,
      createdAt: toDateInstance(node.createdAt).toISOString(),
      updatedAt: toDateInstance(node.updatedAt).toISOString(),
    };
  });

  const broadcastRecipients: Array<Record<string, unknown>> = [];
  const broadcastMessages = ds.broadcastMessages.map((b) => {
    for (const r of b.recipients) {
      broadcastRecipients.push({
        id: r.id,
        broadcastId: b.id,
        invitationCodeId: r.invitationCodeId,
        guestName: r.recipientName,
        destination: r.recipientEmail || r.recipientPhone || 'guest@example.com',
        status: r.status,
        error: r.errorMessage,
        sentAt: r.sentAt ? toDateInstance(r.sentAt).toISOString() : null,
        createdAt: toDateInstance(b.createdAt).toISOString(),
        updatedAt: toDateInstance(b.updatedAt).toISOString(),
      });
    }
    return {
      id: b.id,
      channel: b.channel,
      subject: b.subject,
      body: b.body,
      status: b.status,
      totalRecipients: b.recipientCount,
      sentCount: b.sentCount,
      failedCount: b.failedCount,
      scheduledFor: b.scheduledAt ? toDateInstance(b.scheduledAt).toISOString() : null,
      sentAt: b.sentAt ? toDateInstance(b.sentAt).toISOString() : null,
      createdAt: toDateInstance(b.createdAt).toISOString(),
      updatedAt: toDateInstance(b.updatedAt).toISOString(),
    };
  });

  return {
    version: '2.0',
    schemaVersion: '2.0',
    exportedAt: nowIso,
    appConfig: [
      {
        id: String(settings.id),
        partner1Name: String(settings.partner1Name ?? ''),
        partner2Name: String(settings.partner2Name ?? ''),
        brideName: String(settings.brideName ?? ''),
        groomName: String(settings.groomName ?? ''),
        weddingDate: toDateInstance(settings.weddingDate).toISOString(),
        baseUrl: String(settings.baseUrl ?? 'https://example.com'),
        venueName: String(settings.venueName ?? ''),
        venueAddress: String(settings.venueAddress ?? ''),
        venueCity: String(settings.venueCity ?? ''),
        venueState: String(settings.venueState ?? ''),
        venueZip: String(settings.venueZip ?? ''),
        latitude: Number(settings.latitude ?? 0),
        longitude: Number(settings.longitude ?? 0),
        storyText: String(settings.storyText ?? ''),
        venueDescription: String(settings.venueDescription ?? ''),
        travelAdvice: String(settings.travelAdvice ?? ''),
        heroTitle: String(settings.heroTitle ?? ''),
        heroSubtitle: String(settings.heroSubtitle ?? ''),
        seoTitle: String(settings.seoTitle ?? ''),
        seoDescription: String(settings.seoDescription ?? ''),
        contactEmail: String(settings.contactEmail ?? 'contact@example.com'),
        faviconUrl: String(settings.faviconUrl ?? ''),
        ogImageUrl: String(settings.ogImageUrl ?? ''),
        heroImageUrl: String(settings.heroImageUrl ?? ''),
        heroImageAlt: String(settings.heroImageAlt ?? ''),
        colorPrimary: String(settings.colorPrimary ?? '#B91C1C'),
        colorSecondary: String(settings.colorSecondary ?? '#B45309'),
        themePreset: String(settings.themePreset ?? 'classic'),
        timezone: String(settings.timezone ?? 'America/Chicago'),
        features: ds.features,
        modules: ds.modules,
        setupCompleted: true,
        createdAt: '2026-01-15T12:00:00.000Z',
        updatedAt: nowIso,
      },
    ],
    media: Array.from(mediaById.values()),
    registryItem: ds.registryItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      category: item.category,
      price: item.price,
      imageId: item.imageId || `${item.id}-img`,
      quantity: item.quantity ?? 1,
      itemType: item.itemType,
      paymentHandleType: item.paymentHandleType ?? null,
      paymentHandle: item.paymentHandle ?? null,
      vendorUrl: item.vendorUrl ?? null,
      isGroupGift: Boolean(item.isGroupGift),
      isMostWanted: Boolean(item.isMostWanted),
      displayOrder: item.displayOrder ?? 0,
      purchased: Boolean(item.purchased),
      isSample: Boolean(item.isSample),
      purchaserName: item.purchaserName ?? null,
      amountContributed: item.amountContributed ?? 0,
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: nowIso,
    })),
    contributor: allContributors,
    weddingPartyMember: ds.weddingParty.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      bio: m.bio,
      side: m.side,
      link: m.link ?? null,
      order: m.order,
      photoId: m.photoId ?? null,
      isSample: Boolean(m.isSample),
      createdAt: toDateInstance(m.createdAt).toISOString(),
      updatedAt: toDateInstance(m.updatedAt).toISOString(),
    })),
    attraction: ds.attractions.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      website: a.website,
      directions: a.directions,
      latitude: a.latitude,
      longitude: a.longitude,
      imageId: a.imageId ?? null,
      isVisible: a.isVisible !== false,
      isSample: Boolean(a.isSample),
      promoCode: a.promoCode ?? null,
      bookingUrl: a.bookingUrl ?? null,
      roomRate: a.roomRate ?? null,
      cutoffDate: a.cutoffDate ?? null,
      shuttleInfo: a.shuttleInfo ?? null,
      createdAt: toDateInstance(a.createdAt).toISOString(),
      updatedAt: toDateInstance(a.updatedAt).toISOString(),
    })),
    contentNode: contentNodes,
    seatingTable: ds.seatingTables.map(({ invitationCodes: _omit, ...rest }) => ({
      ...rest,
      createdAt: toDateInstance(rest.createdAt).toISOString(),
      updatedAt: toDateInstance(rest.updatedAt).toISOString(),
    })),
    invitationCode: ds.guests.map(({ members: _omitMembers, ...g }) => ({
      ...g,
      usedAt: g.usedAt ? toDateInstance(g.usedAt).toISOString() : null,
      createdAt: toDateInstance(g.createdAt).toISOString(),
      updatedAt: toDateInstance(g.updatedAt).toISOString(),
    })),
    householdMember: ds.guests.flatMap((g) =>
      buildDemoHouseholdMembersForGuest(g).map((m, idx) => ({
        id: m.id,
        invitationCodeId: g.id,
        firstName: m.firstName ?? null,
        lastName: m.lastName ?? null,
        fullName: m.fullName,
        role: m.role,
        email: m.email || null,
        phone: m.phone || null,
        dietaryNotes: m.dietaryNotes || null,
        tags: m.tags ?? [],
        displayOrder: m.displayOrder ?? idx,
        seatNumber: m.seatNumber ?? null,
        createdAt: toDateInstance(m.createdAt ?? g.createdAt).toISOString(),
        updatedAt: toDateInstance(m.updatedAt ?? g.updatedAt).toISOString(),
      }))
    ),
    subEvent: ds.subEvents.map((se) => ({
      id: se.id,
      title: se.title,
      description: se.description ?? '',
      startTime: se.startTime ? toDateInstance(se.startTime).toISOString() : null,
      endTime: se.endTime ? toDateInstance(se.endTime).toISOString() : null,
      locationName: se.locationName ?? '',
      location: se.location ?? '',
      category: se.category ?? 'Wedding',
      isPrivate: Boolean(se.isPrivate),
      mealOptions: se.mealOptions ?? [],
      customQuestions: se.customQuestions ?? [],
      createdAt: toDateInstance(se.createdAt).toISOString(),
      updatedAt: toDateInstance(se.updatedAt).toISOString(),
    })),
    subEventAccess: ds.subEventAccess.map((a) => ({
      id: a.id,
      subEventId: a.subEventId,
      invitationCodeId: a.invitationCodeId,
      createdAt: toDateInstance(a.createdAt).toISOString(),
    })),
    subEventRsvp: ds.subEventRsvps.map((r) => ({
      id: r.id,
      subEventId: r.subEventId,
      invitationCodeId: r.invitationCodeId,
      status: r.status,
      plusOneCount: r.plusOneCount,
      plusOneNames: r.plusOneNames,
      mealSelections: r.mealSelections,
      dietaryNotes: r.dietaryNotes,
      customAnswers: r.customAnswers,
      createdAt: toDateInstance(r.respondedAt).toISOString(),
      updatedAt: toDateInstance(r.updatedAt).toISOString(),
    })),
    subEventMemberRsvp: (() => {
      const validMemberIds = new Set(
        ds.guests.flatMap((g) => buildDemoHouseholdMembersForGuest(g).map((m) => m.id))
      );
      return ds.subEventRsvps.flatMap((r) =>
        (r.memberRsvps ?? [])
          .filter((mr) => validMemberIds.has(mr.householdMemberId))
          .map((mr, idx) => ({
            id: mr.id || `${r.id}-mr-${idx + 1}`,
            subEventRsvpId: r.id,
            householdMemberId: mr.householdMemberId,
            status: mr.status,
            mealOptionId: mr.mealOptionId ?? null,
            dietaryNotes: mr.dietaryNotes ?? null,
            createdAt: toDateInstance(r.respondedAt).toISOString(),
            updatedAt: toDateInstance(r.updatedAt).toISOString(),
          }))
      );
    })(),
    broadcastMessage: broadcastMessages,
    broadcastRecipient: broadcastRecipients,
    snapshotVersion: ds.snapshotVersions.map((v) => ({
      id: v.id,
      entityType: v.entityType,
      entityId: v.entityId,
      data: v.data,
      author: v.createdBy,
      createdAt: toDateInstance(v.createdAt).toISOString(),
    })),
  };
}

export function importDemoDatabaseBackup(rawPayload: Record<string, unknown>): {
  importedCounts: Record<string, number>;
} {
  const importedCounts: Record<string, number> = {};

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const next: ArchetypeDataset = { ...current };
    let nextOverrides = { ...prev.configOverrides };
    let nextThemePreset = prev.themePreset;

    const appConfigArr = Array.isArray(rawPayload.appConfig)
      ? (rawPayload.appConfig as Array<Record<string, unknown>>)
      : [];
    importedCounts.appConfig = appConfigArr.length;
    if (appConfigArr[0]) {
      const cfg = appConfigArr[0];
      if (typeof cfg.partner1Name === 'string') nextOverrides.partner1Name = cfg.partner1Name;
      if (typeof cfg.partner2Name === 'string') nextOverrides.partner2Name = cfg.partner2Name;
      if (typeof cfg.venueName === 'string') nextOverrides.venueName = cfg.venueName;
      if (typeof cfg.venueAddress === 'string') nextOverrides.venueAddress = cfg.venueAddress;
      if (typeof cfg.venueCity === 'string') nextOverrides.venueCity = cfg.venueCity;
      if (typeof cfg.venueState === 'string') nextOverrides.venueState = cfg.venueState;
      if (typeof cfg.venueZip === 'string') nextOverrides.venueZip = cfg.venueZip;
      if (typeof cfg.storyText === 'string') nextOverrides.storyText = cfg.storyText;
      if (typeof cfg.heroTitle === 'string') nextOverrides.heroTitle = cfg.heroTitle;
      if (typeof cfg.heroSubtitle === 'string') nextOverrides.heroSubtitle = cfg.heroSubtitle;
      if (
        typeof cfg.themePreset === 'string' &&
        THEME_PRESET_KEYS.includes(cfg.themePreset as ThemePreset)
      ) {
        nextThemePreset = cfg.themePreset as ThemePreset;
        nextOverrides.themePreset = nextThemePreset;
      }
      if (Array.isArray(cfg.features)) {
        next.features = cfg.features as DemoFeatureItem[];
        nextOverrides = { ...nextOverrides, features: next.features };
      }
      if (cfg.modules && typeof cfg.modules === 'object') {
        next.modules = resolveModuleConfig(cfg.modules as Partial<ModuleConfig>);
        nextOverrides = { ...nextOverrides, modules: next.modules };
      }
    }

    const mediaArr = Array.isArray(rawPayload.media)
      ? (rawPayload.media as Array<Record<string, unknown>>)
      : null;
    const mediaMap = new Map<string, MediaDTO>();
    if (mediaArr) {
      importedCounts.media = mediaArr.length;
      next.media = mediaArr.map((m) => {
        const dto: MediaDTO = {
          id: String(m.id),
          url: String(m.url ?? ''),
          altText: typeof m.altText === 'string' ? m.altText : null,
          isDecorative: Boolean(m.isDecorative),
          isSample: Boolean(m.isSample),
          createdAt: toDateInstance(m.createdAt),
          updatedAt: toDateInstance(m.updatedAt),
        };
        mediaMap.set(dto.id, dto);
        return dto;
      });
    }

    const contributorsArr = Array.isArray(rawPayload.contributor)
      ? (rawPayload.contributor as unknown as ContributorRecord[])
      : null;
    if (contributorsArr) {
      importedCounts.contributor = contributorsArr.length;
    }

    if (Array.isArray(rawPayload.registryItem)) {
      const itemsArr = rawPayload.registryItem as Array<Record<string, unknown>>;
      importedCounts.registryItem = itemsArr.length;
      next.registryItems = itemsArr.map((raw, idx) => {
        const id = String(raw.id);
        const itemContribs = contributorsArr
          ? contributorsArr.filter((c) => c.registryItemId === id)
          : [];
        const imgId = typeof raw.imageId === 'string' ? raw.imageId : `${id}-img`;
        const mediaItem = mediaMap.get(imgId);
        return {
          id,
          name: String(raw.name ?? 'Gift Item'),
          description: String(raw.description ?? ''),
          category: String(raw.category ?? 'Home'),
          price: Number(raw.price ?? 0),
          quantity: Number(raw.quantity ?? 1),
          itemType: (raw.itemType as RegistryItem['itemType']) ?? 'PHYSICAL',
          isGroupGift: Boolean(raw.isGroupGift),
          isMostWanted: Boolean(raw.isMostWanted),
          displayOrder: typeof raw.displayOrder === 'number' ? raw.displayOrder : idx,
          vendorUrl: typeof raw.vendorUrl === 'string' ? raw.vendorUrl : null,
          paymentHandleType:
            typeof raw.paymentHandleType === 'string' ? raw.paymentHandleType : 'Venmo',
          paymentHandle:
            typeof raw.paymentHandle === 'string' ? raw.paymentHandle : '@alex-and-taylor',
          purchased: Boolean(raw.purchased),
          purchaserName: typeof raw.purchaserName === 'string' ? raw.purchaserName : null,
          amountContributed: Number(raw.amountContributed ?? 0),
          isSample: Boolean(raw.isSample),
          imageId: imgId,
          image: {
            id: imgId,
            url: mediaItem?.url || createBase64SvgPlaceholder(String(raw.name ?? 'Gift')),
            altText: mediaItem?.altText ?? String(raw.name ?? 'Gift'),
            isDecorative: false,
            isSample: Boolean(raw.isSample),
          },
          contributors: itemContribs,
        };
      });
    }

    if (contributorsArr) {
      next.offlineContributors = contributorsArr.filter((c) => !c.registryItemId);
    }

    if (Array.isArray(rawPayload.invitationCode)) {
      const rawMembers = Array.isArray(rawPayload.householdMember)
        ? (rawPayload.householdMember as Array<Record<string, unknown>>)
        : null;
      const membersByInvite = new Map<string, HouseholdMemberDTO[]>();
      if (rawMembers) {
        importedCounts.householdMember = rawMembers.length;
        for (const rm of rawMembers) {
          const invId = String(rm.invitationCodeId ?? '');
          if (!invId) continue;
          const list = membersByInvite.get(invId) ?? [];
          const fullName = String(rm.fullName ?? 'Guest');
          const split = splitMemberFullName(fullName);
          const role: HouseholdMemberRole =
            rm.role === 'PRIMARY' ||
            rm.role === 'PARTNER' ||
            rm.role === 'CHILD' ||
            rm.role === 'PLUS_ONE'
              ? rm.role
              : list.length === 0
                ? 'PRIMARY'
                : 'PARTNER';
          list.push({
            id: String(rm.id ?? `${invId}-member-${list.length + 1}`),
            invitationCodeId: invId,
            fullName,
            firstName: typeof rm.firstName === 'string' ? rm.firstName : split.firstName,
            lastName: typeof rm.lastName === 'string' ? rm.lastName : split.lastName,
            role,
            email: typeof rm.email === 'string' && rm.email.trim() ? rm.email.trim() : null,
            phone: typeof rm.phone === 'string' && rm.phone.trim() ? rm.phone.trim() : null,
            dietaryNotes:
              typeof rm.dietaryNotes === 'string' && rm.dietaryNotes.trim()
                ? rm.dietaryNotes.trim()
                : null,
            tags: Array.isArray(rm.tags) ? rm.tags.map(String) : [],
            displayOrder: typeof rm.displayOrder === 'number' ? rm.displayOrder : list.length,
            seatNumber: typeof rm.seatNumber === 'number' ? rm.seatNumber : null,
            createdAt: toDateInstance(rm.createdAt).toISOString(),
            updatedAt: toDateInstance(rm.updatedAt).toISOString(),
          });
          membersByInvite.set(invId, list);
        }
      }
      next.guests = (rawPayload.invitationCode as InvitationCodeDTO[]).map((g) => {
        const explicitMembers = membersByInvite.get(g.id);
        const members =
          explicitMembers && explicitMembers.length > 0
            ? [...explicitMembers].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
            : buildDemoHouseholdMembersForGuest(g);
        return {
          ...g,
          members,
        };
      });
      importedCounts.invitationCode = next.guests.length;
    }

    if (Array.isArray(rawPayload.seatingTable)) {
      const rawTables = rawPayload.seatingTable as SeatingTableDTO[];
      importedCounts.seatingTable = rawTables.length;
      next.seatingTables = syncTableGuests(rawTables, next.guests);
    } else {
      next.seatingTables = syncTableGuests(next.seatingTables, next.guests);
    }

    if (Array.isArray(rawPayload.weddingPartyMember)) {
      next.weddingParty = (rawPayload.weddingPartyMember as WeddingPartyMemberDTO[]).map((m) => ({
        ...m,
        createdAt: toDateInstance(m.createdAt),
        updatedAt: toDateInstance(m.updatedAt),
      }));
      importedCounts.weddingPartyMember = next.weddingParty.length;
    }

    if (Array.isArray(rawPayload.attraction)) {
      next.attractions = (rawPayload.attraction as AttractionDTO[]).map((a) => ({
        ...a,
        createdAt: toDateInstance(a.createdAt),
        updatedAt: toDateInstance(a.updatedAt),
      }));
      importedCounts.attraction = next.attractions.length;
    }

    if (Array.isArray(rawPayload.contentNode)) {
      const rawNodes = rawPayload.contentNode as ContentNodeDTO[];
      importedCounts.contentNode = rawNodes.length;
      next.faqs = rawNodes
        .filter((n) => n.type === 'FAQ')
        .map((n) => ({
          ...n,
          createdAt: toDateInstance(n.createdAt),
          updatedAt: toDateInstance(n.updatedAt),
        }));
      next.logisticsNodes = rawNodes
        .filter((n) => n.type === 'Logistics')
        .map((n) => ({
          ...n,
          createdAt: toDateInstance(n.createdAt),
          updatedAt: toDateInstance(n.updatedAt),
        }));
      next.scheduleNodes = rawNodes
        .filter((n) => n.type === 'Schedule')
        .map((n) => ({
          ...n,
          createdAt: toDateInstance(n.createdAt),
          updatedAt: toDateInstance(n.updatedAt),
        }));
      next.customNodes = rawNodes
        .filter((n) => n.type === 'Custom')
        .map((n) => ({
          ...n,
          createdAt: toDateInstance(n.createdAt),
          updatedAt: toDateInstance(n.updatedAt),
        }));
      const photoNodes = rawNodes.filter((n) => n.type === 'Photo');
      if (photoNodes.length > 0) {
        next.photos = photoNodes.map((n): DemoPhotoRecord => {
          const data = (n.data ?? {}) as Record<string, unknown>;
          const tags = Array.isArray(n.tags) ? n.tags : [];
          const isGuest = tags.includes('guest-upload');
          return {
            id: n.id,
            nodeId: n.id,
            mediaId: typeof data.mediaId === 'string' ? data.mediaId : `${n.id}-media`,
            url: typeof data.url === 'string' ? data.url : '',
            title: typeof data.title === 'string' ? data.title : 'Wedding Photo',
            caption: typeof data.caption === 'string' ? data.caption : '',
            altText: typeof data.altText === 'string' ? data.altText : 'Wedding Photo',
            category: isGuest ? 'guest' : 'curated',
            source: isGuest ? 'guest-upload' : 'curated',
            status:
              data.status === 'PENDING' || data.status === 'REJECTED' ? data.status : 'APPROVED',
            isVisible: data.isVisible !== false,
            isGuestUpload: isGuest,
            ...(typeof data.uploaderName === 'string' ? { uploaderName: data.uploaderName } : {}),
            createdAt: toDateInstance(n.createdAt).toISOString(),
            updatedAt: toDateInstance(n.updatedAt).toISOString(),
          };
        });
      }
    }

    if (Array.isArray(rawPayload.subEvent)) {
      next.subEvents = rawPayload.subEvent as SubEventDTO[];
      importedCounts.subEvent = next.subEvents.length;
    }
    if (Array.isArray(rawPayload.subEventAccess)) {
      next.subEventAccess = rawPayload.subEventAccess as DemoSubEventAccessRecord[];
      importedCounts.subEventAccess = next.subEventAccess.length;
    }
    if (Array.isArray(rawPayload.subEventRsvp)) {
      const guestById = new Map(next.guests.map((g) => [g.id, g]));
      const rawMemberRsvps = Array.isArray(rawPayload.subEventMemberRsvp)
        ? (rawPayload.subEventMemberRsvp as Array<Record<string, unknown>>)
        : null;
      const memberRsvpsByRsvpId = new Map<string, DemoSubEventMemberRsvpRecord[]>();
      if (rawMemberRsvps) {
        importedCounts.subEventMemberRsvp = rawMemberRsvps.length;
        for (const mr of rawMemberRsvps) {
          const rsvpId = String(mr.subEventRsvpId ?? '');
          if (!rsvpId) continue;
          const list = memberRsvpsByRsvpId.get(rsvpId) ?? [];
          const rawSt = String(mr.status ?? 'pending').toLowerCase();
          const st: 'attending' | 'declined' | 'pending' =
            rawSt === 'attending' ? 'attending' : rawSt === 'declined' ? 'declined' : 'pending';
          list.push({
            id: String(mr.id ?? `${rsvpId}-mr-${list.length + 1}`),
            subEventRsvpId: rsvpId,
            householdMemberId: String(mr.householdMemberId ?? ''),
            status: st,
            mealOptionId: typeof mr.mealOptionId === 'string' ? mr.mealOptionId : null,
            dietaryNotes: typeof mr.dietaryNotes === 'string' ? mr.dietaryNotes : null,
          });
          memberRsvpsByRsvpId.set(rsvpId, list);
        }
      }
      next.subEventRsvps = (rawPayload.subEventRsvp as Array<Record<string, unknown>>).map((r) => {
        const rsvpId = String(r.id);
        const guest = guestById.get(String(r.invitationCodeId));
        const rawStatus = String(r.status ?? 'ATTENDING').toUpperCase();
        const normalizedStatus: 'ATTENDING' | 'DECLINED' | 'PENDING' =
          rawStatus === 'DECLINED'
            ? 'DECLINED'
            : rawStatus === 'PENDING'
              ? 'PENDING'
              : 'ATTENDING';
        const meals = Array.isArray(r.mealSelections)
          ? r.mealSelections.map(String)
          : [];
        const plusOneCount = Number(r.plusOneCount ?? 0);
        const explicitMr = memberRsvpsByRsvpId.get(rsvpId);
        const memberRsvps: DemoSubEventMemberRsvpRecord[] =
          explicitMr && explicitMr.length > 0
            ? explicitMr
            : guest
              ? buildDemoHouseholdMembersForGuest(guest).map((m, mIdx) => {
                const cap = normalizedStatus === 'ATTENDING' ? 1 + Math.max(0, plusOneCount) : 0;
                const st: 'attending' | 'declined' | 'pending' =
                  normalizedStatus === 'DECLINED'
                    ? 'declined'
                    : normalizedStatus === 'PENDING'
                      ? 'pending'
                      : mIdx < cap
                        ? 'attending'
                        : 'declined';
                return {
                  id: `${rsvpId}-mr-${mIdx + 1}`,
                  subEventRsvpId: rsvpId,
                  householdMemberId: m.id,
                  status: st,
                  mealOptionId: st === 'attending' ? (meals[mIdx] ?? null) : null,
                  dietaryNotes: st === 'declined' ? null : (m.dietaryNotes ?? null),
                };
              })
              : [];
        return {
          id: rsvpId,
          subEventId: String(r.subEventId),
          invitationCodeId: String(r.invitationCodeId),
          guestCode: guest?.code ?? '',
          guestName: guest?.guestName ?? 'Guest',
          status: normalizedStatus,
          plusOneCount,
          plusOneNames: Array.isArray(r.plusOneNames) ? r.plusOneNames.map(String) : [],
          mealSelection: meals[0] ?? null,
          mealSelections: meals,
          dietaryNotes: typeof r.dietaryNotes === 'string' ? r.dietaryNotes : '',
          customAnswers:
            r.customAnswers && typeof r.customAnswers === 'object'
              ? (r.customAnswers as Record<string, string>)
              : {},
          memberRsvps,
          respondedAt: toDateInstance(r.createdAt).toISOString(),
          updatedAt: toDateInstance(r.updatedAt).toISOString(),
        };
      });
      importedCounts.subEventRsvp = next.subEventRsvps.length;
    }

    if (Array.isArray(rawPayload.broadcastMessage)) {
      const rcptArr = Array.isArray(rawPayload.broadcastRecipient)
        ? (rawPayload.broadcastRecipient as Array<Record<string, unknown>>)
        : [];
      next.broadcastMessages = (
        rawPayload.broadcastMessage as Array<Record<string, unknown>>
      ).map((b): DemoBroadcastRecord => {
        const id = String(b.id);
        const rcpts = rcptArr
          .filter((r) => String(r.broadcastId) === id)
          .map((r) => ({
            id: String(r.id),
            broadcastId: id,
            invitationCodeId:
              typeof r.invitationCodeId === 'string' ? r.invitationCodeId : null,
            recipientName: String(r.guestName ?? r.recipientName ?? 'Guest'),
            recipientEmail: String(r.destination ?? 'guest@example.com'),
            channel: (b.channel === 'SMS' ? 'SMS' : 'EMAIL') as 'EMAIL' | 'SMS',
            status: (r.status as 'SENT' | 'DELIVERED' | 'VIEWED' | 'FAILED' | 'PENDING') ?? 'SENT',
            sentAt: r.sentAt ? toDateInstance(r.sentAt).toISOString() : null,
            viewedAt: null,
            errorMessage: typeof r.error === 'string' ? r.error : null,
          }));
        return {
          id,
          subject: String(b.subject ?? 'Broadcast'),
          body: String(b.body ?? ''),
          channel: b.channel === 'SMS' ? 'SMS' : 'EMAIL',
          status:
            (b.status as 'SENT' | 'SCHEDULED' | 'PARTIAL' | 'FAILED' | 'CANCELLED') ?? 'SENT',
          audienceLabel: 'Imported Broadcast',
          recipientCount: Number(b.totalRecipients ?? rcpts.length),
          sentCount: Number(b.sentCount ?? rcpts.length),
          failedCount: Number(b.failedCount ?? 0),
          viewedCount: rcpts.filter((r) => r.status === 'VIEWED').length,
          scheduledAt: b.scheduledFor ? toDateInstance(b.scheduledFor).toISOString() : null,
          sentAt: b.sentAt ? toDateInstance(b.sentAt).toISOString() : null,
          createdBy: 'Admin',
          createdAt: toDateInstance(b.createdAt).toISOString(),
          updatedAt: toDateInstance(b.updatedAt).toISOString(),
          recipients: rcpts,
        };
      });
      importedCounts.broadcastMessage = next.broadcastMessages.length;
    }

    const importAudit: DemoSnapshotVersionRecord = {
      id: `demo-version-import-${Date.now()}`,
      entityType: 'DatabaseBackup',
      entityId: 'full-restore',
      action: 'IMPORT_BACKUP',
      summary: 'Restored database state from JSON backup file',
      createdBy: 'Admin',
      createdAt: new Date().toISOString(),
      data: { importedCounts },
    };
    next.snapshotVersions = [importAudit, ...next.snapshotVersions].slice(
      0,
      MAX_STORED_SNAPSHOT_VERSIONS
    );

    return {
      ...prev,
      themePreset: nextThemePreset,
      configOverrides: nextOverrides,
      activeModules: [...ALL_DEMO_MODULES],
      datasets: withUpdatedDataset(prev.datasets, prev.archetype, next),
    };
  });

  return { importedCounts };
}

registerDemoRuntimeBridge({
  isAdminSession: isDemoAdminSession,
  findGuestByCode: findDemoGuestByCode,
});
