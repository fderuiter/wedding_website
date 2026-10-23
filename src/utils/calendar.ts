import { createEvent, EventAttributes } from 'ics';

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
 * Converts a structured schedule event node payload into a CalendarEvent interface.
 * Handles ISO timestamp parsing (e.g. 2026-06-20T15:00:00.000Z) or date/time parameters.
 */
export function formatScheduleEventToCalendarEvent(
  scheduleItem: {
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
      startDate = startDateObj.toISOString().split('T')[0];
      startTime = startDateObj.toISOString().split('T')[1].substring(0, 5);
    }
  }

  if (scheduleItem.endTime) {
    const endDateObj = new Date(scheduleItem.endTime);
    if (!isNaN(endDateObj.getTime())) {
      endDate = endDateObj.toISOString().split('T')[0];
      endTime = endDateObj.toISOString().split('T')[1].substring(0, 5);
    }
  } else if (scheduleItem.startTime) {
    const startDateObj = new Date(scheduleItem.startTime);
    if (!isNaN(startDateObj.getTime())) {
      const defaultEnd = new Date(startDateObj.getTime() + 60 * 60 * 1000);
      endDate = defaultEnd.toISOString().split('T')[0];
      endTime = defaultEnd.toISOString().split('T')[1].substring(0, 5);
    }
  }

  return {
    name,
    startDate,
    startTime,
    endDate,
    endTime,
    timeZone,
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
  const start = formatDateTimeForUrl(event.startDate, event.startTime);
  const end = formatDateTimeForUrl(event.endDate, event.endTime);

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
    return `${date}T${time}${time.length === 5 ? ':00' : ''}`;
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
 * Calculates the formatted UTC offset (+HHMM or -HHMM) for a given timezone ID using Intl API.
 * Falls back to +0000 if timezone is invalid or unrecognized.
 */
function getUtcOffset(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());

    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzPart || tzPart === 'GMT' || tzPart === 'UTC') return '+0000';

    const match = tzPart.match(/GMT([+-])(\d{1,2}):(\d{2})/);
    if (match) {
      const sign = match[1];
      const hours = match[2].padStart(2, '0');
      const minutes = match[3];
      return `${sign}${hours}${minutes}`;
    }
  } catch {
    // Unrecognized or invalid timezone string
  }
  return '+0000';
}

/**
 * Generates RFC 5545 compliant VTIMEZONE component string for a given timezone ID.
 * Supports standard timezones (e.g. America/New_York, UTC) and falls back gracefully to
 * generic VTIMEZONE block definitions for unrecognized or custom timezones.
 * @param {string} timeZone - The timezone string.
 * @returns {string} Standard VTIMEZONE block string.
 */
export function buildVTimezoneBlock(timeZone: string): string {
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
  const offset = getUtcOffset(tz);
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

    const vtimezoneBlock = buildVTimezoneBlock(event.timeZone);
    icsContent = icsContent.replace('BEGIN:VEVENT', `${vtimezoneBlock}\r\nBEGIN:VEVENT`);
  }

  return icsContent;
}
