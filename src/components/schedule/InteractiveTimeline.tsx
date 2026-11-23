'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ContentNodeDTO } from '@/features/content';
import AddToCalendar from '@/components/AddToCalendar';
import EmptyState from '@/components/EmptyState';
import { formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import {
  MAX_RSVP_PLUS_ONE_COUNT,
  normalizeMealOptions,
  normalizeCustomQuestions,
} from '@/utils/rsvpPrompts';
import type {
  MealOptionDTO,
  CustomRsvpQuestionDTO,
} from '@/features/sub-events';
import { useScheduleRsvpManager } from '@/hooks/useScheduleRsvpManager';
import { ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Icon } from '@/components/ui/Icon';
import { useGuestHelp } from '@/components/guest/GuestHelpModal';
import { joinEventLocations, resolveDirectionsUrl } from '@/utils/maps';
import {
  DEFAULT_RSVP_CLOSED_MESSAGE,
  sanitizeRsvpClosedMessage,
} from '@/utils/rsvpDeadline';
import { withBasePath } from '@/lib/basePath';

interface CategoryColorStyle {
  bg?: string;
  text?: string;
  border?: string;
  accent?: string;
  color?: string;
}

interface ScheduleEventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  categoryTags: string[];
  categoryColors?: Record<string, CategoryColorStyle>;
  locationName?: string;
  location?: string;
  attireRules?: string;
  description?: string;
  isPrivate?: boolean;
  isReadOnly?: boolean;
  mealOptions?: MealOptionDTO[];
  customQuestions?: CustomRsvpQuestionDTO[];
  userRsvp?: {
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    dietaryNotes: string;
    mealSelections?: string[];
    customAnswers?: Record<string, string>;
    plusOneNames?: string[];
  } | null;
  createdAt?: Date;
}

export interface ScheduleRsvpStatusInfo {
  rsvpOpen: boolean;
  rsvpDeadlineDate: string | null;
  rsvpFormattedDeadline: string | null;
  timezone: string;
  rsvpClosedMessage: string;
}

interface InteractiveTimelineProps {
  events: ContentNodeDTO[];
  timezone?: string;
  title?: string;
  className?: string;
  maxPlusOnes?: number | null;
  emptyStateMessage?: string;
  rsvpOpen?: boolean;
  rsvpFormattedDeadline?: string | null;
  rsvpClosedMessage?: string;
  hideStatusBanner?: boolean;
  onRsvpStatusChange?: (_status: ScheduleRsvpStatusInfo) => void;
}

/**
 * Slugifies a category name for consistent HTML element IDs.
 */
function slugifyCategory(cat: string): string {
  return cat
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formats an ISO start and end timestamp pair into a user-friendly time slot display string.
 */
function formatTimeSlot(isoStart: string, isoEnd?: string, timeZone?: string): string {
  if (!isoStart) return '';
  try {
    const startDate = new Date(isoStart);
    if (isNaN(startDate.getTime())) return '';

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timeZone || 'UTC',
    });

    const startStr = timeFormatter.format(startDate);

    if (isoEnd) {
      const endDate = new Date(isoEnd);
      if (!isNaN(endDate.getTime())) {
        const endStr = timeFormatter.format(endDate);
        return `${startStr} – ${endStr}`;
      }
    }
    return startStr;
  } catch {
    return isoStart;
  }
}

/**
 * Formats an ISO start date into a readable date header string (e.g. "Saturday, June 20, 2026").
 */
function formatDateHeader(isoStart: string, timeZone?: string): string {
  if (!isoStart) return '';
  try {
    const date = new Date(isoStart);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timeZone || 'UTC',
    }).format(date);
  } catch {
    return '';
  }
}

/**
 * Normalizes content nodes into structured ScheduleEventItems.
 */
function normalizeEvents(nodes: ContentNodeDTO[]): ScheduleEventItem[] {
  return nodes
    .filter((node) => {
      const data = node.data as any;
      return (
        node.type === 'Schedule' ||
        (node.type === 'Logistics' && data?.startTime) ||
        data?.startTime
      );
    })
    .map((node) => {
      const data = node.data as any;
      const rawCategoryTags = Array.isArray(data?.categoryTags)
        ? data.categoryTags
        : data?.category
          ? [data.category]
          : ['General'];

      const categoryTags: string[] = [];
      const eventCategoryColors: Record<string, CategoryColorStyle> = {
        ...(data?.categoryColors || {}),
      };

      for (const item of rawCategoryTags) {
        if (typeof item === 'string') {
          if (item.trim()) categoryTags.push(item.trim());
        } else if (item && typeof item === 'object' && item.name) {
          const tagName = item.name.trim();
          if (tagName) {
            categoryTags.push(tagName);
            const { name: _name, ...colorAttrs } = item;
            eventCategoryColors[tagName] = {
              ...eventCategoryColors[tagName],
              ...colorAttrs,
            };
          }
        }
      }

      return {
        id: node.id,
        title: data?.title || data?.ceremonyTitle || data?.receptionTitle || 'Wedding Event',
        startTime: data?.startTime || '',
        endTime: data?.endTime || '',
        categoryTags: categoryTags.length > 0 ? categoryTags : ['General'],
        categoryColors: Object.keys(eventCategoryColors).length > 0 ? eventCategoryColors : undefined,
        locationName: data?.locationName || '',
        location: data?.location || '',
        attireRules: data?.attireRules || data?.attire || data?.receptionAttire || '',
        description: data?.description || data?.receptionDetails || '',
        isPrivate: Boolean(data?.isPrivate),
        isReadOnly: Boolean(data?.isReadOnly),
        mealOptions: normalizeMealOptions(data?.mealOptions),
        customQuestions: normalizeCustomQuestions(data?.customQuestions),
        userRsvp: data?.userRsvp !== undefined ? data.userRsvp : undefined,
        createdAt: node.createdAt,
      };
    })
    .sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
      return timeA - timeB;
    });
}

export default function InteractiveTimeline({
  events: initialNodes,
  timezone = 'UTC',
  title = 'Schedule of Events',
  className = '',
  maxPlusOnes,
  emptyStateMessage,
  rsvpOpen: rsvpOpenProp,
  rsvpFormattedDeadline: rsvpFormattedDeadlineProp,
  rsvpClosedMessage: rsvpClosedMessageProp,
  hideStatusBanner = false,
  onRsvpStatusChange,
}: InteractiveTimelineProps) {
  const [subEventsFromApi, setSubEventsFromApi] = useState<ScheduleEventItem[] | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestName, setGuestName] = useState<string | null>(null);
  const [apiMaxPlusOnes, setApiMaxPlusOnes] = useState<number | null | undefined>(undefined);
  const [apiSavedPlusOneNames, setApiSavedPlusOneNames] = useState<string[] | null>(null);
  const [apiRsvpOpen, setApiRsvpOpen] = useState<boolean | undefined>(undefined);
  const [apiDeadlineDate, setApiDeadlineDate] = useState<string | null | undefined>(undefined);
  const [apiFormattedDeadline, setApiFormattedDeadline] = useState<string | null | undefined>(
    undefined
  );
  const [apiTimezone, setApiTimezone] = useState<string | undefined>(undefined);
  const [apiClosedMessage, setApiClosedMessage] = useState<string | undefined>(undefined);
  const [hasResolvedRsvpStatus, setHasResolvedRsvpStatus] = useState<boolean>(
    () =>
      rsvpOpenProp !== undefined ||
      rsvpFormattedDeadlineProp !== undefined ||
      rsvpClosedMessageProp !== undefined
  );
  const [isLoadingSchedule, setIsLoadingSchedule] = useState<boolean>(
    () => initialNodes.length === 0 && Boolean(emptyStateMessage)
  );
  const [scheduleLoadError, setScheduleLoadError] = useState<string | null>(null);

  const guestHelp = useGuestHelp();
  const syncLiveHelpRef = useRef(guestHelp.syncLiveConfig);
  useEffect(() => {
    syncLiveHelpRef.current = guestHelp.syncLiveConfig;
  }, [guestHelp.syncLiveConfig]);

  const onRsvpStatusChangeRef = useRef(onRsvpStatusChange);
  useEffect(() => {
    onRsvpStatusChangeRef.current = onRsvpStatusChange;
  }, [onRsvpStatusChange]);

  const effectiveRsvpOpen =
    apiRsvpOpen !== undefined ? apiRsvpOpen : (rsvpOpenProp ?? true);
  const effectiveFormattedDeadline =
    apiFormattedDeadline !== undefined
      ? apiFormattedDeadline
      : (rsvpFormattedDeadlineProp ?? null);
  const effectiveTimezone = apiTimezone || timezone || 'UTC';
  const effectiveClosedMessage =
    sanitizeRsvpClosedMessage(apiClosedMessage ?? rsvpClosedMessageProp) ||
    DEFAULT_RSVP_CLOSED_MESSAGE;

  useEffect(() => {
    if (!hasResolvedRsvpStatus) return;
    onRsvpStatusChangeRef.current?.({
      rsvpOpen: effectiveRsvpOpen,
      rsvpDeadlineDate: apiDeadlineDate ?? null,
      rsvpFormattedDeadline: effectiveFormattedDeadline,
      timezone: effectiveTimezone,
      rsvpClosedMessage: effectiveClosedMessage,
    });
    syncLiveHelpRef.current?.({
      isRsvpOpen: effectiveRsvpOpen,
      rsvpOpen: effectiveRsvpOpen,
      rsvpDeadlineDate: apiDeadlineDate ?? '',
      rsvpClosedMessage: effectiveClosedMessage,
      timezone: effectiveTimezone,
    });
  }, [
    hasResolvedRsvpStatus,
    effectiveRsvpOpen,
    apiDeadlineDate,
    effectiveFormattedDeadline,
    effectiveTimezone,
    effectiveClosedMessage,
  ]);

  const effectiveMaxPlusOnes =
    apiMaxPlusOnes !== undefined
      ? apiMaxPlusOnes
      : typeof maxPlusOnes === 'number'
        ? Math.max(0, maxPlusOnes)
        : undefined;

  const initialEvents = useMemo(() => {
    return initialNodes.map((node) => {
      const data = node.data as any;
      return {
        id: node.id,
        title: data?.title || '',
        isReadOnly: Boolean(data?.isReadOnly),
        mealOptions: normalizeMealOptions(data?.mealOptions),
        customQuestions: normalizeCustomQuestions(data?.customQuestions),
        userRsvp: data?.userRsvp || null,
      };
    });
  }, [initialNodes]);

  const handleRsvpClosedMidSession = useCallback((closedMessage: string) => {
    setApiRsvpOpen(false);
    if (closedMessage) {
      setApiClosedMessage(closedMessage);
    }
    setHasResolvedRsvpStatus(true);
  }, []);

  const rsvpManager = useScheduleRsvpManager({
    initialEvents,
    maxPlusOnes: effectiveMaxPlusOnes,
    defaultPlusOneNames: apiSavedPlusOneNames,
    onRsvpClosed: handleRsvpClosedMidSession,
  });
  const { initializeEvents } = rsvpManager;

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAndApplySchedule = useCallback(async () => {
    try {
      const res = await fetch(withBasePath('/api/schedule'));
      if (!isMountedRef.current) return;
      if (!res) {
        setIsLoadingSchedule(false);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        if (!isMountedRef.current) return;
        const data = json.data || json;
        if (typeof json.plusOneAllocations === 'number') {
          setApiMaxPlusOnes(Math.max(0, json.plusOneAllocations));
        } else if (json.plusOneAllocations === null) {
          setApiMaxPlusOnes(null);
        }
        if (json.isGuest) {
          setIsGuest(true);
          setGuestName(json.guestName || null);
        }
        const rawSavedNames = Array.isArray(json.savedPlusOneNames)
          ? json.savedPlusOneNames
          : Array.isArray(json.plusOneNames)
            ? json.plusOneNames
            : null;
        const resolvedSavedNames = Array.isArray(rawSavedNames)
          ? rawSavedNames.filter(
            (n: unknown): n is string => typeof n === 'string' && n.trim().length > 0
          )
          : null;
        if (resolvedSavedNames !== null) {
          setApiSavedPlusOneNames(resolvedSavedNames);
        } else if (json.savedPlusOneNames === null || json.plusOneNames === null) {
          setApiSavedPlusOneNames(null);
        }
        if (typeof json.rsvpOpen === 'boolean') {
          setApiRsvpOpen(json.rsvpOpen);
          setHasResolvedRsvpStatus(true);
        }
        if ('rsvpDeadlineDate' in json) {
          setApiDeadlineDate(json.rsvpDeadlineDate ?? null);
        }
        if ('rsvpFormattedDeadline' in json) {
          setApiFormattedDeadline(json.rsvpFormattedDeadline ?? null);
          setHasResolvedRsvpStatus(true);
        }
        if (typeof json.timezone === 'string' && json.timezone.trim()) {
          setApiTimezone(json.timezone.trim());
        }
        if (typeof json.rsvpClosedMessage === 'string') {
          setApiClosedMessage(json.rsvpClosedMessage);
        }
        if (Array.isArray(data) && (data.length > 0 || initialNodes.length === 0)) {
          const mapped: ScheduleEventItem[] = data.map((item: any) => ({
            id: item.id,
            title: item.title,
            startTime: item.startTime || '',
            endTime: item.endTime || '',
            categoryTags: item.category ? [item.category] : ['Events'],
            locationName: item.locationName || '',
            location: item.location || '',
            attireRules: item.attireRules || '',
            description: item.description || '',
            isPrivate: Boolean(item.isPrivate),
            isReadOnly: Boolean(item.isReadOnly),
            mealOptions: normalizeMealOptions(item.mealOptions),
            customQuestions: normalizeCustomQuestions(item.customQuestions),
            userRsvp: item.userRsvp !== undefined ? item.userRsvp : null,
          }));
          setSubEventsFromApi(mapped);
          initializeEvents(mapped, resolvedSavedNames);
        }
        setScheduleLoadError(null);
      } else if (res.status >= 500 && initialNodes.length === 0 && emptyStateMessage) {
        const errJson = await res.json().catch(() => null);
        if (!isMountedRef.current) return;
        setScheduleLoadError(
          errJson?.error || 'Unable to load your wedding schedule right now. Please try again.'
        );
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      if (initialNodes.length === 0 && emptyStateMessage) {
        setScheduleLoadError(
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load your wedding schedule right now. Please try again.'
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingSchedule(false);
      }
    }
  }, [emptyStateMessage, initialNodes.length, initializeEvents]);

  const loadSchedule = useCallback(async () => {
    if (initialNodes.length === 0 && emptyStateMessage) {
      setIsLoadingSchedule(true);
      setScheduleLoadError(null);
    }
    await fetchAndApplySchedule();
  }, [emptyStateMessage, initialNodes.length, fetchAndApplySchedule]);

  useEffect(() => {
    let cancelled = false;
    const runInitialFetch = async () => {
      await Promise.resolve();
      if (!cancelled) {
        await fetchAndApplySchedule();
      }
    };
    void runInitialFetch();
    return () => {
      cancelled = true;
    };
  }, [fetchAndApplySchedule]);

  const normalizedEvents = useMemo(() => {
    if (subEventsFromApi && (subEventsFromApi.length > 0 || initialNodes.length === 0)) {
      return subEventsFromApi;
    }
    return normalizeEvents(initialNodes);
  }, [initialNodes, subEventsFromApi]);

  // Consolidate category color schemas across all events
  const globalCategoryColors = useMemo(() => {
    const map: Record<string, CategoryColorStyle> = {};
    normalizedEvents.forEach((ev) => {
      if (ev.categoryColors) {
        Object.entries(ev.categoryColors).forEach(([catName, colorStyle]) => {
          map[catName] = { ...map[catName], ...colorStyle };
          map[catName.toLowerCase()] = { ...map[catName.toLowerCase()], ...colorStyle };
        });
      }
    });
    return map;
  }, [normalizedEvents]);

  // Extract all unique categories across events
  const categories = useMemo(() => {
    const set = new Set<string>();
    normalizedEvents.forEach((ev) => {
      ev.categoryTags.forEach((tag) => {
        if (tag.trim()) set.add(tag.trim());
      });
    });
    return set.size > 1 ? ['All', ...Array.from(set)] : ['All'];
  }, [normalizedEvents]);

  const [activeCategory, setActiveCategory] = useState<string>('All');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeCategorySlug = useMemo(() => slugifyCategory(activeCategory), [activeCategory]);

  // Filter events based on active category
  const filteredEvents = useMemo(() => {
    if (activeCategory === 'All') return normalizedEvents;
    return normalizedEvents.filter((ev) =>
      ev.categoryTags.some((tag) => tag.toLowerCase() === activeCategory.toLowerCase())
    );
  }, [normalizedEvents, activeCategory]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (index + 1) % categories.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (index - 1 + categories.length) % categories.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = categories.length - 1;
    }

    if (nextIndex !== null) {
      setActiveCategory(categories[nextIndex]);
      tabRefs.current[nextIndex]?.focus();
    }
  };


  if (normalizedEvents.length === 0) {
    if (!emptyStateMessage) {
      return null;
    }
    return (
      <section className={`mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 ${className}`} id="schedule-timeline">
        <h2 className="text-center type-h2 text-[var(--color-primary-text)] mb-6">{title}</h2>
        {isLoadingSchedule ? (
          <p className="text-center text-sm text-gray-600 dark:text-zinc-300" role="status">
            Loading your wedding schedule...
          </p>
        ) : scheduleLoadError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <span>{scheduleLoadError}</span>
            <button
              type="button"
              onClick={() => loadSchedule()}
              className="px-4 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-semibold hover:bg-rose-800 transition-colors self-start sm:self-auto"
            >
              Retry Schedule
            </button>
          </div>
        ) : (
          <EmptyState message={emptyStateMessage} />
        )}
      </section>
    );
  }

  const categoryLabelText = activeCategory.toLowerCase() === 'all' ? 'All categories' : activeCategory;

  return (
    <section className={`mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 ${className}`} id="schedule-timeline">
      <h2 className="text-center type-h2 text-[var(--color-primary-text)] mb-8">{title}</h2>

      {/* ARIA Live Status Region for Filter Updates */}
      {categories.length > 1 && (
        <div role="status" aria-live="polite" className="sr-only">
          {`Showing ${filteredEvents.length} event${filteredEvents.length === 1 ? '' : 's'} for ${categoryLabelText}`}
        </div>
      )}

      {/* Category Filter Tabs */}
      {categories.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2 mb-10" role="tablist" aria-label="Schedule category filters">
          {categories.map((cat, index) => {
            const isActive = activeCategory.toLowerCase() === cat.toLowerCase();
            const catSlug = slugifyCategory(cat);
            const catColor = globalCategoryColors[cat] || globalCategoryColors[cat.toLowerCase()];

            let tabStyle: React.CSSProperties;
            if (isActive) {
              const bg = catColor?.bg || catColor?.accent || catColor?.color || 'var(--schedule-filter-active-bg)';
              const text = catColor?.text || 'var(--schedule-filter-active-text)';
              tabStyle = {
                backgroundColor: bg,
                color: text,
                border: catColor?.border ? `1px solid ${catColor.border}` : '1px solid transparent',
              };
            } else {
              tabStyle = {
                backgroundColor: 'var(--schedule-filter-bg)',
                color: 'var(--schedule-filter-text)',
                border: '1px solid transparent',
              };
            }

            return (
              <button
                key={cat}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                id={`timeline-tab-${catSlug}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="timeline-events-panel"
                tabIndex={isActive ? 0 : -1}
                style={tabStyle}
                className="px-5 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary shadow-[var(--shadow-sm)] hover:opacity-90"
                onClick={() => setActiveCategory(cat)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* ARIA Live Region for RSVP Notifications */}
      {rsvpManager.liveMessage && (
        <div role="status" aria-live="polite" className="sr-only" data-testid="rsvp-live-status">
          {rsvpManager.liveMessage}
        </div>
      )}

      {/* Schedule RSVP Deadline or Closed Notice (when not hoisted by parent portal) */}
      {!hideStatusBanner && effectiveRsvpOpen && effectiveFormattedDeadline && (
        <div
          role="note"
          aria-label="RSVP deadline"
          data-testid="schedule-rsvp-deadline-banner"
          className="mb-8 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/30 px-5 py-4 text-sm text-amber-950 dark:text-amber-100"
        >
          <p className="font-medium">
            Please submit or update your RSVPs by{' '}
            <strong className="font-bold">{effectiveFormattedDeadline}</strong> (midnight in{' '}
            <span className="font-semibold">{effectiveTimezone}</span>).
          </p>
        </div>
      )}

      {!hideStatusBanner &&
        !effectiveRsvpOpen &&
        (isGuest || normalizedEvents.some((ev) => ev.userRsvp !== undefined)) && (
        <div
          role="status"
          data-testid="schedule-rsvp-closed-banner"
          className="mb-8 rounded-2xl border border-gray-300 dark:border-zinc-700 bg-gray-100/90 dark:bg-zinc-800/90 px-5 py-4 text-sm text-gray-800 dark:text-zinc-100"
        >
          <p className="font-semibold">{effectiveClosedMessage}</p>
        </div>
      )}

      {/* Batch Coordination Action Bar */}
      {effectiveRsvpOpen &&
        (rsvpManager.dirtyCount > 0 ||
          rsvpManager.isBatchSubmitting ||
          rsvpManager.batchError ||
          rsvpManager.batchSuccessMessage) && (
        <div
          role="region"
          aria-label="RSVP batch coordination"
          className="mb-8 p-4 rounded-xl border bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          data-testid="rsvp-batch-bar"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {rsvpManager.dirtyCount > 0 ? (
                <span className="text-sm font-semibold text-[var(--color-primary-text)]">
                  {rsvpManager.dirtyCount} {rsvpManager.dirtyCount === 1 ? 'event has' : 'events have'} unsaved changes
                </span>
              ) : (
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {rsvpManager.batchSuccessMessage || 'All RSVPs up to date'}
                </span>
              )}
            </div>
            {rsvpManager.batchError && (
              <span className="text-xs text-rose-600 dark:text-rose-400">
                {rsvpManager.batchError}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {rsvpManager.dirtyCount > 0 && (
              <button
                type="button"
                disabled={rsvpManager.isAnySubmitting}
                onClick={() => rsvpManager.submitBatch()}
                className="px-4 py-2 bg-primary text-white font-semibold text-xs rounded-lg shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
                data-testid="rsvp-save-all-button"
              >
                {rsvpManager.isBatchSubmitting ? 'Saving All...' : 'Save All modified events'}
              </button>
            )}
            {rsvpManager.batchError && (
              <button
                type="button"
                disabled={rsvpManager.isAnySubmitting}
                onClick={() => rsvpManager.submitBatch()}
                className="px-3 py-1.5 border border-rose-500 text-rose-600 dark:text-rose-400 font-semibold text-xs rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 disabled:opacity-50 transition-colors"
              >
                Retry Batch
              </button>
            )}
          </div>
        </div>
      )}

      {/* Timeline Event Cards or EmptyState */}
      <div
        id="timeline-events-panel"
        role="tabpanel"
        aria-labelledby={`timeline-tab-${activeCategorySlug}`}
        tabIndex={0}
      >
        {filteredEvents.length === 0 ? (
          <EmptyState
            message={`No schedule events found for "${activeCategory}".`}
            onAction={() => setActiveCategory('All')}
            actionLabel="Clear filter"
          />
        ) : (
          <div className="relative border-l-2 border-primary/30 ml-4 sm:ml-8 pl-6 sm:pl-10 space-y-10">
            {filteredEvents.map((event) => {
              const calendarEvent = formatScheduleEventToCalendarEvent(
                {
                  id: event.id,
                  title: event.title,
                  startTime: event.startTime,
                  endTime: event.endTime,
                  locationName: event.locationName,
                  location: event.location,
                  attireRules: event.attireRules,
                  description: event.description,
                },
                undefined,
                timezone
              );

              const fullEventLocation = joinEventLocations(event.locationName, event.location);
              const eventDirectionsUrl = fullEventLocation
                ? resolveDirectionsUrl({ directions: fullEventLocation })
                : undefined;

              const timeSlotStr = formatTimeSlot(event.startTime, event.endTime, effectiveTimezone);
              const dateHeaderStr = formatDateHeader(event.startTime, effectiveTimezone);

              return (
                <div key={event.id} className="relative group">
                  {/* Timeline Visual Time-Slot Node/Badge */}
                  <div
                    className="absolute -left-[31px] sm:-left-[47px] top-1.5 h-5 w-5 rounded-full border-4 shadow"
                    style={{
                      backgroundColor: 'var(--schedule-node-bg)',
                      borderColor: 'var(--schedule-node-border)',
                    }}
                    aria-hidden="true"
                  />

                  <div
                    className="p-6 shadow-[var(--shadow-md)] transition-shadow hover:shadow-[var(--shadow-lg)] border"
                    style={{
                      backgroundColor: 'var(--schedule-card-bg)',
                      borderColor: 'var(--schedule-card-border)',
                      borderRadius: 'var(--schedule-card-radius)',
                      boxShadow: 'var(--shadow-md)',
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                      <div>
                        {dateHeaderStr && (
                          <p className="text-xs uppercase tracking-wider font-semibold text-[var(--color-primary-text)] dark:text-red-300 mb-1">
                            {dateHeaderStr}
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <h3 className="text-2xl font-bold">{event.title}</h3>
                          {event.isPrivate && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                              🔒 Private Event
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Time-Slot Indicator */}
                      {timeSlotStr && (
                        <span
                          className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold"
                          style={{
                            backgroundColor: 'var(--schedule-tag-bg)',
                            color: 'var(--schedule-tag-text)',
                          }}
                        >
                          <time dateTime={event.startTime}>{timeSlotStr}</time>
                        </span>
                      )}
                    </div>

                    {/* Category Tags */}
                    {event.categoryTags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {event.categoryTags.map((tag) => {
                          const tagColor = event.categoryColors?.[tag] || globalCategoryColors[tag] || globalCategoryColors[tag.toLowerCase()];
                          const tagBg = tagColor?.bg || tagColor?.accent || tagColor?.color || 'var(--schedule-tag-bg)';
                          const tagText = tagColor?.text || 'var(--schedule-tag-text)';
                          const tagBorder = tagColor?.border ? `1px solid ${tagColor.border}` : undefined;

                          return (
                            <span
                              key={tag}
                              className="inline-block px-2.5 py-0.5 text-xs font-medium rounded border border-transparent"
                              style={{
                                backgroundColor: tagBg,
                                color: tagText,
                                border: tagBorder,
                              }}
                            >
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Event Details */}
                    <div className="space-y-2 text-sm opacity-90 mb-6">
                      {fullEventLocation && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">Location:</span>
                            <span>{fullEventLocation}</span>
                          </div>
                          {eventDirectionsUrl && (
                            <AccessibleExternalLink
                              href={eventDirectionsUrl}
                              srContext={`to ${fullEventLocation}`}
                              className="inline-flex items-center gap-1.5 min-h-11 min-w-11 px-2.5 py-1 rounded-md font-semibold text-[var(--color-primary-text)] dark:text-red-300 underline underline-offset-2 hover:opacity-80 transition-opacity"
                            >
                              <Icon name="MapPin" size={16} />
                              <span>Get Directions</span>
                            </AccessibleExternalLink>
                          )}
                        </div>
                      )}

                      {event.attireRules && (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Attire:</span>
                          <span>{event.attireRules}</span>
                        </div>
                      )}

                      {event.description && <p className="pt-2 opacity-80">{event.description}</p>}
                    </div>

                    {/* Interactive RSVP Form or Read-Only Saved Summary for Authenticated Guests */}
                    {!event.isReadOnly && (isGuest || event.userRsvp !== undefined) && (() => {
                      const itemState = rsvpManager.getRsvpState(event.id);
                      const eventMealOptions = event.mealOptions ?? [];
                      const eventCustomQuestions = event.customQuestions ?? [];

                      if (!effectiveRsvpOpen) {
                        const savedRsvp = itemState.baseline;
                        const statusLabel =
                          savedRsvp.status === 'attending'
                            ? 'Attending'
                            : savedRsvp.status === 'declined'
                              ? 'Declined'
                              : 'Pending';
                        const statusBadgeClass =
                          savedRsvp.status === 'attending'
                            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                            : savedRsvp.status === 'declined'
                              ? 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200 border-rose-300 dark:border-rose-700'
                              : 'bg-gray-200 text-gray-800 dark:bg-zinc-700 dark:text-zinc-200 border-gray-300 dark:border-zinc-600';
                        const savedPlusOnes =
                          savedRsvp.status === 'declined' ? 0 : savedRsvp.plusOneCount;
                        const savedPlusOneNames =
                          savedRsvp.status === 'declined'
                            ? []
                            : savedRsvp.plusOneNames.filter((n) => n.trim().length > 0);
                        const mealMap = new Map(eventMealOptions.map((m) => [m.id, m]));
                        const savedMealsSummary =
                          savedRsvp.status === 'attending' && eventMealOptions.length > 0
                            ? savedRsvp.mealSelections
                              .map((optId, idx) => {
                                if (!optId) return null;
                                const opt = mealMap.get(optId);
                                const who =
                                  idx === 0
                                    ? guestName || 'Primary Guest'
                                    : savedPlusOneNames[idx - 1] || `Plus-One #${idx}`;
                                return `${who}: ${opt?.label || optId}`;
                              })
                              .filter(Boolean)
                              .join('; ')
                            : '';
                        const savedAnswersSummary =
                          savedRsvp.status === 'attending' && eventCustomQuestions.length > 0
                            ? eventCustomQuestions
                              .map((q) => {
                                const ans = savedRsvp.customAnswers[q.id];
                                return ans ? `${q.prompt}: ${ans}` : null;
                              })
                              .filter(Boolean)
                              .join('; ')
                            : '';

                        return (
                          <div
                            className="mb-6 p-4 rounded-xl border bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white"
                            data-testid={`rsvp-readonly-${event.id}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <span className="font-bold text-sm">
                                Your Saved RSVP for {event.title}
                              </span>
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-200">
                                RSVPs Closed
                              </span>
                            </div>
                            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                              <div>
                                <dt className="font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                  Attendance Status
                                </dt>
                                <dd>
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-md font-semibold border ${statusBadgeClass}`}
                                  >
                                    {statusLabel}
                                  </span>
                                </dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                  Plus-One Guests
                                </dt>
                                <dd className="font-medium text-gray-900 dark:text-zinc-100">
                                  {savedPlusOnes}
                                  {savedPlusOneNames.length > 0 && ` (${savedPlusOneNames.join(', ')})`}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                  Dietary Notes
                                </dt>
                                <dd className="font-medium text-gray-900 dark:text-zinc-100">
                                  {savedRsvp.dietaryNotes ? savedRsvp.dietaryNotes : 'None noted'}
                                </dd>
                              </div>
                              {savedMealsSummary && (
                                <div className="sm:col-span-3">
                                  <dt className="font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                    Entrée Selections
                                  </dt>
                                  <dd className="font-medium text-gray-900 dark:text-zinc-100">
                                    {savedMealsSummary}
                                  </dd>
                                </div>
                              )}
                              {savedAnswersSummary && (
                                <div className="sm:col-span-3">
                                  <dt className="font-semibold text-gray-600 dark:text-gray-400 mb-1">
                                    Additional Responses
                                  </dt>
                                  <dd className="font-medium text-gray-900 dark:text-zinc-100">
                                    {savedAnswersSummary}
                                  </dd>
                                </div>
                              )}
                            </dl>
                          </div>
                        );
                      }

                      const isControlDisabled = rsvpManager.isAnySubmitting || itemState.isSubmitting;
                      const isZeroPlusOneAllowance = effectiveMaxPlusOnes === 0;
                      const isDeclined = itemState.current.status === 'declined';
                      const isAttending = itemState.current.status === 'attending';
                      const isPlusOneDisabled =
                        isControlDisabled || isZeroPlusOneAllowance || isDeclined;
                      const plusOneMaxAttr =
                        typeof effectiveMaxPlusOnes === 'number'
                          ? Math.min(MAX_RSVP_PLUS_ONE_COUNT, Math.max(0, effectiveMaxPlusOnes))
                          : MAX_RSVP_PLUS_ONE_COUNT;
                      const attendingPlusOneCount =
                        isZeroPlusOneAllowance || !isAttending ? 0 : itemState.current.plusOneCount;
                      const attendingPartySize = isAttending ? 1 + attendingPlusOneCount : 0;

                      return (
                        <div
                          className={`mb-6 p-4 rounded-xl border text-gray-900 dark:text-white transition-all ${
                            itemState.state === 'error'
                              ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
                              : itemState.isDirty
                                ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 ring-1 ring-amber-300 dark:ring-amber-700'
                                : 'bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700'
                          }`}
                          data-testid={`rsvp-card-${event.id}`}
                        >
                          <div className="font-bold text-sm mb-2 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span id={`rsvp-heading-${event.id}`}>Your RSVP for {event.title}</span>
                              {itemState.isDirty && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                                  Unsaved changes
                                </span>
                              )}
                            </div>
                            {guestName && (
                              <span className="text-xs text-gray-600 dark:text-gray-300 font-normal">
                                Welcome, {guestName}
                              </span>
                            )}
                          </div>

                          <ToggleButtonGroup
                            mode="radiogroup"
                            aria-labelledby={`rsvp-heading-${event.id}`}
                            value={itemState.current.status}
                            onChange={(st) => rsvpManager.updateRsvp(event.id, { status: st })}
                            className="flex flex-wrap gap-2 mb-3 bg-transparent dark:bg-transparent p-0 border-0 rounded-none"
                            options={(['attending', 'declined', 'pending'] as const).map((st) => ({
                              value: st,
                              label: st,
                              disabled: isControlDisabled,
                              className: 'px-3 py-1.5 rounded-lg text-xs font-semibold capitalize',
                              activeClassName:
                                st === 'attending'
                                  ? 'bg-emerald-700 text-white border border-emerald-900 ring-2 ring-offset-1 ring-emerald-700 dark:ring-emerald-400 shadow-sm'
                                  : st === 'declined'
                                    ? 'bg-rose-700 text-white border border-rose-900 ring-2 ring-offset-1 ring-rose-700 dark:ring-rose-400 shadow-sm'
                                    : 'bg-amber-700 text-white border border-amber-900 ring-2 ring-offset-1 ring-amber-700 dark:ring-amber-400 shadow-sm',
                              inactiveClassName:
                                'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-100',
                            }))}
                          />

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label
                                htmlFor={`rsvp-plus-one-${event.id}`}
                                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                              >
                                Plus-One Count
                                {typeof effectiveMaxPlusOnes === 'number' && (
                                  <span className="ml-1 font-normal text-gray-600 dark:text-gray-400">
                                    {effectiveMaxPlusOnes === 0
                                      ? '(No plus-ones allocated)'
                                      : `(Max ${effectiveMaxPlusOnes})`}
                                  </span>
                                )}
                              </label>
                              <input
                                id={`rsvp-plus-one-${event.id}`}
                                type="number"
                                min={0}
                                max={plusOneMaxAttr}
                                disabled={isPlusOneDisabled}
                                value={
                                  isZeroPlusOneAllowance || isDeclined
                                    ? 0
                                    : itemState.current.plusOneCount
                                }
                                onChange={(e) => {
                                  if (isZeroPlusOneAllowance || isDeclined) return;
                                  rsvpManager.updateRsvp(event.id, {
                                    plusOneCount: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  });
                                }}
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor={`rsvp-dietary-notes-${event.id}`}
                                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
                              >
                                Dietary Requirements / Notes
                              </label>
                              <input
                                id={`rsvp-dietary-notes-${event.id}`}
                                type="text"
                                placeholder="e.g. Vegetarian, Nut allergy"
                                disabled={isControlDisabled}
                                value={itemState.current.dietaryNotes}
                                onChange={(e) =>
                                  rsvpManager.updateRsvp(event.id, {
                                    dietaryNotes: e.target.value,
                                  })
                                }
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                              />
                            </div>
                          </div>

                          {/* Conditional Plus-One Name Inputs for Attending Guests */}
                          {isAttending && attendingPlusOneCount > 0 && (
                            <div
                              className="mb-3 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3"
                              data-testid={`rsvp-plus-one-names-${event.id}`}
                            >
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                Plus-One Guest {attendingPlusOneCount === 1 ? 'Name' : 'Names'}
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {Array.from({ length: attendingPlusOneCount }, (_, idx) => {
                                  const nameInputId = `rsvp-plus-one-name-${event.id}-${idx}`;
                                  return (
                                    <div key={nameInputId}>
                                      <label
                                        htmlFor={nameInputId}
                                        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                                      >
                                        {attendingPlusOneCount === 1
                                          ? 'Plus-One Full Name'
                                          : `Plus-One #${idx + 1} Full Name`}
                                      </label>
                                      <input
                                        id={nameInputId}
                                        type="text"
                                        placeholder="e.g. Jordan Taylor"
                                        disabled={isControlDisabled}
                                        value={itemState.current.plusOneNames[idx] ?? ''}
                                        onChange={(e) => {
                                          const nextNames = Array.from(
                                            { length: attendingPlusOneCount },
                                            (__, nIdx) =>
                                              nIdx === idx
                                                ? e.target.value
                                                : (itemState.current.plusOneNames[nIdx] ?? '')
                                          );
                                          rsvpManager.updateRsvp(event.id, {
                                            plusOneNames: nextNames,
                                          });
                                        }}
                                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Conditional Per-Attendee Meal Selectors for Attending Guests */}
                          {isAttending && eventMealOptions.length > 0 && (
                            <div
                              className="mb-3 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3"
                              data-testid={`rsvp-meals-${event.id}`}
                            >
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                Entrée Selections *
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {Array.from({ length: attendingPartySize }, (_, attendeeIdx) => {
                                  const selectId = `rsvp-meal-${event.id}-${attendeeIdx}`;
                                  const attendeeLabel =
                                    attendeeIdx === 0
                                      ? guestName || 'Primary Guest'
                                      : (itemState.current.plusOneNames[attendeeIdx - 1] ?? '').trim() ||
                                        `Plus-One #${attendeeIdx}`;
                                  const selectedMealId =
                                    itemState.current.mealSelections[attendeeIdx] ?? '';
                                  const selectedMealObj = eventMealOptions.find(
                                    (m) => m.id === selectedMealId
                                  );

                                  return (
                                    <div key={selectId}>
                                      <label
                                        htmlFor={selectId}
                                        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                                      >
                                        {`Entrée for ${attendeeLabel} *`}
                                      </label>
                                      <select
                                        id={selectId}
                                        required
                                        disabled={isControlDisabled}
                                        value={selectedMealId}
                                        onChange={(e) => {
                                          const nextMeals = Array.from(
                                            { length: attendingPartySize },
                                            (__, mIdx) =>
                                              mIdx === attendeeIdx
                                                ? e.target.value
                                                : (itemState.current.mealSelections[mIdx] ?? '')
                                          );
                                          rsvpManager.updateRsvp(event.id, {
                                            mealSelections: nextMeals,
                                          });
                                        }}
                                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                                      >
                                        <option value="">Select an entrée...</option>
                                        {selectedMealId && !selectedMealObj && (
                                          <option value={selectedMealId}>
                                            {`${selectedMealId} (Unavailable — previously selected)`}
                                          </option>
                                        )}
                                        {eventMealOptions.map((opt) => (
                                          <option key={opt.id} value={opt.id}>
                                            {opt.dietaryTags.length > 0
                                              ? `${opt.label} (${opt.dietaryTags.join(', ')})`
                                              : opt.label}
                                          </option>
                                        ))}
                                      </select>
                                      {selectedMealObj?.description && (
                                        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                          {selectedMealObj.description}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Conditional Custom RSVP Prompts for Attending Guests */}
                          {isAttending && eventCustomQuestions.length > 0 && (
                            <div
                              className="mb-3 space-y-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-3"
                              data-testid={`rsvp-questions-${event.id}`}
                            >
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                Additional RSVP Questions
                              </p>
                              <div className="space-y-2.5">
                                {eventCustomQuestions.map((question) => {
                                  const qControlId = `rsvp-question-${event.id}-${question.id}`;
                                  const currentAnswer =
                                    itemState.current.customAnswers[question.id] ?? '';

                                  return (
                                    <div key={question.id}>
                                      <label
                                        htmlFor={qControlId}
                                        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                                      >
                                        {question.prompt}
                                        {question.required ? ' *' : ''}
                                      </label>
                                      {question.type === 'choice' ? (
                                        <select
                                          id={qControlId}
                                          required={question.required}
                                          disabled={isControlDisabled}
                                          value={currentAnswer}
                                          onChange={(e) =>
                                            rsvpManager.updateRsvp(event.id, {
                                              customAnswers: {
                                                ...itemState.current.customAnswers,
                                                [question.id]: e.target.value,
                                              },
                                            })
                                          }
                                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                                        >
                                          <option value="">Select an option...</option>
                                          {currentAnswer && !question.options.includes(currentAnswer) && (
                                            <option value={currentAnswer}>
                                              {`${currentAnswer} (Unavailable — previously selected)`}
                                            </option>
                                          )}
                                          {question.options.map((choice) => (
                                            <option key={choice} value={choice}>
                                              {choice}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          id={qControlId}
                                          type="text"
                                          required={question.required}
                                          disabled={isControlDisabled}
                                          value={currentAnswer}
                                          onChange={(e) =>
                                            rsvpManager.updateRsvp(event.id, {
                                              customAnswers: {
                                                ...itemState.current.customAnswers,
                                                [question.id]: e.target.value,
                                              },
                                            })
                                          }
                                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <div className="flex justify-between items-center">
                            <button
                              type="button"
                              disabled={isControlDisabled}
                              onClick={() => rsvpManager.submitSingle(event.id)}
                              className="px-4 py-1.5 bg-primary text-white font-semibold text-xs rounded-lg shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                              {itemState.isSubmitting ? 'Submitting...' : 'Save RSVP'}
                            </button>

                            {itemState.message && !itemState.error && (
                              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                {itemState.message}
                              </span>
                            )}
                          </div>

                          {itemState.error && (
                            <div
                              role="alert"
                              className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between"
                            >
                              <span>{itemState.error}</span>
                              <button
                                type="button"
                                disabled={isControlDisabled}
                                onClick={() => rsvpManager.submitSingle(event.id)}
                                className="underline font-medium hover:text-rose-700 ml-2"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}


                    {/* Per-Event Calendar Export Dropdown */}
                    <div
                      className="pt-2 border-t"
                      style={{
                        borderColor: 'var(--schedule-card-border)',
                      }}
                    >
                      <AddToCalendar
                        event={calendarEvent}
                        eventId={event.id}
                        downloadUrl={`/api/schedule/${event.id}/ics`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
