import { createEvent, EventAttributes } from 'ics'
import { CalendarEvent } from '@/components/AddToCalendar'

function formatDate(date: string, time: string): [number, number, number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return [year, month, day, hours, minutes]
}

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
