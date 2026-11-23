'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/components/ThemeProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getPortalBaseUrl } from '@/utils/basePath';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import {
  resetDemoState,
  setSetupWizardPreview,
  switchDemoArchetype,
  updateDemoState,
} from '@/lib/demo/store';
import type { DemoState } from '@/lib/demo/types';

const DEMO_TOOLBAR_COLLAPSED_KEY = 'wedding_demo_toolbar_collapsed_v1';

interface DemoToolbarProps {
  demoState: DemoState;
}

const ARCHETYPE_OPTIONS: Array<{ id: ArchetypeId; label: string }> = [
  { id: 'classic', label: 'Classic' },
  { id: 'destination', label: 'Destination' },
  { id: 'romantic', label: 'Romantic' },
];

export function DemoToolbar({ demoState }: DemoToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { resolvedTheme, setThemeMode, setPreviewConfig } = useTheme();
  const { addToast } = useToast();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(DEMO_TOOLBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [liveStatus, setLiveStatus] = useState('');

  const handleToggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    try {
      window.sessionStorage.setItem(DEMO_TOOLBAR_COLLAPSED_KEY, String(next));
    } catch {
      // Ignore storage errors
    }
  };

  const navigatePersona = (targetPath: string, requireAdmin = false) => {
    updateDemoState((draft) => {
      draft.setupWizardPreview = false;
      if (requireAdmin) {
        draft.isAdmin = true;
      }
    });
    if (requireAdmin) {
      try {
        window.localStorage.setItem('isAdminLoggedIn', 'true');
        window.dispatchEvent(new Event('storage'));
      } catch {
        // Ignore storage errors
      }
    }
    void queryClient.invalidateQueries();
    router.push(targetPath);
  };

  const handleToggleSetupWizard = () => {
    const next = !demoState.setupWizardPreview;
    setSetupWizardPreview(next);
    setLiveStatus(
      next
        ? 'First-Run Setup Wizard preview opened.'
        : 'Exited First-Run Setup Wizard preview.'
    );
  };

  const handleArchetypeChange = (archetypeId: ArchetypeId) => {
    const next = switchDemoArchetype(archetypeId);
    setPreviewConfig?.(next.config);
    void queryClient.invalidateQueries();
    const label = ARCHETYPE_OPTIONS.find((opt) => opt.id === archetypeId)?.label ?? archetypeId;
    setLiveStatus(`Switched demo preset to ${label}.`);
    addToast(`Loaded ${label} wedding preset.`, 'success');
  };

  const handleThemeToggle = () => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextTheme);
    setLiveStatus(`Switched color scheme to ${nextTheme} mode.`);
  };

  const handleResetDemo = () => {
    const fresh = resetDemoState('classic');
    setPreviewConfig?.(fresh.config);
    void queryClient.invalidateQueries();
    setLiveStatus('Demo data reset to initial state.');
    addToast('Demo state reset to initial sample data.', 'success');
  };

  const isGuestActive =
    !demoState.setupWizardPreview &&
    (pathname === '/' ||
      pathname === '/wedding-party' ||
      pathname === '/things-to-do' ||
      pathname === '/photos' ||
      pathname === '/weather' ||
      pathname === '/guest');
  const isRegistryActive =
    !demoState.setupWizardPreview && Boolean(pathname?.startsWith('/registry'));
  const isHeartActive = !demoState.setupWizardPreview && pathname === '/heart';
  const isAdminActive =
    !demoState.setupWizardPreview && Boolean(pathname?.startsWith('/admin'));

  const baseButtonClasses =
    'inline-flex items-center justify-center min-h-[34px] min-w-[34px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2';
  const activeButtonClasses =
    'bg-stone-900 text-white dark:bg-amber-400 dark:text-gray-950 border border-stone-900 dark:border-amber-400 shadow-xs';
  const inactiveButtonClasses =
    'bg-stone-100 text-stone-900 hover:bg-stone-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 border border-stone-300 dark:border-gray-600';

  return (
    <aside
      aria-label="Interactive Demo Controls"
      data-testid="demo-toolbar"
      className="fixed bottom-3 right-3 left-3 sm:left-auto z-[80] max-w-4xl rounded-2xl bg-white/95 dark:bg-gray-900/95 text-stone-900 dark:text-gray-100 border border-stone-300 dark:border-gray-700 shadow-2xl backdrop-blur-md"
    >
      <div role="status" aria-live="polite" className="sr-only">
        {liveStatus}
      </div>

      <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-b border-stone-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600 dark:bg-emerald-400"
          />
          <span className="text-xs font-bold tracking-wide uppercase text-stone-800 dark:text-gray-100">
            Interactive Showcase Demo
          </span>
          <span className="hidden md:inline-block text-xs text-stone-600 dark:text-gray-300">
            Zero-backend browser state
          </span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={getPortalBaseUrl()}
            target="_self"
            data-testid="demo-toolbar-docs-link"
            className={`${baseButtonClasses} ${inactiveButtonClasses}`}
          >
            Docs &amp; API Portal
          </a>
          <button
            type="button"
            onClick={handleToggleCollapse}
            aria-expanded={!isCollapsed}
            aria-controls="demo-toolbar-panel"
            data-testid="demo-toolbar-collapse"
            className={`${baseButtonClasses} ${inactiveButtonClasses}`}
          >
            {isCollapsed ? 'Expand Demo Bar' : 'Minimize'}
          </button>
        </div>
      </div>

      <div
        id="demo-toolbar-panel"
        hidden={isCollapsed}
        className={isCollapsed ? 'hidden' : 'p-3 space-y-2.5'}
      >
        <div
          role="group"
          aria-label="Switch Demo Persona"
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-xs font-semibold text-stone-700 dark:text-gray-300 mr-1">
            Explore:
          </span>
          <button
            type="button"
            onClick={() => navigatePersona('/')}
            aria-current={isGuestActive ? 'page' : undefined}
            data-testid="demo-persona-guest"
            className={`${baseButtonClasses} ${isGuestActive ? activeButtonClasses : inactiveButtonClasses}`}
          >
            Guest Experience
          </button>
          <button
            type="button"
            onClick={() => navigatePersona('/registry')}
            aria-current={isRegistryActive ? 'page' : undefined}
            data-testid="demo-persona-registry"
            className={`${baseButtonClasses} ${isRegistryActive ? activeButtonClasses : inactiveButtonClasses}`}
          >
            Gift Registry
          </button>
          <button
            type="button"
            onClick={() => navigatePersona('/heart')}
            aria-current={isHeartActive ? 'page' : undefined}
            data-testid="demo-persona-heart"
            className={`${baseButtonClasses} ${isHeartActive ? activeButtonClasses : inactiveButtonClasses}`}
          >
            3D Physics
          </button>
          <button
            type="button"
            onClick={() => navigatePersona('/admin/dashboard', true)}
            aria-current={isAdminActive ? 'page' : undefined}
            data-testid="demo-persona-admin"
            className={`${baseButtonClasses} ${isAdminActive ? activeButtonClasses : inactiveButtonClasses}`}
          >
            Admin Control Panel
          </button>
          <button
            type="button"
            onClick={handleToggleSetupWizard}
            aria-pressed={demoState.setupWizardPreview}
            data-testid="demo-persona-wizard"
            className={`${baseButtonClasses} ${demoState.setupWizardPreview ? activeButtonClasses : inactiveButtonClasses}`}
          >
            First-Run Setup Wizard
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-200 dark:border-gray-800">
          <div
            role="group"
            aria-label="Wedding Archetype Preset"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-xs font-semibold text-stone-700 dark:text-gray-300 mr-1">
              Archetype:
            </span>
            {ARCHETYPE_OPTIONS.map((option) => {
              const selected = demoState.activeArchetype === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleArchetypeChange(option.id)}
                  aria-pressed={selected}
                  data-testid={`demo-archetype-${option.id}`}
                  className={`${baseButtonClasses} ${selected ? activeButtonClasses : inactiveButtonClasses}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleThemeToggle}
              aria-pressed={resolvedTheme === 'dark'}
              data-testid="demo-theme-toggle"
              className={`${baseButtonClasses} ${inactiveButtonClasses}`}
            >
              {resolvedTheme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
            </button>
            <button
              type="button"
              onClick={handleResetDemo}
              data-testid="demo-reset-button"
              className={`${baseButtonClasses} bg-rose-50 text-rose-900 hover:bg-rose-100 dark:bg-rose-950/80 dark:text-rose-100 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-700`}
            >
              Reset Demo Data
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
