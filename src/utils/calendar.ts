import { createEvent, EventAttributes } from 'ics'
import { CalendarEvent } from '@/components/AddToCalendar'

/**
 * Formats a date and time string into a tuple of numbers for the 'ics' library.
 * @param {string} date - The date string in 'YYYY-MM-DD' format.
 * @param {string} time - The time string in 'HH:MM' format.
 * @returns {[number, number, number, number, number]} A tuple representing [year, month, day, hours, minutes].
 */
function formatDate(date: string, time: string): [number, number, number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return [year, month, day, hours, minutes]
}

/**
 * Creates a URL to add an event to Google Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Google Calendar URL.
 */
export function createGoogleCalendarLink(event: CalendarEvent): string {
  const gCalEvent = {
    ...event,
    start: `${event.startDate.replace(/-/g, '')}T${event.startTime.replace(/:/g, '')}00`,
    end: `${event.endDate.replace(/-/g, '')}T${event.endTime.replace(/:/g, '')}00`,
  }
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('text', gCalEvent.name)
  url.searchParams.set('dates', `${gCalEvent.start}/${gCalEvent.end}`)
  url.searchParams.set('ctz', gCalEvent.timeZone)
  url.searchParams.set('details', gCalEvent.description)
  url.searchParams.set('location', gCalEvent.location)
  return url.toString()
}

/**
 * Creates a URL to add an event to Yahoo Calendar.
 * @param {CalendarEvent} event - The event object.
 * @returns {string} The generated Yahoo Calendar URL.
 */
export function createYahooCalendarLink(event: CalendarEvent): string {
    const yahooEvent = {
    ...event,
    start: `${event.startDate.replace(/-/g, '')}T${event.startTime.replace(/:/g, '')}00`,
    end: `${event.endDate.replace(/-/g, '')}T${event.endTime.replace(/:/g, '')}00`,
  }
  const url = new URL('https://calendar.yahoo.com/')
  url.searchParams.set('v', '60')
  url.searchParams.set('view', 'd')
  url.searchParams.set('type', '20')
  url.searchParams.set('title', yahooEvent.name)
  url.searchParams.set('st', yahooEvent.start)
  url.searchParams.set('et', yahooEvent.end)
  url.searchParams.set('desc', yahooEvent.description)
  url.searchParams.set('in_loc', yahooEvent.location)
  return url.toString()
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
    start: formatDate(event.startDate, event.startTime),
    end: formatDate(event.endDate, event.endTime),
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
