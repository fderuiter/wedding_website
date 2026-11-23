import type { QueryClient } from '@tanstack/react-query';
import type {
  StaticDemoPageOverrides,
  StaticDemoSavedSetupConfig,
} from './runtime';
import type { StaticDemoStore } from './types';

export function installStaticDemoFetchRouter(): StaticDemoStore | null {
  return null;
}

export function ensureStaticDemoRuntime(): StaticDemoStore | null {
  return null;
}

export function useStaticDemoPageOverrides(): StaticDemoPageOverrides | null {
  return null;
}

export function getStaticDemoSavedSetupConfig():
  | StaticDemoSavedSetupConfig
  | undefined {
  return undefined;
}

export function completeStaticDemoSetup(): void {
  // No-op in standalone server builds
}

export function StaticDemoMount(_props: { queryClient?: QueryClient }) {
  return null;
}
