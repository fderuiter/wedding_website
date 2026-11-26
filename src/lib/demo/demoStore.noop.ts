import type { ContentNodeDTO } from '@/features/content';
import type {
  GuestClaimActions,
  InvitationCodeDTO,
  RegistryItem,
} from '@/features/registry';
import type { PublicAppConfig } from '@/lib/config';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { ThemePreset } from '@/lib/theme/presets';
import type {
  ArchetypeDataset,
  DemoSnapshotVersionRecord,
} from './demoSeed';
import { buildArchetypeDataset } from './demoSeed.noop';
import type {
  DemoClaimPreview,
  DemoContributionInput,
  DemoGuestAddressUpdateInput,
  DemoGuestSession,
  DemoPersona,
  DemoStoreState,
  EncodedDemoUpload,
} from './demoStore';

let emptyState: DemoStoreState | null = null;

export async function encodeDemoUploadedFile(
  _file: Blob,
  _fallbackLabel = 'Guest Photo'
): Promise<EncodedDemoUpload> {
  return {
    url: '',
    persistentUrl: '',
    isSessionBlob: false,
    sizeBytes: 0,
    mimeType: 'image/jpeg',
  };
}

export function hydrateDemoStateFromStorage(): void {}

export function setDemoRuntimeActive(_active: boolean): void {}

export function isDemoRuntimeActive(): boolean {
  return false;
}

export function isDemoAdminSession(): boolean {
  return false;
}

export function getDemoState(): DemoStoreState {
  if (!emptyState) {
    const emptyDataset = buildArchetypeDataset('classic');
    emptyState = {
      persona: 'guest',
      archetype: 'classic',
      themePreset: 'classic',
      isToolbarCollapsed: false,
      setupAuthenticated: false,
      configOverrides: {},
      activeModules: [],
      datasets: {
        classic: emptyDataset,
        destination: emptyDataset,
        romantic: emptyDataset,
      },
      guestSession: null,
      claimTokens: {},
      resetCounter: 0,
    };
  }
  return emptyState;
}

export function subscribeDemoState(_listener: () => void): () => void {
  return () => {};
}

export function setDemoPersona(_persona: DemoPersona): void {}

export function setDemoArchetype(_archetype: ArchetypeId): void {}

export function setDemoThemePreset(_themePreset: ThemePreset): void {}

export function setDemoToolbarCollapsed(_collapsed: boolean): void {}

export function setDemoSetupAuthenticated(_authenticated: boolean): void {}

export function updateDemoConfigOverrides(
  _overrides: Partial<PublicAppConfig>
): void {}

export function applyDemoSampleSelection(
  _archetype: ArchetypeId,
  _modules: string[]
): void {}

export function purgeDemoSampleData(): void {}

export function resetDemoState(): void {}

export function getActiveArchetypeDataset(
  _targetState?: DemoStoreState
): ArchetypeDataset {
  return buildArchetypeDataset('classic');
}

export function findDemoGuestByCode(_rawCode: string): InvitationCodeDTO | null {
  return null;
}

export function setDemoGuestSession(_session: DemoGuestSession | null): void {}

export function updateDemoGuestAddress(
  _code: string,
  _address: DemoGuestAddressUpdateInput
): InvitationCodeDTO | null {
  return null;
}

export function resolveDemoRegistryItemIdAlias(
  _items: RegistryItem[],
  _rawItemId: string
): RegistryItem | null {
  return null;
}

export function recordDemoContribution(
  _input: DemoContributionInput
): (RegistryItem & { claimActions?: GuestClaimActions }) | null {
  return null;
}

export function previewDemoClaimToken(_token: string): DemoClaimPreview | null {
  return null;
}

export function processDemoClaimToken(_token: string): {
  action: 'confirm' | 'cancel';
  status: 'CONFIRMED' | 'CANCELLED';
  changed: boolean;
  item: RegistryItem | null;
} | null {
  return null;
}

export function mutateActiveDataset(
  _updater: (current: ArchetypeDataset) => ArchetypeDataset
): void {}

export function getEffectiveDemoSettings(
  _targetState?: DemoStoreState
): Record<string, unknown> {
  return {};
}

export function getDemoContentNodes(
  _dataset: ArchetypeDataset
): ContentNodeDTO[] {
  return [];
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
  const isEntry = typeof entityTypeOrEntry !== 'string';
  return {
    id: '',
    entityType: isEntry ? entityTypeOrEntry.entityType : entityTypeOrEntry,
    entityId: isEntry ? entityTypeOrEntry.entityId : (entityId ?? ''),
    action: isEntry ? entityTypeOrEntry.action : (action ?? ''),
    summary: isEntry ? entityTypeOrEntry.summary : (summary ?? ''),
    createdBy: isEntry ? (entityTypeOrEntry.createdBy ?? 'Admin') : createdBy,
    createdAt: '',
    data: (isEntry ? entityTypeOrEntry.data : data) ?? {},
  };
}

export function restoreDemoAuditVersion(
  _versionId: string
): DemoSnapshotVersionRecord | null {
  return null;
}

export function buildDemoDatabaseBackup(): Record<string, unknown> {
  return {};
}

export function importDemoDatabaseBackup(
  _rawPayload: Record<string, unknown>
): {
  importedCounts: Record<string, number>;
} {
  return { importedCounts: {} };
}
