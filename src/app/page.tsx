import React from 'react';
import { Metadata } from 'next';
import HomePageClient from './HomePageClient';
import { CalendarEvent } from '@/components/AddToCalendar';
import { GalleryImage } from '@/components/Gallery';

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

const galleryImages: GalleryImage[] = [
  { src: '/images/sunset-embrace.jpg', alt: 'Abbi and Fred hug on a lakeside path at sunset, framed by twisting bare branches and a glowing orange sky.' },
  { src: '/images/jogging-buddies.jpg', alt: 'Sweaty but smiling, Abbi and Fred snap a post-run selfie on a sunny sidewalk beside a brick building.' },
  { src: '/images/winter-warmth.jpg', alt: 'Bundled in winter layers, Abbi and Fred pose against a brick wall—she in leopard-trimmed coat and hat, he in a dark jacket—both beaming.' },
  { src: '/images/sunset-kiss.jpg', alt: 'Abbi and Fred share a quiet kiss at sunset beneath leafless tree silhouettes, golden light reflecting off the lake behind them.' },
  { src: '/images/timberwolves.jpg', alt: 'Abbi and Fred smile from their seats at a packed Timberwolves basketball game, sporting team gear and surrounded by excited fans.' },
  { src: '/images/twins-wins.jpg', alt: 'Abbi and Fred grin for a selfie with Target\u202fField and a cheering Minnesota Twins crowd spread out behind them.' },
  { src: '/images/post-graduation-celebration.jpg', alt: 'Dressed up for the evening, Fred in a crisp white shirt hugs Abbi in a black dress as they smile warmly against a simple light backdrop.' },
];

export default function HomePage() {
  return <HomePageClient galleryImages={galleryImages} calendarEvent={calendarEvent} />;
}
