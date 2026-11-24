'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { getServerExportTokens, type ThemePreset } from '@/lib/theme/presets';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { PublicAppConfig } from '@/lib/config';
import {
  ADMIN_ONBOARDING_MILESTONES_QUERY_KEY,
  ADMIN_SAMPLE_DATA_QUERY_KEY,
  ADMIN_SEATING_QUERY_KEY,
  invalidateSampleDataCaches,
} from '@/lib/adminCacheSync';
import { installDemoFetchInterceptor } from '@/lib/demo/demoApiHandler';
import type { ArchetypeDataset } from '@/lib/demo/demoSeed';
import {
  applyDemoSampleSelection,
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  hydrateDemoStateFromStorage,
  resetDemoState,
  setDemoArchetype,
  setDemoGuestSession,
  setDemoPersona,
  setDemoRuntimeActive,
  setDemoSetupAuthenticated,
  setDemoThemePreset,
  setDemoToolbarCollapsed,
  subscribeDemoState,
  updateDemoConfigOverrides,
  type DemoPersona,
  type DemoStoreState,
} from '@/lib/demo/demoStore';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface DemoContextValue {
  isDemoMode: boolean;
  persona: DemoPersona;
  archetype: ArchetypeId;
  themePreset: ThemePreset;
  isToolbarCollapsed: boolean;
  setupAuthenticated: boolean;
  configOverrides: Partial<PublicAppConfig>;
  activeModules: string[];
  activeDataset: ArchetypeDataset;
  resetCounter: number;
  setPersona: (persona: DemoPersona) => void;
  setArchetype: (archetype: ArchetypeId) => void;
  setThemePreset: (preset: ThemePreset) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
  setSetupAuthenticated: (authenticated: boolean) => void;
  updateConfigOverrides: (overrides: Partial<PublicAppConfig>) => void;
  applySampleSelection: (archetype: ArchetypeId, modules: string[]) => void;
  validateInviteCode: (code: string) => { valid: boolean; code: string; guestName: string } | null;
  resetDemo: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

const SERVER_SNAPSHOT: DemoStoreState = getDemoState();
function getServerDemoSnapshot(): DemoStoreState {
  return SERVER_SNAPSHOT;
}

interface DemoProviderProps {
  enabled: boolean;
  children: React.ReactNode;
}

export function DemoProvider({ enabled, children }: DemoProviderProps) {
  if (!enabled) {
    return <>{children}</>;
  }
  return <ActiveDemoProvider>{children}</ActiveDemoProvider>;
}

function ActiveDemoProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { setPreviewConfig } = useTheme();
  const toast = useOptionalToast();

  useIsomorphicLayoutEffect(() => {
    hydrateDemoStateFromStorage();
    setDemoRuntimeActive(true);
    const uninstallFetch = installDemoFetchInterceptor();
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.staticDemo = 'true';
    }
    return () => {
      uninstallFetch();
      setDemoRuntimeActive(false);
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.staticDemo;
      }
    };
  }, []);

  const storeState = useSyncExternalStore(
    subscribeDemoState,
    getDemoState,
    getServerDemoSnapshot
  );

  // Sync active themePreset and color overrides into ThemeProvider live stylesheet
  useEffect(() => {
    if (typeof setPreviewConfig !== 'function') return;
    const exportTokens = getServerExportTokens(storeState.themePreset);
    setPreviewConfig({
      themePreset: storeState.themePreset,
      colorPrimary: storeState.configOverrides.colorPrimary || exportTokens.colorPrimary,
      colorSecondary: storeState.configOverrides.colorSecondary || exportTokens.colorSecondary,
      fontHeading: exportTokens.fontHeading,
      fontBody: exportTokens.fontBody,
    });
  }, [
    setPreviewConfig,
    storeState.themePreset,
    storeState.configOverrides.colorPrimary,
    storeState.configOverrides.colorSecondary,
    storeState.resetCounter,
  ]);

  // Refresh cached queries whenever active archetype, modules, or resetCounter changes
  useEffect(() => {
    const dataset = getActiveArchetypeDataset();
    queryClient.setQueriesData(
      { queryKey: ['registry-items'] },
      {
        items: dataset.registryItems,
        total: dataset.registryItems.length,
        page: 1,
        limit: Math.max(100, dataset.registryItems.length),
        totalPages: 1,
      }
    );
    void queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-wedding-party'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-attractions'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-invitation-codes'] });
    void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['photos'] });
    void queryClient.invalidateQueries({ queryKey: ['sub-events'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-sub-events'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-media'] });
    void queryClient.invalidateQueries({ queryKey: ['thank-you-notes'] });
    void queryClient.invalidateQueries({ queryKey: ADMIN_SEATING_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ADMIN_ONBOARDING_MILESTONES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ADMIN_SAMPLE_DATA_QUERY_KEY });
    void invalidateSampleDataCaches();
  }, [
    queryClient,
    storeState.archetype,
    storeState.activeModules,
    storeState.resetCounter,
  ]);

  const handleSetPersona = useCallback(
    (nextPersona: DemoPersona) => {
      setDemoPersona(nextPersona);
      if (nextPersona === 'guest' && pathname?.startsWith('/admin')) {
        router.push('/');
      }
    },
    [pathname, router]
  );

  const handleSetArchetype = useCallback((nextArchetype: ArchetypeId) => {
    setDemoArchetype(nextArchetype);
  }, []);

  const handleSetThemePreset = useCallback((nextPreset: ThemePreset) => {
    setDemoThemePreset(nextPreset);
  }, []);

  const handleSetToolbarCollapsed = useCallback((collapsed: boolean) => {
    setDemoToolbarCollapsed(collapsed);
  }, []);

  const handleSetSetupAuthenticated = useCallback((authenticated: boolean) => {
    setDemoSetupAuthenticated(authenticated);
  }, []);

  const handleUpdateConfigOverrides = useCallback((overrides: Partial<PublicAppConfig>) => {
    updateDemoConfigOverrides(overrides);
  }, []);

  const handleApplySampleSelection = useCallback(
    (nextArchetype: ArchetypeId, modules: string[]) => {
      applyDemoSampleSelection(nextArchetype, modules);
    },
    []
  );

  const handleValidateInviteCode = useCallback((rawCode: string) => {
    const matched = findDemoGuestByCode(rawCode);
    if (!matched) return null;
    setDemoGuestSession({
      invitationCode: matched.code,
      guestName: matched.guestName,
    });
    return {
      valid: true,
      code: matched.code,
      guestName: matched.guestName,
    };
  }, []);

  const handleResetDemo = useCallback(() => {
    resetDemoState();
    const freshDataset = getActiveArchetypeDataset();
    queryClient.setQueriesData(
      { queryKey: ['registry-items'] },
      {
        items: freshDataset.registryItems,
        total: freshDataset.registryItems.length,
        page: 1,
        limit: Math.max(100, freshDataset.registryItems.length),
        totalPages: 1,
      }
    );
    if (typeof setPreviewConfig === 'function') {
      const classicTokens = getServerExportTokens('classic');
      setPreviewConfig({
        themePreset: 'classic',
        colorPrimary: classicTokens.colorPrimary,
        colorSecondary: classicTokens.colorSecondary,
        fontHeading: classicTokens.fontHeading,
        fontBody: classicTokens.fontBody,
      });
    }
    if (pathname?.startsWith('/admin')) {
      router.push('/');
    }
    toast?.addToast(
      'Demo reset to default Invited Guest role, Classic Celebration archetype, and Classic theme.',
      'info'
    );
  }, [pathname, queryClient, router, setPreviewConfig, toast]);

  const activeDataset = useMemo(() => {
    return getActiveArchetypeDataset(storeState);
  }, [storeState]);

  const contextValue = useMemo<DemoContextValue>(
    () => ({
      isDemoMode: true,
      persona: storeState.persona,
      archetype: storeState.archetype,
      themePreset: storeState.themePreset,
      isToolbarCollapsed: storeState.isToolbarCollapsed,
      setupAuthenticated: storeState.setupAuthenticated,
      configOverrides: storeState.configOverrides,
      activeModules: storeState.activeModules,
      activeDataset,
      resetCounter: storeState.resetCounter,
      setPersona: handleSetPersona,
      setArchetype: handleSetArchetype,
      setThemePreset: handleSetThemePreset,
      setToolbarCollapsed: handleSetToolbarCollapsed,
      setSetupAuthenticated: handleSetSetupAuthenticated,
      updateConfigOverrides: handleUpdateConfigOverrides,
      applySampleSelection: handleApplySampleSelection,
      validateInviteCode: handleValidateInviteCode,
      resetDemo: handleResetDemo,
    }),
    [
      storeState.persona,
      storeState.archetype,
      storeState.themePreset,
      storeState.isToolbarCollapsed,
      storeState.setupAuthenticated,
      storeState.configOverrides,
      storeState.activeModules,
      storeState.resetCounter,
      activeDataset,
      handleSetPersona,
      handleSetArchetype,
      handleSetThemePreset,
      handleSetToolbarCollapsed,
      handleSetSetupAuthenticated,
      handleUpdateConfigOverrides,
      handleApplySampleSelection,
      handleValidateInviteCode,
      handleResetDemo,
    ]
  );

  return <DemoContext.Provider value={contextValue}>{children}</DemoContext.Provider>;
}

export function useOptionalDemo(): DemoContextValue | null {
  return useContext(DemoContext);
}
