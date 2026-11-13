'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { ContentNodeDTO } from '@/features/content/schemas';
import AddToCalendar from '@/components/AddToCalendar';
import EmptyState from '@/components/EmptyState';
import { formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import { useScheduleRsvpManager } from '@/hooks/useScheduleRsvpManager';

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
  attireRules?: string;
  description?: string;
  isPrivate?: boolean;
  userRsvp?: {
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    dietaryNotes: string;
  } | null;
  createdAt?: Date;
}

interface InteractiveTimelineProps {
  events: ContentNodeDTO[];
  timezone?: string;
  title?: string;
  className?: string;
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
            const { name, ...colorAttrs } = item;
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
        locationName: data?.locationName || data?.location || '',
        attireRules: data?.attireRules || data?.attire || data?.receptionAttire || '',
        description: data?.description || data?.receptionDetails || '',
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
}: InteractiveTimelineProps) {
  const [subEventsFromApi, setSubEventsFromApi] = useState<ScheduleEventItem[] | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestName, setGuestName] = useState<string | null>(null);

  const initialEvents = useMemo(() => {
    return initialNodes.map((node) => {
      const data = node.data as any;
      return {
        id: node.id,
        title: data?.title || '',
        userRsvp: data?.userRsvp || null,
      };
    });
  }, [initialNodes]);

  const rsvpManager = useScheduleRsvpManager({
    initialEvents,
  });
  const { initializeEvents } = rsvpManager;

  useEffect(() => {
    async function loadSchedule() {
      try {
        const res = await fetch('/api/schedule');
        if (res.ok) {
          const json = await res.json();
          const data = json.data || json;
          if (Array.isArray(data) && data.length > 0) {
            const mapped = data.map((item: any) => ({
              id: item.id,
              title: item.title,
              startTime: item.startTime || '',
              endTime: item.endTime || '',
              categoryTags: item.category ? [item.category] : ['Events'],
              locationName: item.locationName || item.location || '',
              attireRules: item.attireRules || '',
              description: item.description || '',
              isPrivate: Boolean(item.isPrivate),
              userRsvp: item.userRsvp || null,
            }));
            setSubEventsFromApi(mapped);
            if (json.isGuest) {
              setIsGuest(true);
              setGuestName(json.guestName || null);
            }

            initializeEvents(mapped);
          }
        }
      } catch {
        // Fallback to initialNodes
      }
    }
    loadSchedule();
  }, [initializeEvents]);

  const normalizedEvents = useMemo(() => {
    if (subEventsFromApi && subEventsFromApi.length > 0) {
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
    return null;
  }

  const categoryLabelText = activeCategory.toLowerCase() === 'all' ? 'All categories' : activeCategory;

  return (
    <section className={`mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 ${className}`} id="schedule-timeline">
      <h2 className="text-center type-h2 text-primary mb-8">{title}</h2>

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

      {/* Batch Coordination Action Bar */}
      {(rsvpManager.dirtyCount > 0 || rsvpManager.isBatchSubmitting || rsvpManager.batchError || rsvpManager.batchSuccessMessage) && (
        <div
          role="region"
          aria-label="RSVP batch coordination"
          className="mb-8 p-4 rounded-xl border bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          data-testid="rsvp-batch-bar"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {rsvpManager.dirtyCount > 0 ? (
                <span className="text-sm font-semibold text-primary">
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
                  attireRules: event.attireRules,
                  description: event.description,
                },
                undefined,
                timezone
              );

              const timeSlotStr = formatTimeSlot(event.startTime, event.endTime, timezone);
              const dateHeaderStr = formatDateHeader(event.startTime, timezone);

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
                          <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-1">
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
                      {event.locationName && (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Location:</span>
                          <span>{event.locationName}</span>
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

                    {/* Interactive RSVP Form for Authenticated Guests */}
                    {(isGuest || event.userRsvp !== undefined) && (() => {
                      const itemState = rsvpManager.getRsvpState(event.id);
                      const isControlDisabled = rsvpManager.isAnySubmitting || itemState.isSubmitting;

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
                              <span>Your RSVP for {event.title}</span>
                              {itemState.isDirty && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
                                  Unsaved changes
                                </span>
                              )}
                            </div>
                            {guestName && <span className="text-xs text-gray-500 font-normal">Welcome, {guestName}</span>}
                          </div>

                          <div className="flex flex-wrap gap-2 mb-3">
                            {(['attending', 'declined', 'pending'] as const).map((st) => {
                              const isSelected = itemState.current.status === st;
                              return (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={isControlDisabled}
                                  onClick={() => rsvpManager.updateRsvp(event.id, { status: st })}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                                    isSelected
                                      ? st === 'attending'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : st === 'declined'
                                          ? 'bg-rose-600 text-white shadow-sm'
                                          : 'bg-amber-600 text-white shadow-sm'
                                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 disabled:opacity-50'
                                  }`}
                                >
                                  {st}
                                </button>
                              );
                            })}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                Plus-One Count
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={10}
                                disabled={isControlDisabled}
                                value={itemState.current.plusOneCount}
                                onChange={(e) =>
                                  rsvpManager.updateRsvp(event.id, {
                                    plusOneCount: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  })
                                }
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                Dietary Requirements / Notes
                              </label>
                              <input
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
                            <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between">
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
