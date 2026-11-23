'use client';

import React, { createContext, useContext } from 'react';
import dynamic from 'next/dynamic';
import type { ThemePreset } from '@/lib/theme/presets';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { PublicAppConfig } from '@/lib/config';
import type { RegistryShippingAddress } from '@/features/registry';
import type { ArchetypeDataset } from '@/lib/demo/demoSeed';
import type { DemoPersona } from '@/lib/demo/demoStore';

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
  shippingAddress: RegistryShippingAddress;
  resetCounter: number;
  setPersona: (persona: DemoPersona) => void;
  setArchetype: (archetype: ArchetypeId) => void;
  setThemePreset: (preset: ThemePreset) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
  setSetupAuthenticated: (authenticated: boolean) => void;
  updateConfigOverrides: (overrides: Partial<PublicAppConfig>) => void;
  applySampleSelection: (archetype: ArchetypeId, modules: string[]) => void;
  validateInviteCode: (
    code: string
  ) => { valid: boolean; code: string; guestName: string } | null;
  resetDemo: () => void;
}

export const DemoContext = createContext<DemoContextValue | null>(null);

const DynamicActiveDemoProvider = dynamic(
  () => import('./ActiveDemoProvider'),
  {
    loading: () => null,
  }
);

interface DemoProviderProps {
  enabled: boolean;
  children: React.ReactNode;
}

export function DemoProvider({ enabled, children }: DemoProviderProps) {
  if (!enabled) {
    return <>{children}</>;
  }
  return <DynamicActiveDemoProvider>{children}</DynamicActiveDemoProvider>;
}

export function useOptionalDemo(): DemoContextValue | null {
  return useContext(DemoContext);
}
