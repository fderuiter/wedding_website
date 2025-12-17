'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createGoogleCalendarLink, createYahooCalendarLink, createIcsFile, CalendarEvent } from '@/utils/calendar'

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
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleToggle = () => setIsOpen(!isOpen)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Focus first item when opened
  useEffect(() => {
    if (isOpen) {
      const firstButton = dropdownRef.current?.querySelector('button[role="menuitem"]') as HTMLElement
      firstButton?.focus()
    }
  }, [isOpen])

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const buttons = dropdownRef.current?.querySelectorAll('button[role="menuitem"]')
      if (!buttons) return
      const index = Array.from(buttons).indexOf(document.activeElement as Element)
      let nextIndex = 0
      if (e.key === 'ArrowDown') {
        nextIndex = index + 1 < buttons.length ? index + 1 : 0
      } else {
        nextIndex = index - 1 >= 0 ? index - 1 : buttons.length - 1
      }
      (buttons[nextIndex] as HTMLElement).focus()
    }
  }

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
    triggerRef.current?.focus()
  }

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <div>
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex justify-center w-full rounded-full px-8 py-3 bg-accent-from text-white font-semibold shadow-md hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-from"
          id="options-menu"
          aria-haspopup="true"
          aria-expanded={isOpen}
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
              <button
                key={calendar}
                type="button"
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                role="menuitem"
                onClick={() => handleCalendarLink(calendar)}
                onKeyDown={handleMenuKeyDown}
              >
                {calendar}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
