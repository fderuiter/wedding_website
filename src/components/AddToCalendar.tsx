'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createGoogleCalendarLink, createYahooCalendarLink, createIcsFile } from '@/utils/calendar'

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
 * @interface AddToCalendarProps
 * @description Defines the props for the AddToCalendar component.
 * @property {CalendarEvent} event - The event object to be added to the calendar.
 * @property {string} [className] - Optional CSS class names to apply to the component.
 */
interface AddToCalendarProps {
  event: CalendarEvent
  className?: string
}

/**
 * @function AddToCalendar
 * @description A React component that provides a dropdown menu to add a specified event to various calendar services.
 * @param {AddToCalendarProps} props - The props for the component.
 * @returns {JSX.Element} - The rendered AddToCalendar component.
 */
export default function AddToCalendar({ event, className }: AddToCalendarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleToggle = () => setIsOpen(!isOpen)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const calendarOptions = ['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo']

  const handleCalendarLink = (calendar: string) => {
    let url = ''
    if (calendar === 'Google') {
      url = createGoogleCalendarLink(event)
      window.open(url, '_blank')
    } else if (calendar === 'Yahoo') {
      url = createYahooCalendarLink(event)
      window.open(url, '_blank')
    } else {
      const icsFile = createIcsFile(event)
      const blob = new Blob([icsFile], { type: 'text/calendar' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${event.name}.ics`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    setIsOpen(false)
  }

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <div>
        <button
          type="button"
          className="inline-flex justify-center w-full rounded-full px-8 py-3 bg-accent-from text-white font-semibold shadow-md hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-from"
          id="options-menu"
          aria-haspopup="true"
          aria-expanded="true"
          onClick={handleToggle}
        >
          Add to Calendar
        </button>
      </div>

      {isOpen && (
        <div
          className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10"
        >
          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
            {calendarOptions.map((calendar) => (
              <a
                key={calendar}
                href="#"
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault()
                  handleCalendarLink(calendar)
                }}
              >
                {calendar}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
