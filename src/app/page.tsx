import React from 'react';
import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { CalendarEvent } from '@/utils/calendar';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { logisticsService } from '@/features/logistics/service';

/**
 * Build homepage metadata and embedded schema.org JSON-LD from application configuration.
 *
 * @returns A `Metadata` object for the homepage containing a page title and description, `alternates.canonical`, Open Graph and Twitter card fields (including image and URL), and an `application/ld+json` entry with an Event schema. 
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  const title = config.seoTitle || `${config.brideName} & ${config.groomName}'s Wedding`;
  const description = config.seoDescription || `Join ${config.brideName} and ${config.groomName} for their wedding celebration at the historic ${config.venueName} in ${config.venueCity}, ${config.venueState}. Find all the details about the ceremony, reception, registry, and our story.`;
  const baseUrl = config.baseUrl || 'https://abbifred.com';
  const imageUrl = config.ogImageUrl ? (config.ogImageUrl.startsWith('http') ? config.ogImageUrl : `${baseUrl}${config.ogImageUrl}`) : `${baseUrl}/images/sunset-embrace.jpg`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
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
    description,
  };

  return {
    title: "Home",
    description,
    alternates: {
      canonical: baseUrl,
    },
    openGraph: {
      title,
      description,
      url: baseUrl,
      type: 'website',
      images: [imageUrl],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
    other: {
      'application/ld+json': JSON.stringify(jsonLd),
    },
  };
}

/**
 * Assemble page data and render the homepage component.
 *
 * Builds a public-facing app config and a wedding `CalendarEvent`, attempts to load homepage content
 * nodes from the logistics service (falls back to an empty array on failure), and returns the
 * homepage JSX element populated with those values.
 *
 * @returns The homepage JSX element populated with the public app configuration, a calendar event for the wedding, and the fetched content nodes (or an empty array if fetching fails).
 */
export default async function HomePage() {
  const config = await getAppConfig();
  const publicConfig = toPublicAppConfig(config);

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
    contentNodes = await logisticsService.getHomepageLogistics();
  } catch (error) {
    console.warn("Could not fetch content nodes for Homepage");
  }

  return <HomePageClient calendarEvent={calendarEvent} config={publicConfig} contentNodes={contentNodes} />;
}
