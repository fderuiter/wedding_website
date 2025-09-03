import React from 'react';
import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { CalendarEvent } from '@/components/AddToCalendar';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: "Abbigayle & Frederick's Wedding",
  startDate: '2025-10-10T16:00:00-05:00',
  endDate: '2025-10-10T22:00:00-05:00',
  eventStatus: 'https://schema.org/EventScheduled',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  location: {
    '@type': 'Place',
    name: 'Plummer House',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '1091 Plummer Ln SW',
      addressLocality: 'Rochester',
      addressRegion: 'MN',
      postalCode: '55902',
      addressCountry: 'US',
    },
  },
  description: 'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
  organizer: { '@type': 'Person', name: 'Frederick de Ruiter', url: 'https://github.com/fderuiter/wedding_website' },
};

export const metadata: Metadata = {
  title: "Home",
  alternates: {
    canonical: '/',
  },
  other: {
    'application/ld+json': JSON.stringify(jsonLd),
  },
};

const calendarEvent: CalendarEvent = {
  name: jsonLd.name,
  startDate: '2025-10-10',
  startTime: '16:00',
  endDate: '2025-10-10',
  endTime: '22:00',
  timeZone: 'America/Chicago',
  location: 'Plummer House, 1091 Plummer Ln SW, Rochester, MN',
  description: jsonLd.description,
};

/**
 * @page HomePage
 * @description The server component for the main home page.
 *
 * This component sets up the JSON-LD structured data for SEO and defines the calendar event details.
 * It then renders the `HomePageClient` component, passing the calendar event data to it.
 * The client component handles the interactive parts of the page, including the intro animation.
 *
 * @returns {JSX.Element} The rendered HomePageClient component.
 */
export default function HomePage() {
  return <HomePageClient calendarEvent={calendarEvent} />;
}
