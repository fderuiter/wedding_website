'use client';

import { useState, useMemo, useRef } from 'react';
import type { ContentNodeDTO } from '@/features/content';
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
  const normalizedEvents = useMemo(() => normalizeEvents(initialNodes), [initialNodes]);

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

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex: number | null = null;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        targetIndex = (index + 1) % categories.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        targetIndex = (index - 1 + categories.length) % categories.length;
        break;
      case 'Home':
        targetIndex = 0;
        break;
      case 'End':
        targetIndex = categories.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    const targetCat = categories[targetIndex];
    setActiveCategory(targetCat);
    tabRefs.current[targetIndex]?.focus();
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
                className="px-5 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary shadow-sm hover:opacity-90"
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
                    className="p-6 shadow-md transition-shadow hover:shadow-lg border"
                    style={{
                      backgroundColor: 'var(--schedule-card-bg)',
                      borderColor: 'var(--schedule-card-border)',
                      borderRadius: 'var(--schedule-card-radius)',
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                      <div>
                        {dateHeaderStr && (
                          <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-1">
                            {dateHeaderStr}
                          </p>
                        )}
                        <h3 className="text-2xl font-bold">{event.title}</h3>
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
