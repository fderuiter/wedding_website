'use client';

import React, { createContext, useContext } from 'react';
import type { ThemePreset } from '@/lib/theme/presets';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { PublicAppConfig } from '@/lib/config';
import type { ArchetypeDataset } from '@/lib/demo/demoSeed';
import type { DemoPersona } from '@/lib/demo/demoStore';
import { ActiveDemoProvider } from '@/components/demo/ActiveDemoProvider';

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

export const DemoContextInstance = createContext<DemoContextValue | null>(null);

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

export function useOptionalDemo(): DemoContextValue | null {
  return useContext(DemoContextInstance);
}
