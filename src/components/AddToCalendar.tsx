'use client';

import React, { useState, useRef, useId } from 'react';
import { createGoogleCalendarLink, createYahooCalendarLink, createOutlookCalendarLink, createIcsFile, type CalendarEvent } from '@/utils/calendar';
import { useMenuPopup } from '@/hooks/useMenuPopup';
import { useMenuNavigation } from '@/hooks/useMenuNavigation';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { downloadExportBlob } from '@/utils/exportDownload';

/**
 * @interface AddToCalendarProps
 * @description Defines the props for the AddToCalendar component.
 * @property {CalendarEvent} event - The event object to be added to the calendar.
 * @property {string} [className] - Optional CSS class names to apply to the component.
 * @property {string} [downloadUrl] - Optional direct server-side download endpoint for the .ics file.
 * @property {string} [eventId] - Optional event identifier used to construct the .ics download endpoint.
 */
export interface AddToCalendarProps {
  event: CalendarEvent
  className?: string
  downloadUrl?: string
  eventId?: string
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
 * @param downloadUrl - Optional direct server-side download endpoint for the .ics file
 * @param eventId - Optional event identifier used to construct the .ics download endpoint
 * @returns The component's JSX element
 */
export default function AddToCalendar({ event, className, downloadUrl, eventId }: AddToCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toast = useOptionalToast();
  const instanceId = useId().replace(/:/g, '');
  const triggerId = `add-to-calendar-trigger-${instanceId}`;
  const menuId = `add-to-calendar-menu-${instanceId}`;

  const handleToggle = () => setIsOpen((prev) => !prev);

  const { menuRef: overlayRef } = useMenuPopup(
    isOpen,
    () => {
      setIsOpen(false);
    },
    { triggerRef }
  );

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
    }
  };

  const { handleMenuKeyDown } = useMenuNavigation(overlayRef);

  const calendarOptions = ['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo'];

  const handleCalendarLink = (calendar: string) => {
    let url = '';
    if (calendar === 'Google') {
      url = createGoogleCalendarLink(event);
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (calendar === 'Yahoo') {
      url = createYahooCalendarLink(event);
      window.open(url, '_blank', 'noopener,noreferrer');
    } else if (calendar === 'Outlook.com') {
      url = createOutlookCalendarLink(event);
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      const directDownloadUrl = downloadUrl || (eventId ? `/api/schedule/${eventId}/ics` : (event.id ? `/api/schedule/${event.id}/ics` : undefined));
      if (directDownloadUrl) {
        void downloadExportBlob(directDownloadUrl, `${event.name}.ics`)
          .then(() => {
            toast?.addToast('Calendar invite (.ics) downloaded.', 'success');
          })
          .catch((err: unknown) => {
            toast?.addToast(
              err instanceof Error && err.message
                ? err.message
                : 'Failed to download calendar invite.',
              'error'
            );
          });
      } else {
        const icsFile = createIcsFile(event);
        const blob = new Blob([icsFile], { type: 'text/calendar' });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `${event.name}.ics`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
        toast?.addToast('Calendar invite (.ics) downloaded.', 'success');
      }
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`relative inline-block text-left ${className ?? ''}`}>
      <div>
        <button
          ref={triggerRef}
          type="button"
          className="btn-primary w-full rounded-full px-8 py-3"
          id={triggerId}
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          onClick={handleToggle}
          onKeyDown={handleTriggerKeyDown}
        >
          Add to Calendar
        </button>
      </div>

      {isOpen && (
        <div
          ref={overlayRef}
          className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 ring-1 ring-black/5 z-10"
        >
          <div
            id={menuId}
            className="py-1"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby={triggerId}
          >
            {calendarOptions.map((calendar) => (
              <button
                key={calendar}
                type="button"
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus:bg-gray-100 dark:focus:bg-gray-700 focus:text-gray-900 dark:focus:text-white transition-colors"
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
