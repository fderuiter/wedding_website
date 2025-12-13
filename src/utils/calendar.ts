import { createEvent, EventAttributes } from 'ics'
import { CalendarEvent } from '@/components/AddToCalendar'

/**
 * Formats a date and time string into a tuple of numbers for the 'ics' library.
 * @param {string} date - The date string in 'YYYY-MM-DD' format.
 * @param {string} time - The time string in 'HH:MM' format.
 * @returns {[number, number, number, number, number]} A tuple representing [year, month, day, hours, minutes].
 */
function formatDateTuple(date: string, time: string): [number, number, number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return [year, month, day, hours, minutes]
}

/**
 * Formats date and time into YYYYMMDDTHHMMSS string for calendar URLs.
 * @param {string} date - The date string in 'YYYY-MM-DD' format.
 * @param {string} time - The time string in 'HH:MM' format.
 * @returns {string} The formatted date-time string.
 */
function formatDateTimeForUrl(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '')}00`
}

/**
 * Helper function to build a calendar URL with query parameters.
 * @param {string} baseUrl - The base URL for the calendar service.
 * @param {Record<string, string>} params - A key-value map of query parameters.
 * @returns {string} The fully constructed URL.
 */
function buildCalendarUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })
  return url.toString()
}

/**
 * Creates a URL to add an event to Google Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Google Calendar URL.
 */
export function createGoogleCalendarLink(event: CalendarEvent): string {
  const start = formatDateTimeForUrl(event.startDate, event.startTime)
  const end = formatDateTimeForUrl(event.endDate, event.endTime)

  return buildCalendarUrl('https://calendar.google.com/calendar/render', {
    action: 'TEMPLATE',
    text: event.name,
    dates: `${start}/${end}`,
    ctz: event.timeZone,
    details: event.description,
    location: event.location,
  })
}

/**
 * Creates a URL to add an event to Yahoo Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Yahoo Calendar URL.
 */
export function createYahooCalendarLink(event: CalendarEvent): string {
  const start = formatDateTimeForUrl(event.startDate, event.startTime)
  const end = formatDateTimeForUrl(event.endDate, event.endTime)

  return buildCalendarUrl('https://calendar.yahoo.com/', {
    v: '60',
    view: 'd',
    type: '20',
    title: event.name,
    st: start,
    et: end,
    desc: event.description,
    in_loc: event.location,
  })
}

/**
 * Creates an ICS file string for an event.
 * ICS is a universal calendar file format compatible with Apple Calendar, Outlook, and others.
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
  }

  const { error, value } = createEvent(icsEvent)

  if (error) {
    console.error(error)
    return ''
  }

  return value || ''
}
