'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { ContentNodeDTO } from '@/features/content/schemas';
import AddToCalendar from '@/components/AddToCalendar';
import EmptyState from '@/components/EmptyState';
import { formatScheduleEventToCalendarEvent } from '@/utils/calendar';

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
  const [rsvpState, setRsvpState] = useState<Record<string, { status: 'attending' | 'declined' | 'pending'; plusOneCount: number; dietaryNotes: string; isSubmitting?: boolean; message?: string }>>({});

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
              description: item.description || '',
              isPrivate: Boolean(item.isPrivate),
              userRsvp: item.userRsvp || null,
            }));
            setSubEventsFromApi(mapped);
            if (json.isGuest) {
              setIsGuest(true);
              setGuestName(json.guestName || null);
            }

            // Init RSVP state
            const initialRsvpMap: Record<string, any> = {};
            data.forEach((item: any) => {
              initialRsvpMap[item.id] = {
                status: item.userRsvp?.status || 'pending',
                plusOneCount: item.userRsvp?.plusOneCount ?? 0,
                dietaryNotes: item.userRsvp?.dietaryNotes || '',
              };
            });
            setRsvpState(initialRsvpMap);
          }
        }
      } catch {
        // Fallback to initialNodes
      }
    }
    loadSchedule();
  }, []);

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

  const handleRsvpSubmit = async (subEventId: string) => {
    const current = rsvpState[subEventId];
    if (!current) return;

    setRsvpState((prev) => ({
      ...prev,
      [subEventId]: { ...prev[subEventId], isSubmitting: true, message: undefined },
    }));

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subEventId,
          status: current.status,
          plusOneCount: current.plusOneCount,
          dietaryNotes: current.dietaryNotes,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to submit RSVP.');
      }

      setRsvpState((prev) => ({
        ...prev,
        [subEventId]: {
          ...prev[subEventId],
          isSubmitting: false,
          message: 'RSVP submitted successfully!',
        },
      }));
    } catch (err: any) {
      setRsvpState((prev) => ({
        ...prev,
        [subEventId]: {
          ...prev[subEventId],
          isSubmitting: false,
          message: err.message || 'Error submitting RSVP.',
        },
      }));
    }
  };

  if (normalizedEvents.length === 0) {
    return null;
  }

  const categoryLabelText = activeCategory.toLowerCase() === 'all' ? 'All categories' : activeCategory;

  return (
    <section className={`mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 ${className}`} id="schedule-timeline">
      <h2 className="text-center text-4xl font-bold text-primary mb-8">{title}</h2>

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
                    {(isGuest || event.userRsvp !== undefined) && (
                      <div className="mb-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white" data-testid={`rsvp-card-${event.id}`}>
                        <div className="font-bold text-sm mb-2 flex justify-between items-center">
                          <span>Your RSVP for {event.title}</span>
                          {guestName && <span className="text-xs text-gray-500 font-normal">Welcome, {guestName}</span>}
                        </div>

                        <div className="flex flex-wrap gap-2 mb-3">
                          {(['attending', 'declined', 'pending'] as const).map((st) => {
                            const isSelected = (rsvpState[event.id]?.status || 'pending') === st;
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() =>
                                  setRsvpState((prev) => ({
                                    ...prev,
                                    [event.id]: {
                                      ...(prev[event.id] || { plusOneCount: 0, dietaryNotes: '' }),
                                      status: st,
                                    },
                                  }))
                                }
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                                  isSelected
                                    ? st === 'attending'
                                      ? 'bg-emerald-600 text-white shadow-sm'
                                      : st === 'declined'
                                        ? 'bg-rose-600 text-white shadow-sm'
                                        : 'bg-amber-600 text-white shadow-sm'
                                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-100'
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
                              value={rsvpState[event.id]?.plusOneCount ?? 0}
                              onChange={(e) =>
                                setRsvpState((prev) => ({
                                  ...prev,
                                  [event.id]: {
                                    ...(prev[event.id] || { status: 'pending', dietaryNotes: '' }),
                                    plusOneCount: Math.max(0, parseInt(e.target.value, 10) || 0),
                                  },
                                }))
                              }
                              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              Dietary Requirements / Notes
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. Vegetarian, Nut allergy"
                              value={rsvpState[event.id]?.dietaryNotes ?? ''}
                              onChange={(e) =>
                                setRsvpState((prev) => ({
                                  ...prev,
                                  [event.id]: {
                                    ...(prev[event.id] || { status: 'pending', plusOneCount: 0 }),
                                    dietaryNotes: e.target.value,
                                  },
                                }))
                              }
                              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center">
                          <button
                            type="button"
                            disabled={rsvpState[event.id]?.isSubmitting}
                            onClick={() => handleRsvpSubmit(event.id)}
                            className="px-4 py-1.5 bg-primary text-white font-semibold text-xs rounded-lg shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            {rsvpState[event.id]?.isSubmitting ? 'Submitting...' : 'Save RSVP'}
                          </button>

                          {rsvpState[event.id]?.message && (
                            <span className={`text-xs font-medium ${rsvpState[event.id].message?.includes('Error') || rsvpState[event.id].message?.includes('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                              {rsvpState[event.id].message}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Per-Event Calendar Export Dropdown */}
                    <div
                      className="pt-2 border-t"
                      style={{
                        borderColor: 'var(--schedule-card-border)',
                      }}
                    >
                      <AddToCalendar event={calendarEvent} />
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
