'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/utils/cn';
import { withBasePath } from '@/lib/basePath';

export const ONBOARDING_CHECKLIST_COLLAPSED_KEY = 'admin_onboarding_checklist_collapsed';

const emptySubscribe = () => () => {};
const getHydratedClientSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

export interface OnboardingMilestone {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  href: string;
  actionLabel: string;
}

interface OnboardingChecklistProps {
  refreshTrigger?: number;
}

function readPersistedCollapsedState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ONBOARDING_CHECKLIST_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writePersistedCollapsedState(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDING_CHECKLIST_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage write errors in restricted contexts
  }
}

export function OnboardingChecklist({ refreshTrigger }: OnboardingChecklistProps) {
  const router = useRouter();
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    getHydratedClientSnapshot,
    getHydratedServerSnapshot
  );
  const [milestones, setMilestones] = useState<OnboardingMilestone[] | null>(null);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);

  const isCollapsed =
    collapsedOverride ?? (isHydrated ? readPersistedCollapsedState() : false);

  useEffect(() => {
    let cancelled = false;

    const loadMilestones = async () => {
      try {
        const res = await fetch(withBasePath('/api/admin/onboarding-milestones'));
        if (!res || !res.ok || typeof res.json !== 'function' || cancelled) return;
        const raw = await res.json();
        if (cancelled) return;
        const payload =
          raw && typeof raw === 'object' && 'data' in raw && raw.data ? raw.data : raw;

        if (payload && Array.isArray(payload.milestones)) {
          setMilestones(payload.milestones);
        }
      } catch {
        // Gracefully ignore network or mock errors so dashboard remains usable
      }
    };

    void loadMilestones();

    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  const handleToggleCollapse = () => {
    const next = !isCollapsed;
    writePersistedCollapsedState(next);
    setCollapsedOverride(next);
  };

  if (!milestones || milestones.length === 0) {
    return null;
  }

  const totalCount = milestones.length;
  const completedCount = milestones.filter((m) => m.completed).length;
  const pendingCount = totalCount - completedCount;
  const allComplete = totalCount > 0 && completedCount === totalCount;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section
      aria-labelledby="onboarding-checklist-heading"
      data-testid="onboarding-checklist"
      className="mb-8 rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            id="onboarding-checklist-heading"
            className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100"
          >
            Setup Checklist
          </h2>
          {allComplete && (
            <span
              data-testid="onboarding-all-complete-badge"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-700"
            >
              <Icon name="Check" size={14} />
              All Milestones Complete
            </span>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={!isCollapsed}
          aria-controls={!isCollapsed ? 'onboarding-checklist-items' : undefined}
          onClick={handleToggleCollapse}
          className="self-start sm:self-auto shrink-0"
        >
          <span>{isCollapsed ? 'Expand Checklist' : 'Collapse Checklist'}</span>
          <Icon
            name="ChevronDown"
            size={16}
            className={cn('ml-1.5 transition-transform duration-200', !isCollapsed && 'rotate-180')}
          />
        </Button>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm mb-2">
          <span className="font-medium text-gray-700 dark:text-gray-200">
            {completedCount} of {totalCount} milestones completed ({pendingCount} pending)
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {progressPercent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Setup milestone completion progress"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuetext={`${completedCount} of ${totalCount} milestones completed, ${pendingCount} pending`}
          className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden"
        >
          <div
            className="bg-emerald-700 dark:bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {!isCollapsed && (
        <ul
          id="onboarding-checklist-items"
          data-testid="onboarding-checklist-items"
          className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              data-testid={`milestone-item-${milestone.id}`}
              className={cn(
                'flex flex-col justify-between gap-3 rounded-lg border p-4 transition-colors',
                milestone.completed
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                      milestone.completed
                        ? 'bg-emerald-700 text-white border-emerald-700 dark:bg-emerald-500 dark:text-gray-950 dark:border-emerald-500'
                        : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600'
                    )}
                  >
                    {milestone.completed ? <Icon name="Check" size={14} /> : '•'}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {milestone.title}
                    </h3>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      {milestone.description}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
                    milestone.completed
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-100 dark:border-emerald-700'
                      : 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/60 dark:text-amber-100 dark:border-amber-700'
                  )}
                >
                  {milestone.completed ? 'Complete' : 'Pending'}
                </span>
              </div>

              <div className="pt-1 flex justify-end">
                <Button
                  type="button"
                  variant={milestone.completed ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => router.push(milestone.href)}
                >
                  {milestone.actionLabel}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
