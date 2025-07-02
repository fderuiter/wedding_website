'use client'

import dynamic from 'next/dynamic'
import React, { useEffect } from 'react'

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
  const baseStyle =
    '--font:var(--font-sans);' +
    '--btn-background:linear-gradient(to right,var(--color-accent-to),var(--color-accent-from));' +
    '--btn-hover-background:linear-gradient(to right,var(--color-accent-from),var(--color-accent-to));' +
    '--btn-font-weight:600;' +
    '--btn-padding-x:2rem;' +
    '--btn-padding-y:0.75rem;' +
    '--btn-border-radius:9999px;' +
    '--btn-shadow:rgba(0,0,0,0.1) 0 4px 10px -2px;' +
    '--btn-hover-shadow:rgba(0,0,0,0.2) 0 5px 12px -2px;'

  const styleLight =
    baseStyle +
    '--btn-text:#000;' +
    '--btn-hover-text:#000;'

  const styleDark =
    baseStyle +
    '--btn-text:var(--color-text-on-primary);' +
    '--btn-hover-text:var(--color-text-on-primary);'

  useEffect(() => {
    const hiddenEls = document.querySelectorAll(
      'div[data-aria-hidden="true"][aria-hidden="true"]'
    )
    hiddenEls.forEach(el => {
      const element = el as HTMLElement
      element.setAttribute('tabindex', '-1')
      element.querySelectorAll<HTMLElement>('button, a, input, select, textarea')
        .forEach(focusable => focusable.setAttribute('tabindex', '-1'))
    })
  }, [])

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
        buttonStyle="default"
        styleLight={styleLight}
        styleDark={styleDark}
        label="Add to Calendar"
      />
    </div>
  )
}
