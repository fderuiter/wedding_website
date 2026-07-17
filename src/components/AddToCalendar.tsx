'use client';

import React, { useState, useRef } from 'react';
import { createGoogleCalendarLink, createYahooCalendarLink, createIcsFile, CalendarEvent } from '@/utils/calendar';
import { useOverlay } from '@/hooks/useOverlay';

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
 * Render a button that opens a dropdown for exporting the provided event to multiple calendar services.
 *
 * The dropdown lists Google, Apple, iCal, Outlook.com, and Yahoo options; selecting an option opens the corresponding
 * calendar link or downloads an `.ics` file. Keyboard arrow navigation is supported within the menu and focus is
 * restored to the trigger after an action.
 *
 * @param event - Event data used to generate calendar entries (title, start/end, location, etc.)
 * @param className - Optional additional CSS classes applied to the root container
 * @returns The component's JSX element
 */
export default function AddToCalendar({ event, className }: AddToCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleToggle = () => setIsOpen(!isOpen);

  const { overlayRef } = useOverlay(isOpen, () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  });

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = overlayRef.current?.querySelectorAll('button[role="menuitem"]');
      if (!buttons) return;
      const index = Array.from(buttons).indexOf(document.activeElement as Element);
      let nextIndex = 0;
      if (e.key === 'ArrowDown') {
        nextIndex = index + 1 < buttons.length ? index + 1 : 0;
      } else {
        nextIndex = index - 1 >= 0 ? index - 1 : buttons.length - 1;
      }
      (buttons[nextIndex] as HTMLElement).focus();
    }
  };

  const calendarOptions = ['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo'];

  const handleCalendarLink = (calendar: string) => {
    let url = '';
    if (calendar === 'Google') {
      url = createGoogleCalendarLink(event);
      window.open(url, '_blank');
    } else if (calendar === 'Yahoo') {
      url = createYahooCalendarLink(event);
      window.open(url, '_blank');
    } else {
      const icsFile = createIcsFile(event);
      const blob = new Blob([icsFile], { type: 'text/calendar' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${event.name}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`relative inline-block text-left ${className}`}>
      <div>
        <button
          ref={triggerRef}
          type="button"
          className="btn-primary w-full rounded-full px-8 py-3"
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
          ref={overlayRef}
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
  );
}
