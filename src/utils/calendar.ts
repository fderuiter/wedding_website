import { createEvent, createEvents, EventAttributes } from 'ics';

/**
 * @interface CalendarEvent
 * @description Defines the structure for a calendar event object.
 * @property {string} name - The name of the event.
 * @property {string} startDate - The start date of the event in YYYY-MM-DD format.
 * @property {string} startTime - The start time of the event in HH:MM format.
 * @property {string} endDate - The end date of the event in YYYY-MM-DD format.
 * @property {string} endTime - The end time of the event in HH:MM format.
 * @property {string} timeZone - The time zone of the event.
 * @property {string} location - The location of the event.
 * @property {string} description - A description of the event.
 */
export interface CalendarEvent {
  id?: string
  name: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  timeZone: string
  location: string
  description: string
}

/**
 * Formats a date and time string into a tuple of numbers for the 'ics' library.
 * @param {string} date - The date string in 'YYYY-MM-DD' format.
 * @param {string} time - The time string in 'HH:MM' format.
 * @returns {[number, number, number, number, number]} A tuple representing [year, month, day, hours, minutes].
 */
function formatDateTuple(date: string, time: string): [number, number, number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return [year, month, day, hours, minutes];
}

/**
 * Formats date and time into YYYYMMDDTHHMMSS string for calendar URLs.
 * @param {string} date - The date string in 'YYYY-MM-DD' format.
 * @param {string} time - The time string in 'HH:MM' format.
 * @returns {string} The formatted date-time string.
 */
function formatDateTimeForUrl(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '')}00`;
}

/**
 * Helper function to build a calendar URL with query parameters.
 * @param {string} baseUrl - The base URL for the calendar service.
 * @param {Record<string, string>} params - A key-value map of query parameters.
 * @returns {string} The fully constructed URL.
 */
function buildCalendarUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

/**
 * Validates and normalizes an IANA timezone string, falling back to 'UTC'
 * when empty or rejected by Intl.DateTimeFormat.
 */
function resolveTimeZone(timeZone?: string): string {
  const candidate = timeZone?.trim();
  if (!candidate) {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * Extracts wall-clock date/time components for a UTC Date instant in a validated timezone.
 */
function getZonedDateTimeParts(date: Date, validTimeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = part.value;
    }
  }

  const rawHour = lookup.hour || '00';
  const normalizedHour = rawHour === '24' ? '00' : rawHour.padStart(2, '0');

  return {
    year: (lookup.year || '1970').padStart(4, '0'),
    month: (lookup.month || '01').padStart(2, '0'),
    day: (lookup.day || '01').padStart(2, '0'),
    hour: normalizedHour,
    minute: (lookup.minute || '00').padStart(2, '0'),
    second: (lookup.second || '00').padStart(2, '0'),
  };
}

/**
 * Formats a Date instance into localized YYYY-MM-DD and 24-hour HH:MM strings.
 */
function formatDateInTimeZone(date: Date, timeZone?: string): { date: string; time: string } {
  const validTimeZone = resolveTimeZone(timeZone);
  const parts = getZonedDateTimeParts(date, validTimeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Computes the UTC offset in minutes at a specific Date instant for a validated timezone.
 */
function getOffsetMinutesAtInstant(instant: Date, validTimeZone: string): number {
  const parts = getZonedDateTimeParts(instant, validTimeZone);
  const wallUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const instantSecondsMs = Math.trunc(instant.getTime() / 1000) * 1000;
  return Math.round((wallUtcMs - instantSecondsMs) / 60000);
}

/**
 * Resolves a local YYYY-MM-DD and HH:MM(:SS) wall-clock timestamp in timeZone
 * into its corresponding UTC Date instant and UTC offset in minutes.
 */
function resolveLocalDateTime(
  date: string,
  time: string,
  timeZone?: string
): { instant: Date; offsetMinutes: number } | null {
  const dateParts = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) {
    return null;
  }

  const [year, month, day] = dateParts;
  const [hour, minute, second = 0] = timeParts;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const targetWallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (isNaN(targetWallUtcMs)) {
    return null;
  }

  const validTimeZone = resolveTimeZone(timeZone);

  // Iteratively converge on the exact UTC instant across potential DST transitions
  const offset0 = getOffsetMinutesAtInstant(new Date(targetWallUtcMs), validTimeZone);
  const candidate1Ms = targetWallUtcMs - offset0 * 60000;
  const offset1 = getOffsetMinutesAtInstant(new Date(candidate1Ms), validTimeZone);
  const candidate2Ms = targetWallUtcMs - offset1 * 60000;
  const finalInstant = new Date(candidate2Ms);
  const finalOffsetMinutes = getOffsetMinutesAtInstant(finalInstant, validTimeZone);

  return {
    instant: finalInstant,
    offsetMinutes: finalOffsetMinutes,
  };
}

/**
 * Formats an offset in minutes into ISO (±HH:MM) or RFC 5545 (±HHMM) notation.
 */
function formatUtcOffsetMinutes(offsetMinutes: number, withColon: boolean): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const minutes = String(absMinutes % 60).padStart(2, '0');
  return withColon ? `${sign}${hours}:${minutes}` : `${sign}${hours}${minutes}`;
}

/**
 * Converts a structured schedule event node payload into a CalendarEvent interface.
 * Handles ISO timestamp parsing (e.g. 2026-06-20T15:00:00.000Z) or date/time parameters.
 */
export function formatScheduleEventToCalendarEvent(
  scheduleItem: {
    id?: string;
    title?: string;
    ceremonyTitle?: string;
    receptionTitle?: string;
    startTime?: string;
    endTime?: string;
    locationName?: string;
    location?: string;
    attireRules?: string;
    attire?: string;
    description?: string;
  },
  defaultDateStr?: string,
  timeZone: string = 'UTC'
): CalendarEvent {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const name = scheduleItem.title || scheduleItem.ceremonyTitle || scheduleItem.receptionTitle || 'Wedding Event';
  const location = scheduleItem.locationName || scheduleItem.location || '';
  const attire = scheduleItem.attireRules || scheduleItem.attire || '';
  const rawDesc = scheduleItem.description || '';
  const description = attire ? `${rawDesc}${rawDesc ? ' | ' : ''}Attire: ${attire}` : rawDesc;

  let startDate = defaultDateStr || '2026-06-20';
  let startTime = '12:00';
  let endDate = defaultDateStr || '2026-06-20';
  let endTime = '13:00';

  if (scheduleItem.startTime) {
    const startDateObj = new Date(scheduleItem.startTime);
    if (!isNaN(startDateObj.getTime())) {
      const formattedStart = formatDateInTimeZone(startDateObj, resolvedTimeZone);
      startDate = formattedStart.date;
      startTime = formattedStart.time;
    }
  }

  if (scheduleItem.endTime) {
    const endDateObj = new Date(scheduleItem.endTime);
    if (!isNaN(endDateObj.getTime())) {
      const formattedEnd = formatDateInTimeZone(endDateObj, resolvedTimeZone);
      endDate = formattedEnd.date;
      endTime = formattedEnd.time;
    }
  } else if (scheduleItem.startTime) {
    const startDateObj = new Date(scheduleItem.startTime);
    if (!isNaN(startDateObj.getTime())) {
      const defaultEnd = new Date(startDateObj.getTime() + 60 * 60 * 1000);
      const formattedEnd = formatDateInTimeZone(defaultEnd, resolvedTimeZone);
      endDate = formattedEnd.date;
      endTime = formattedEnd.time;
    }
  }

  return {
    id: scheduleItem.id,
    name,
    startDate,
    startTime,
    endDate,
    endTime,
    timeZone: resolvedTimeZone,
    location,
    description,
  };
}

/**
 * Creates a URL to add an event to Google Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Google Calendar URL.
 */
export function createGoogleCalendarLink(event: CalendarEvent): string {
  const start = formatDateTimeForUrl(event.startDate, event.startTime);
  const end = formatDateTimeForUrl(event.endDate, event.endTime);

  return buildCalendarUrl('https://calendar.google.com/calendar/render', {
    action: 'TEMPLATE',
    text: event.name,
    dates: `${start}/${end}`,
    ctz: event.timeZone,
    details: event.description,
    location: event.location,
  });
}

/**
 * Creates a URL to add an event to Yahoo Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Yahoo Calendar URL.
 */
export function createYahooCalendarLink(event: CalendarEvent): string {
  const formatYahooUtcTimestamp = (date: string, time: string): string => {
    const resolved = resolveLocalDateTime(date, time, event.timeZone);
    if (!resolved) {
      return `${formatDateTimeForUrl(date, time)}Z`;
    }
    return resolved.instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  };

  const start = formatYahooUtcTimestamp(event.startDate, event.startTime);
  const end = formatYahooUtcTimestamp(event.endDate, event.endTime);

  return buildCalendarUrl('https://calendar.yahoo.com/', {
    v: '60',
    view: 'd',
    type: '20',
    title: event.name,
    st: start,
    et: end,
    desc: event.description,
    in_loc: event.location,
  });
}

/**
 * Creates a URL to add an event to Outlook.com Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Outlook.com Calendar URL.
 */
export function createOutlookCalendarLink(event: CalendarEvent): string {
  const formatIsoDateTime = (date: string, time: string) => {
    const resolved = resolveLocalDateTime(date, time, event.timeZone);
    const offset = formatUtcOffsetMinutes(resolved ? resolved.offsetMinutes : 0, true);
    return `${date}T${time}${time.length === 5 ? ':00' : ''}${offset}`;
  };

  const start = formatIsoDateTime(event.startDate, event.startTime);
  const end = formatIsoDateTime(event.endDate, event.endTime);

  return buildCalendarUrl('https://outlook.live.com/calendar/0/deeplink/compose', {
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.name,
    startdt: start,
    enddt: end,
    body: event.description,
    location: event.location,
  });
}

/**
 * Calculates the formatted UTC offset (+HHMM or -HHMM) for a given timezone ID using Intl API,
 * anchored to the provided event date/time rather than the current system clock.
 * Falls back to +0000 if timezone is invalid or unrecognized.
 */
function getUtcOffset(
  timeZone: string,
  referenceDate?: string | Date,
  referenceTime: string = '12:00'
): string {
  const trimmedTz = timeZone?.trim();
  if (!trimmedTz) {
    return '+0000';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmedTz });
  } catch {
    return '+0000';
  }

  if (referenceDate instanceof Date) {
    if (!isNaN(referenceDate.getTime())) {
      return formatUtcOffsetMinutes(getOffsetMinutesAtInstant(referenceDate, trimmedTz), false);
    }
  } else if (typeof referenceDate === 'string' && referenceDate.trim()) {
    const trimmedDate = referenceDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      const resolved = resolveLocalDateTime(trimmedDate, referenceTime, trimmedTz);
      if (resolved) {
        return formatUtcOffsetMinutes(resolved.offsetMinutes, false);
      }
    } else {
      const parsed = new Date(trimmedDate);
      if (!isNaN(parsed.getTime())) {
        return formatUtcOffsetMinutes(getOffsetMinutesAtInstant(parsed, trimmedTz), false);
      }
    }
  }

  return formatUtcOffsetMinutes(getOffsetMinutesAtInstant(new Date(), trimmedTz), false);
}

/**
 * Generates RFC 5545 compliant VTIMEZONE component string for a given timezone ID.
 * Supports standard timezones (e.g. America/New_York, UTC) and falls back gracefully to
 * generic VTIMEZONE block definitions for unrecognized or custom timezones.
 * @param {string} timeZone - The timezone string.
 * @param {string | Date} [referenceDate] - Optional event date to anchor fallback DST offsets.
 * @param {string} [referenceTime] - Optional event wall time in HH:MM format.
 * @returns {string} Standard VTIMEZONE block string.
 */
export function buildVTimezoneBlock(
  timeZone: string,
  referenceDate?: string | Date,
  referenceTime: string = '12:00'
): string {
  const tz = timeZone.trim() || 'UTC';

  // Standard pre-defined timezone blocks for well-known timezones
  const knownBlocks: Record<string, string[]> = {
    'America/New_York': [
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'TZNAME:EDT',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'America/Chicago': [
      'BEGIN:VTIMEZONE',
      'TZID:America/Chicago',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0500',
      'TZNAME:CDT',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0600',
      'TZNAME:CST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'America/Denver': [
      'BEGIN:VTIMEZONE',
      'TZID:America/Denver',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0600',
      'TZNAME:MDT',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0600',
      'TZOFFSETTO:-0700',
      'TZNAME:MST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'America/Los_Angeles': [
      'BEGIN:VTIMEZONE',
      'TZID:America/Los_Angeles',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0800',
      'TZOFFSETTO:-0700',
      'TZNAME:PDT',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0800',
      'TZNAME:PST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'America/Phoenix': [
      'BEGIN:VTIMEZONE',
      'TZID:America/Phoenix',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0700',
      'TZOFFSETTO:-0700',
      'TZNAME:MST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'America/Anchorage': [
      'BEGIN:VTIMEZONE',
      'TZID:America/Anchorage',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0900',
      'TZOFFSETTO:-0800',
      'TZNAME:AKDT',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0800',
      'TZOFFSETTO:-0900',
      'TZNAME:AKST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'Pacific/Honolulu': [
      'BEGIN:VTIMEZONE',
      'TZID:Pacific/Honolulu',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-1000',
      'TZOFFSETTO:-1000',
      'TZNAME:HST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'UTC': [
      'BEGIN:VTIMEZONE',
      'TZID:UTC',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0000',
      'TZNAME:UTC',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'GMT': [
      'BEGIN:VTIMEZONE',
      'TZID:GMT',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0000',
      'TZNAME:GMT',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'Europe/London': [
      'BEGIN:VTIMEZONE',
      'TZID:Europe/London',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T010000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'TZOFFSETFROM:+0000',
      'TZOFFSETTO:+0100',
      'TZNAME:BST',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701025T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0000',
      'TZNAME:GMT',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
    'Europe/Paris': [
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Paris',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'END:STANDARD',
      'END:VTIMEZONE',
    ],
  };

  if (knownBlocks[tz]) {
    return knownBlocks[tz].join('\r\n');
  }

  // Fallback: Dynamically calculate offset using Intl.DateTimeFormat or default to +0000
  const offset = getUtcOffset(tz, referenceDate, referenceTime);
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    `TZNAME:${tz}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
}

/**
 * Creates an ICS file string for an event.
 * ICS is a universal calendar file format compatible with Apple Calendar, Outlook, and others.
 * Prepends standard RFC 5545 VTIMEZONE block for full compatibility with Google Calendar and other calendar clients.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated ICS file content as a string.
 */
export function createIcsFile(event: CalendarEvent): string {
  const icsEvent: EventAttributes = {
    title: event.name,
    description: event.description,
    location: event.location,
    start: formatDateTuple(event.startDate, event.startTime),
    end: formatDateTuple(event.endDate, event.endTime),
    startOutputType: 'local',
    endOutputType: 'local',
  };

  const { error, value } = createEvent(icsEvent);

  if (error) {
    console.error(error);
    return '';
  }

  let icsContent = value || '';
  if (event.timeZone) {
    icsContent = icsContent
      .replace('DTSTART:', `DTSTART;TZID=${event.timeZone}:`)
      .replace('DTEND:', `DTEND;TZID=${event.timeZone}:`);

    const vtimezoneBlock = buildVTimezoneBlock(event.timeZone, event.startDate, event.startTime);
    icsContent = icsContent.replace('BEGIN:VEVENT', `${vtimezoneBlock}\r\nBEGIN:VEVENT`);
  }

  return icsContent;
}

/**
 * Creates a combined multi-event RFC 5545 ICS file string for an itinerary of events.
 * Deduplicates VTIMEZONE definitions across events and binds each VEVENT DTSTART/DTEND
 * to its corresponding TZID.
 * @param {CalendarEvent[]} events - Ordered list of calendar events to include.
 * @returns {string} The generated multi-event ICS file content, or '' if empty/invalid.
 */
export function createMultiEventIcsFile(events: CalendarEvent[]): string {
  if (!Array.isArray(events) || events.length === 0) {
    return '';
  }

  const icsEvents: EventAttributes[] = events.map((event, index) => {
    const cleanId = event.id ? event.id.replace(/[^a-zA-Z0-9._-]/g, '-') : `event-${index + 1}`;
    return {
      uid: `schedule-${cleanId}@wedding-itinerary`,
      title: event.name,
      description: event.description,
      location: event.location,
      start: formatDateTuple(event.startDate, event.startTime),
      end: formatDateTuple(event.endDate, event.endTime),
      startOutputType: 'local',
      endOutputType: 'local',
    };
  });

  const { error, value } = createEvents(icsEvents);

  if (error || !value) {
    if (error) {
      console.error(error);
    }
    return '';
  }

  let eventIdx = 0;
  let icsContent = value.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g, (veventBlock) => {
    const sourceEvent = events[eventIdx];
    eventIdx += 1;
    const tz = sourceEvent?.timeZone?.trim();
    if (!tz) {
      return veventBlock;
    }
    return veventBlock
      .replace('DTSTART:', `DTSTART;TZID=${tz}:`)
      .replace('DTEND:', `DTEND;TZID=${tz}:`);
  });

  const seenTimeZones = new Set<string>();
  const vtimezoneBlocks: string[] = [];
  for (const event of events) {
    const tz = event.timeZone?.trim();
    if (tz && !seenTimeZones.has(tz)) {
      seenTimeZones.add(tz);
      vtimezoneBlocks.push(buildVTimezoneBlock(tz, event.startDate, event.startTime));
    }
  }

  if (vtimezoneBlocks.length > 0) {
    icsContent = icsContent.replace(
      'BEGIN:VEVENT',
      `${vtimezoneBlocks.join('\r\n')}\r\nBEGIN:VEVENT`
    );
  }

  return icsContent;
}
