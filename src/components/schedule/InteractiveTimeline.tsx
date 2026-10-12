'use client';

import { useState, useMemo } from 'react';
import type { ContentNodeDTO } from '@/features/content/schemas';
import AddToCalendar from '@/components/AddToCalendar';
import { formatScheduleEventToCalendarEvent } from '@/utils/calendar';

interface ScheduleEventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  categoryTags: string[];
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
      const categoryTags: string[] = Array.isArray(data?.categoryTags)
        ? data.categoryTags
        : data?.category
          ? [data.category]
          : ['General'];

      return {
        id: node.id,
        title: data?.title || data?.ceremonyTitle || data?.receptionTitle || 'Wedding Event',
        startTime: data?.startTime || '',
        endTime: data?.endTime || '',
        categoryTags: categoryTags.length > 0 ? categoryTags : ['General'],
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

  // Extract all unique categories across events
  const categories = useMemo(() => {
    const set = new Set<string>();
    normalizedEvents.forEach((ev) => {
      ev.categoryTags.forEach((tag) => {
        if (tag.trim()) set.add(tag.trim());
      });
    });
    return ['All', ...Array.from(set)];
  }, [normalizedEvents]);

  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Filter events based on active category
  const filteredEvents = useMemo(() => {
    if (activeCategory === 'All') return normalizedEvents;
    return normalizedEvents.filter((ev) =>
      ev.categoryTags.some((tag) => tag.toLowerCase() === activeCategory.toLowerCase())
    );
  }, [normalizedEvents, activeCategory]);

  if (normalizedEvents.length === 0) {
    return null;
  }

  return (
    <section className={`mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 ${className}`} id="schedule-timeline">
      <h2 className="text-center text-4xl font-bold text-primary mb-8">{title}</h2>

      {/* Category Filter Tabs */}
      {categories.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2 mb-10" role="tablist" aria-label="Schedule category filters">
          {categories.map((cat) => {
            const isActive = activeCategory.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  isActive
                    ? 'bg-primary text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Timeline Event Cards */}
      <div className="relative border-l-2 border-primary/30 dark:border-primary/40 ml-4 sm:ml-8 pl-6 sm:pl-10 space-y-10">
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
                className="absolute -left-[31px] sm:-left-[47px] top-1.5 h-5 w-5 rounded-full border-4 border-white dark:border-gray-900 bg-primary shadow"
                aria-hidden="true"
              />

              <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-md transition-shadow hover:shadow-lg">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                  <div>
                    {dateHeaderStr && (
                      <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-1">
                        {dateHeaderStr}
                      </p>
                    )}
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{event.title}</h3>
                  </div>

                  {/* Time-Slot Indicator */}
                  {timeSlotStr && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 dark:bg-primary/20 px-3 py-1 text-sm font-semibold text-primary">
                      <time dateTime={event.startTime}>{timeSlotStr}</time>
                    </span>
                  )}
                </div>

                {/* Category Tags */}
                {event.categoryTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {event.categoryTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block px-2.5 py-0.5 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Event Details */}
                <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 mb-6">
                  {event.locationName && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-200">Location:</span>
                      <span>{event.locationName}</span>
                    </div>
                  )}

                  {event.attireRules && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-200">Attire:</span>
                      <span>{event.attireRules}</span>
                    </div>
                  )}

                  {event.description && <p className="pt-2 text-gray-600 dark:text-gray-400">{event.description}</p>}
                </div>

                {/* Per-Event Calendar Export Dropdown */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-700/60">
                  <AddToCalendar event={calendarEvent} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
