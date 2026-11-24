'use client';

import React, { useState, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { StickyBar } from '@/components/ui/useStickyOffset';
import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import type { StaticDemoStore } from './types';

export interface StaticDemoToolbarProps {
  store: StaticDemoStore;
  queryClient?: QueryClient;
}

const ARCHETYPE_OPTIONS: Array<{ id: ArchetypeId; label: string }> = (
  Object.keys(ARCHETYPE_PRESETS) as ArchetypeId[]
).map((id) => ({
  id,
  label: ARCHETYPE_PRESETS[id].name,
}));

export function StaticDemoToolbar({
  store,
  queryClient,
}: StaticDemoToolbarProps) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [isMinimized, setIsMinimized] = useState(false);
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

  const refreshClientCaches = () => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('setup_wizard_draft');
        window.dispatchEvent(new Event('storage'));
      } catch {
        // Ignore restricted sessionStorage errors
      }
    }
    if (queryClient) {
      void queryClient.invalidateQueries();
      void queryClient.refetchQueries({ type: 'active' });
    }
  };

  const handleArchetypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextArchetype = event.target.value as ArchetypeId;
    store.switchArchetype(nextArchetype);
    refreshClientCaches();
    const label = ARCHETYPE_PRESETS[nextArchetype]?.name ?? nextArchetype;
    setStatusAnnouncement(`Switched showcase preset to ${label}.`);
  };

  const handleReset = () => {
    store.reset(snapshot.activeArchetype);
    refreshClientCaches();
    const label =
      ARCHETYPE_PRESETS[snapshot.activeArchetype]?.name ??
      snapshot.activeArchetype;
    setStatusAnnouncement(`Demo state reset to default ${label} preset.`);
  };

  const handleToggleSetup = () => {
    const nextSetup = !snapshot.isSetupMode;
    store.setSetupMode(nextSetup);
    refreshClientCaches();
    setStatusAnnouncement(
      nextSetup ? 'Opened onboarding setup wizard preview.' : 'Exited setup wizard preview.',
    );
  };

  const sampleInviteCode = snapshot.invitationCode[0]?.code ?? 'DEMO2026';

  return (
    <StickyBar
      as="aside"
      edge="bottom"
      scope="document"
      aria-label="Interactive Demo Controls"
      data-testid="static-demo-toolbar"
      className="fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-700 bg-slate-900/95 px-3.5 py-2.5 text-xs text-white shadow-2xl backdrop-blur print:hidden"
    >
      <div role="status" aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      {isMinimized ? (
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          <span className="font-semibold tracking-wide text-white">Interactive Demo</span>
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            aria-expanded={false}
            aria-label="Expand demo controls"
            className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            Expand
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 pr-1">
            <span
              className="inline-block h-2 w-2 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
            <span className="font-semibold text-white">Demo Mode</span>
            <span
              className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-200 border border-slate-700"
              title="Sample guest invitation code for RSVP and Registry"
            >
              Code: {sampleInviteCode}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <label
              htmlFor="static-demo-archetype-select"
              className="font-medium text-slate-200"
            >
              Preset
            </label>
            <select
              id="static-demo-archetype-select"
              data-testid="static-demo-archetype-select"
              value={snapshot.activeArchetype}
              onChange={handleArchetypeChange}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              {ARCHETYPE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id} className="bg-slate-900 text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            data-testid="static-demo-setup-toggle"
            aria-pressed={snapshot.isSetupMode}
            onClick={handleToggleSetup}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            {snapshot.isSetupMode ? 'Exit Setup' : 'Setup Wizard'}
          </button>

          <button
            type="button"
            data-testid="static-demo-reset"
            onClick={handleReset}
            className="rounded-lg bg-amber-400 px-2.5 py-1 font-semibold text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Reset Demo
          </button>

          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            aria-expanded={true}
            aria-label="Minimize demo controls"
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 transition hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            Hide
          </button>

          {snapshot.storageWarning && (
            <p className="w-full text-[11px] text-amber-200" role="alert">
              {snapshot.storageWarning}
            </p>
          )}
        </div>
      )}
    </StickyBar>
  );
}
