import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import type {
  ContributorRecord,
  GuestClaimActions,
  InvitationCodeDTO,
  RegistryItem,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import { CARD_PROCESSING_FEE_RATE } from '@/lib/stripe.client';
import { buildArchetypeDataset, type ArchetypeDataset } from './demoSeed';

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

const ALL_DEMO_MODULES = [
  'registry',
  'guests',
  'seating',
  'weddingParty',
  'attractions',
  'faqs',
];

const VALID_PERSONAS: DemoPersona[] = ['guest', 'admin', 'setup'];
const VALID_ARCHETYPES: ArchetypeId[] = ['classic', 'destination', 'romantic'];

function createDefaultDatasets(): Record<ArchetypeId, ArchetypeDataset> {
  return {
    classic: buildArchetypeDataset('classic'),
    destination: buildArchetypeDataset('destination'),
    romantic: buildArchetypeDataset('romantic'),
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
    datasets: createDefaultDatasets(),
    guestSession: null,
    claimTokens: {},
    resetCounter,
  };
}

function reviveDatasetDates(dataset: ArchetypeDataset): ArchetypeDataset {
  return {
    ...dataset,
    weddingParty: dataset.weddingParty.map((m) => ({
      ...m,
      createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(String(m.createdAt)),
      updatedAt: m.updatedAt instanceof Date ? m.updatedAt : new Date(String(m.updatedAt)),
    })),
    attractions: dataset.attractions.map((a) => ({
      ...a,
      createdAt: a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt)),
      updatedAt: a.updatedAt instanceof Date ? a.updatedAt : new Date(String(a.updatedAt)),
    })),
    faqs: dataset.faqs.map((f) => ({
      ...f,
      createdAt: f.createdAt instanceof Date ? f.createdAt : new Date(String(f.createdAt)),
      updatedAt: f.updatedAt instanceof Date ? f.updatedAt : new Date(String(f.updatedAt)),
    })),
    logisticsNodes: dataset.logisticsNodes.map((n) => ({
      ...n,
      createdAt: n.createdAt instanceof Date ? n.createdAt : new Date(String(n.createdAt)),
      updatedAt: n.updatedAt instanceof Date ? n.updatedAt : new Date(String(n.updatedAt)),
    })),
  };
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

let runtimeActive = false;
let hasHydratedFromStorage = false;
let state: DemoStoreState = createInitialDemoState(0);
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function persistDemoState(): void {
  if (!runtimeActive || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or privacy mode errors
  }
}

export function hydrateDemoStateFromStorage(): void {
  if (typeof window === 'undefined') return;
  hasHydratedFromStorage = true;
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<DemoStoreState>;
    const defaults = createInitialDemoState(state.resetCounter);

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

    const hydratedDatasets: Record<ArchetypeId, ArchetypeDataset> = {
      classic: parsed.datasets?.classic
        ? reviveDatasetDates(parsed.datasets.classic)
        : defaults.datasets.classic,
      destination: parsed.datasets?.destination
        ? reviveDatasetDates(parsed.datasets.destination)
        : defaults.datasets.destination,
      romantic: parsed.datasets?.romantic
        ? reviveDatasetDates(parsed.datasets.romantic)
        : defaults.datasets.romantic,
    };

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
      datasets: hydratedDatasets,
      guestSession:
        parsed.guestSession &&
        typeof parsed.guestSession.invitationCode === 'string' &&
        typeof parsed.guestSession.guestName === 'string'
          ? parsed.guestSession
          : null,
      claimTokens:
        parsed.claimTokens && typeof parsed.claimTokens === 'object' ? parsed.claimTokens : {},
      resetCounter: state.resetCounter,
    };
    emitChange();
  } catch {
    // Ignore malformed saved state
  }
}

export function setDemoRuntimeActive(active: boolean): void {
  runtimeActive = active;
  if (active && !hasHydratedFromStorage && typeof window !== 'undefined') {
    hydrateDemoStateFromStorage();
  }
  emitChange();
}

export function isDemoRuntimeActive(): boolean {
  return runtimeActive;
}

export function isDemoAdminSession(): boolean {
  if (!runtimeActive) return false;
  return state.persona === 'admin' || (state.persona === 'setup' && state.setupAuthenticated);
}

export function getDemoState(): DemoStoreState {
  return state;
}

export function subscribeDemoState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateState(updater: (prev: DemoStoreState) => DemoStoreState): void {
  state = updater(state);
  persistDemoState();
  emitChange();
}

export function setDemoPersona(persona: DemoPersona): void {
  updateState((prev) => ({
    ...prev,
    persona,
  }));
}

export function setDemoArchetype(archetype: ArchetypeId): void {
  updateState((prev) => {
    const nextDataset = prev.datasets[archetype];
    const currentCode = prev.guestSession?.invitationCode?.toUpperCase() ?? '';
    const matchingGuest = currentCode
      ? nextDataset.guests.find((g) => g.code.toUpperCase() === currentCode)
      : undefined;

    return {
      ...prev,
      archetype,
      guestSession: matchingGuest
        ? { invitationCode: matchingGuest.code, guestName: matchingGuest.guestName }
        : null,
    };
  });
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
}

export function updateDemoConfigOverrides(overrides: Partial<PublicAppConfig>): void {
  updateState((prev) => {
    const nextThemePreset =
      overrides.themePreset && THEME_PRESET_KEYS.includes(overrides.themePreset as ThemePreset)
        ? (overrides.themePreset as ThemePreset)
        : prev.themePreset;
    return {
      ...prev,
      themePreset: nextThemePreset,
      configOverrides: {
        ...prev.configOverrides,
        ...overrides,
      },
    };
  });
}

export function applyDemoSampleSelection(archetype: ArchetypeId, modules: string[]): void {
  updateState((prev) => ({
    ...prev,
    archetype,
    activeModules: [...modules],
    datasets: {
      ...prev.datasets,
      [archetype]: buildArchetypeDataset(archetype),
    },
  }));
}

export function purgeDemoSampleData(): void {
  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const filteredGuests = current.guests.filter((g) => !g.isSample);
    const filteredTables = syncTableGuests(
      current.seatingTables.filter((t) => !t.isSample),
      filteredGuests
    );
    return {
      ...prev,
      activeModules: [],
      datasets: {
        ...prev.datasets,
        [prev.archetype]: {
          ...current,
          registryItems: current.registryItems.filter((i) => !i.isSample),
          guests: filteredGuests,
          seatingTables: filteredTables,
          weddingParty: current.weddingParty.filter((m) => !m.isSample),
          attractions: current.attractions.filter((a) => !a.isSample),
          faqs: [],
        },
      },
    };
  });
}

export function resetDemoState(): void {
  const nextResetCounter = state.resetCounter + 1;
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
  emitChange();
}

export function getActiveArchetypeDataset(
  targetState: DemoStoreState = state
): ArchetypeDataset {
  const current = targetState.datasets[targetState.archetype] ?? targetState.datasets.classic;
  const activeSet = new Set(targetState.activeModules);
  return {
    registryItems: activeSet.has('registry')
      ? current.registryItems
      : current.registryItems.filter((i) => !i.isSample),
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
  };
}

export function findDemoGuestByCode(rawCode: string): InvitationCodeDTO | null {
  const normalized = rawCode.trim().toUpperCase();
  if (!normalized) return null;

  const activeGuests = getActiveArchetypeDataset().guests;
  const directMatch = activeGuests.find((g) => g.code.toUpperCase() === normalized);
  if (directMatch) return directMatch;

  const presetGuests = ARCHETYPE_PRESETS[state.archetype]?.guests ?? [];
  const presetMatch = presetGuests.find((g) => g.code.toUpperCase() === normalized);
  if (!presetMatch) return null;

  return {
    id: `demo-${state.archetype}-preset-${normalized}`,
    code: presetMatch.code.toUpperCase(),
    guestName: presetMatch.guestName,
    householdName: presetMatch.householdName,
    partyGroup: presetMatch.partyGroup,
    partyTags: [...presetMatch.partyTags],
    plusOneAllocations: presetMatch.plusOnesAllowed ?? 0,
    used: true,
    isSample: true,
  };
}

export function setDemoGuestSession(session: DemoGuestSession | null): void {
  updateState((prev) => ({
    ...prev,
    guestSession: session,
  }));
}

export function updateDemoGuestAddress(
  code: string,
  address: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  }
): InvitationCodeDTO | null {
  const normalized = code.trim().toUpperCase();
  let updatedGuest: InvitationCodeDTO | null = null;

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const nextGuests = current.guests.map((g) => {
      if (g.code.toUpperCase() !== normalized) return g;
      const next: InvitationCodeDTO = {
        ...g,
        addressLine1: address.addressLine1 ?? g.addressLine1 ?? '',
        addressLine2: address.addressLine2 ?? g.addressLine2 ?? '',
        city: address.city ?? g.city ?? '',
        state: address.state ?? g.state ?? '',
        zipCode: address.zipCode ?? g.zipCode ?? '',
        country: address.country ?? g.country ?? '',
        updatedAt: new Date().toISOString(),
      };
      updatedGuest = next;
      return next;
    });

    return {
      ...prev,
      datasets: {
        ...prev.datasets,
        [prev.archetype]: {
          ...current,
          guests: nextGuests,
          seatingTables: syncTableGuests(current.seatingTables, nextGuests),
        },
      },
    };
  });

  return updatedGuest;
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
    const targetItem = current.registryItems.find((i) => i.id === input.itemId);
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
    let linkedGuest = normalizedCode
      ? current.guests.find((g) => g.code.toUpperCase() === normalizedCode) ?? null
      : null;
    if (!linkedGuest && !normalizedCode && normalizedEmail) {
      const emailMatches = current.guests.filter(
        (g) => (g.email || '').trim().toLowerCase() === normalizedEmail.toLowerCase()
      );
      if (emailMatches.length === 1) {
        linkedGuest = emailMatches[0];
      }
    }

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
    const nextGuests =
      linkedGuest && hasCompleteContributorAddress && !linkedGuest.addressLine1?.trim()
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
      datasets: {
        ...prev.datasets,
        [prev.archetype]: {
          ...current,
          guests: nextGuests,
          seatingTables: syncTableGuests(current.seatingTables, nextGuests),
          registryItems: current.registryItems.map((i) =>
            i.id === updatedItem.id ? updatedItem : i
          ),
        },
      },
    };
  });

  return resultItem;
}

export function processDemoClaimToken(token: string): {
  action: 'confirm' | 'cancel';
  status: 'CONFIRMED' | 'CANCELLED';
  changed: boolean;
  item: RegistryItem | null;
} | null {
  const record = state.claimTokens[token];
  if (!record) return null;

  let updatedItem: RegistryItem | null = null;
  let changed = false;
  const targetStatus: 'CONFIRMED' | 'CANCELLED' =
    record.action === 'confirm' ? 'CONFIRMED' : 'CANCELLED';

  updateState((prev) => {
    const current = prev.datasets[prev.archetype];
    const item = current.registryItems.find((i) => i.id === record.itemId);
    if (!item) return prev;

    const contributor = item.contributors.find((c) => c.id === record.contributorId);
    if (!contributor) {
      updatedItem = item;
      return prev;
    }

    if (contributor.status === targetStatus) {
      updatedItem = item;
      return prev;
    }

    changed = true;
    const nextContributors = item.contributors.map((c) =>
      c.id === record.contributorId ? { ...c, status: targetStatus } : c
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
      purchaserName:
        !item.isGroupGift && !nextPurchased ? null : item.purchaserName,
      contributors: nextContributors,
    };
    updatedItem = nextItem;

    return {
      ...prev,
      datasets: {
        ...prev.datasets,
        [prev.archetype]: {
          ...current,
          registryItems: current.registryItems.map((i) => (i.id === nextItem.id ? nextItem : i)),
        },
      },
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
      datasets: {
        ...prev.datasets,
        [prev.archetype]: {
          ...next,
          seatingTables: syncTableGuests(next.seatingTables, next.guests),
        },
      },
    };
  });
}
