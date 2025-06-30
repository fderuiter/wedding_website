'use client'

import dynamic from 'next/dynamic'
import React from 'react'

const AddToCalendarButton = dynamic(
  () => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton),
  { ssr: false }
)

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

interface AddToCalendarProps {
  event: CalendarEvent
  className?: string
}

export default function AddToCalendar({ event, className }: AddToCalendarProps) {
  const style =
    '--btn-background:linear-gradient(to right,#be123c,#f59e0b);' +
    '--btn-hover-background:linear-gradient(to right,#f59e0b,#be123c);' +
    '--btn-text:#fff;' +
    '--btn-hover-text:#fff;' +
    '--btn-border-radius:9999px;' +
    '--btn-shadow:rgba(0,0,0,0.1) 0 4px 10px -2px;' +
    '--btn-hover-shadow:rgba(0,0,0,0.2) 0 5px 12px -2px;'

  return (
    <div className={className}>
      <AddToCalendarButton
        name={event.name}
        startDate={event.startDate}
        startTime={event.startTime}
        endDate={event.endDate}
        endTime={event.endTime}
        timeZone={event.timeZone}
        location={event.location}
        description={event.description}
        options={['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo']}
        buttonStyle="round"
        styleLight={style}
        label="Add to Calendar"
        size="2"
      />
    </div>
  )
}
