import React from 'react';
import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { CalendarEvent } from '@/utils/calendar';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${config.brideName} & ${config.groomName}'s Wedding`,
    startDate: config.weddingDate.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: config.venueName,
      address: {
        '@type': 'PostalAddress',
        streetAddress: config.venueAddress,
        addressLocality: config.venueCity,
        addressRegion: config.venueState,
        postalCode: config.venueZip,
        addressCountry: 'US',
      },
    },
    description: config.venueDescription,
  };

  return {
    title: "Home",
    alternates: {
      canonical: '/',
    },
    other: {
      'application/ld+json': JSON.stringify(jsonLd),
    },
  };
}

export default async function HomePage() {
  const config = await getAppConfig();

  const calendarEvent: CalendarEvent = {
    name: `${config.brideName} & ${config.groomName}'s Wedding`,
    startDate: config.weddingDate.toISOString().split('T')[0],
    startTime: '16:00',
    endDate: config.weddingDate.toISOString().split('T')[0],
    endTime: '22:00',
    timeZone: 'America/Chicago',
    location: `${config.venueName}, ${config.venueAddress}, ${config.venueCity}, ${config.venueState}`,
    description: config.venueDescription,
  };

  let contentNodes: import('@prisma/client').ContentNode[] = [];
  try {
    contentNodes = await prisma.contentNode.findMany({
      where: {
        tags: {
          has: 'Homepage'
        }
      }
    });
  } catch (error) {
    console.warn("Could not fetch content nodes for Homepage");
  }

  return <HomePageClient calendarEvent={calendarEvent} config={config} contentNodes={contentNodes} />;
}

