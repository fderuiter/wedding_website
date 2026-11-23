'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/components/ThemeProvider';
import SetupWizard from '@/components/setup/SetupWizard';
import type { PublicAppConfig } from '@/lib/config';
import { installDemoBrowserRuntime } from '@/lib/demo/runtime';
import {
  getDemoState,
  setSetupWizardPreview,
  subscribeDemoState,
} from '@/lib/demo/store';
import type { DemoState } from '@/lib/demo/types';
import { DemoToolbar } from './DemoToolbar';

function emitDemoHomeSync(state: DemoState): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('wedding:demo-state-sync', {
      detail: {
        config: {
          ...state.config,
          features: state.config.siteSections,
        },
        faqNodes: state.contentNodes.filter((node) => node.type === 'FAQ'),
        attractions: state.attractions,
      },
    })
  );
}

export interface DemoRuntimeProviderProps {
  onConfigSync?: (_config: PublicAppConfig) => void;
  onAdminSync?: (_isAdmin: boolean) => void;
  onSetupWizardPreviewSync?: (_isPreview: boolean) => void;
}

export default function DemoRuntimeProvider({
  onConfigSync,
  onAdminSync,
  onSetupWizardPreviewSync,
}: DemoRuntimeProviderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setPreviewConfig } = useTheme();
  const demoState = useSyncExternalStore(subscribeDemoState, getDemoState, getDemoState);

  useEffect(() => {
    installDemoBrowserRuntime();
    const initial = getDemoState();
    setPreviewConfig?.(initial.config);
    onConfigSync?.(initial.config);
    onAdminSync?.(initial.isAdmin);
    onSetupWizardPreviewSync?.(initial.setupWizardPreview);
    emitDemoHomeSync(initial);

    const unsubscribe = subscribeDemoState((next) => {
      setPreviewConfig?.(next.config);
      onConfigSync?.(next.config);
      onAdminSync?.(next.isAdmin);
      onSetupWizardPreviewSync?.(next.setupWizardPreview);
      emitDemoHomeSync(next);
    });

    const handleRequestSync = () => {
      emitDemoHomeSync(getDemoState());
    };

    const handleWizardComplete = (evt: Event) => {
      evt.preventDefault();
      const updated = setSetupWizardPreview(false);
      setPreviewConfig?.(updated.config);
      onConfigSync?.(updated.config);
      onAdminSync?.(updated.isAdmin);
      onSetupWizardPreviewSync?.(false);
      emitDemoHomeSync(updated);
      void queryClient.invalidateQueries();
      router.push('/admin/dashboard');
    };

    window.addEventListener('wedding:demo-request-sync', handleRequestSync);
    window.addEventListener('wedding-demo-setup-complete', handleWizardComplete);

    return () => {
      unsubscribe();
      window.removeEventListener('wedding:demo-request-sync', handleRequestSync);
      window.removeEventListener('wedding-demo-setup-complete', handleWizardComplete);
    };
  }, [onAdminSync, onConfigSync, onSetupWizardPreviewSync, queryClient, router, setPreviewConfig]);

  return (
    <>
      {demoState.setupWizardPreview && (
        <div
          data-testid="demo-setup-wizard-preview"
          className="fixed inset-0 z-[70] overflow-y-auto bg-[var(--color-background)] text-[var(--color-foreground)] pb-32"
        >
          <aside
            aria-label="Setup Wizard Preview Banner"
            className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-stone-900 text-white px-4 py-2.5 text-xs sm:text-sm shadow-md"
          >
            <span>
              <strong>Setup Wizard Preview:</strong> Walk through first-run onboarding without overwriting any server database.
            </span>
            <button
              type="button"
              onClick={() => setSetupWizardPreview(false)}
              data-testid="demo-exit-wizard-preview"
              className="inline-flex items-center min-h-[32px] px-3 py-1 rounded-md font-semibold bg-white text-stone-900 hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              Exit Wizard Preview
            </button>
          </aside>
          <SetupWizard />
        </div>
      )}
      <DemoToolbar demoState={demoState} />
    </>
  );
}
