'use client';

import { useState } from 'react';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Icon } from '@/components/ui/Icon';
import { getPortalBaseUrl, resolveShowcasePath } from '@/lib/basePath';
import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { DemoPersona } from '@/lib/demo/demoStore';
import { useOptionalDemo } from './DemoContext';

const PERSONA_OPTIONS: Array<{ id: DemoPersona; label: string; testId: string }> = [
  { id: 'guest', label: 'Invited Guest', testId: 'demo-persona-guest' },
  { id: 'admin', label: 'Couple Admin', testId: 'demo-persona-admin' },
  { id: 'setup', label: 'First-Run Setup', testId: 'demo-persona-setup' },
];

const ARCHETYPE_IDS: ArchetypeId[] = ['classic', 'destination', 'romantic'];

const PRESET_LABELS: Record<ThemePreset, string> = {
  classic: 'Classic',
  modern: 'Modern',
  romantic: 'Romantic',
  minimal: 'Minimal',
  editorial: 'Editorial',
};

const SHOWCASE_LINK_CLASS =
  'inline-flex items-center gap-1 min-h-[32px] min-w-[32px] px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100';

export function DemoToolbar() {
  const demo = useOptionalDemo();
  const [copiedCode, setCopiedCode] = useState(false);

  if (!demo?.isDemoMode) {
    return null;
  }

  const {
    persona,
    archetype,
    themePreset,
    isToolbarCollapsed,
    setPersona,
    setArchetype,
    setThemePreset,
    setToolbarCollapsed,
    resetDemo,
  } = demo;

  const docsHref = resolveShowcasePath('/');
  const apiHref = resolveShowcasePath('/api/');
  const storybookHref = resolveShowcasePath('/storybook/');
  const sampleCode = ARCHETYPE_PRESETS[archetype]?.guests[0]?.code ?? 'SMITH2026';

  const handleCopySampleCode = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sampleCode);
      }
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <aside
      aria-label="Interactive Demo Controls"
      data-testid="demo-toolbar"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 shadow-2xl backdrop-blur-md print:hidden"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
              Interactive Showcase
            </span>
            <nav
              aria-label="Showcase navigation"
              data-testid="demo-showcase-links"
              className="inline-flex flex-wrap items-center gap-1.5"
            >
              <a
                href={docsHref}
                data-testid="demo-link-docs"
                data-static-demo-bypass="true"
                className={SHOWCASE_LINK_CLASS}
              >
                <Icon name="ArrowLeft" className="w-3.5 h-3.5" />
                <span>Docs Portal</span>
              </a>
              <a
                href={apiHref}
                data-testid="demo-link-api"
                data-static-demo-bypass="true"
                className={SHOWCASE_LINK_CLASS}
              >
                <Icon name="Globe" className="w-3.5 h-3.5" />
                <span>API Explorer</span>
              </a>
              <AccessibleExternalLink
                href={storybookHref}
                data-testid="demo-link-storybook"
                data-static-demo-bypass="true"
                showIcon
                iconClassName="w-3.5 h-3.5 ml-0.5"
                className={SHOWCASE_LINK_CLASS}
              >
                <span>Storybook</span>
              </AccessibleExternalLink>
            </nav>
            {isToolbarCollapsed && (
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Role:{' '}
                <strong className="font-semibold">
                  {PERSONA_OPTIONS.find((p) => p.id === persona)?.label}
                </strong>{' '}
                · {ARCHETYPE_PRESETS[archetype]?.name} · {PRESET_LABELS[themePreset]} Theme
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={getPortalBaseUrl()}
              data-testid="demo-portal-link"
              data-static-demo-bypass="true"
              className="inline-flex items-center gap-1.5 min-h-[32px] min-w-[32px] px-3 py-1 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
            >
              <Icon name="Globe" className="w-3.5 h-3.5" />
              <span>Docs Portal</span>
            </a>

            <button
              type="button"
              data-testid="demo-reset-button"
              onClick={resetDemo}
              className="inline-flex items-center gap-1.5 min-h-[32px] min-w-[32px] px-3 py-1 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
            >
              <Icon name="RotateCw" className="w-3.5 h-3.5" />
              <span>Reset Demo</span>
            </button>

            <button
              type="button"
              data-testid="demo-toolbar-toggle"
              aria-expanded={!isToolbarCollapsed}
              aria-controls="demo-toolbar-controls-panel"
              onClick={() => setToolbarCollapsed(!isToolbarCollapsed)}
              className="inline-flex items-center gap-1 min-h-[32px] min-w-[32px] px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
            >
              <span>{isToolbarCollapsed ? 'Expand Toolbar' : 'Collapse'}</span>
              <Icon
                name="ChevronDown"
                className={`w-4 h-4 transition-transform ${isToolbarCollapsed ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        {!isToolbarCollapsed && (
          <div
            id="demo-toolbar-controls-panel"
            className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          >
            {/* Persona / Role Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                id="demo-persona-group-label"
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                View As:
              </span>
              <div
                role="group"
                aria-labelledby="demo-persona-group-label"
                className="inline-flex flex-wrap gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
              >
                {PERSONA_OPTIONS.map((option) => {
                  const isActive = persona === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={option.testId}
                      aria-pressed={isActive}
                      onClick={() => setPersona(option.id)}
                      className={`min-h-[32px] min-w-[32px] px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 ${
                        isActive
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950 shadow-xs'
                          : 'text-slate-800 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Archetype + Sample Code + Theme Preset Selectors */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="demo-archetype-select"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  Archetype:
                </label>
                <select
                  id="demo-archetype-select"
                  data-testid="demo-archetype-select"
                  value={archetype}
                  onChange={(e) => setArchetype(e.target.value as ArchetypeId)}
                  className="min-h-[32px] rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
                >
                  {ARCHETYPE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {ARCHETYPE_PRESETS[id].name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                data-testid="demo-sample-code-button"
                onClick={handleCopySampleCode}
                title="Copy sample household invitation code for guest portal & registry"
                className="inline-flex items-center gap-1.5 min-h-[32px] min-w-[32px] px-2.5 py-1 rounded-md text-xs font-mono font-semibold border border-slate-300 dark:border-slate-600 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100"
              >
                <span className="sr-only">Copy </span>
                <span className="font-sans font-medium text-slate-600 dark:text-slate-300">
                  Invite Code:
                </span>
                <span>{sampleCode}</span>
                <Icon name={copiedCode ? 'Check' : 'Copy'} className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="demo-theme-preset-select"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  Theme:
                </label>
                <select
                  id="demo-theme-preset-select"
                  data-testid="demo-theme-preset-select"
                  value={themePreset}
                  onChange={(e) => setThemePreset(e.target.value as ThemePreset)}
                  className="min-h-[32px] rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100"
                >
                  {THEME_PRESET_KEYS.map((preset) => (
                    <option key={preset} value={preset}>
                      {PRESET_LABELS[preset]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
