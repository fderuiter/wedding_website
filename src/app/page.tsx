import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { logisticsService } from '@/features/logistics';
import { withPageQuery } from '@/lib/query-wrapper';

export const dynamic = 'force-dynamic';

/**
 * Build homepage metadata and embedded schema.org JSON-LD from application configuration.
 *
 * @returns A `Metadata` object for the homepage containing a page title and description, `alternates.canonical`, Open Graph and Twitter card fields (including image and URL), and an `application/ld+json` entry with an Event schema. 
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  const title = config.brideName && config.groomName
    ? `${config.brideName} & ${config.groomName}'s Wedding`
    : 'Wedding Website';
  const description = config.seoDescription || (
    config.brideName && config.groomName
      ? `Join ${config.brideName} and ${config.groomName} for their wedding celebration${config.venueName ? ` at ${config.venueName}` : ''}.`
      : 'Welcome to our wedding website.'
  );
  const baseUrl = config.baseUrl || 'http://localhost:3000';
  const ogImageUrl = config.ogImageUrl || '/images/placeholder.png';
  const imageUrl = ogImageUrl.startsWith('http') ? ogImageUrl : `${baseUrl}${ogImageUrl}`;

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
    title: 'Home',
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

  const contentNodes = await withPageQuery(
    () => logisticsService.getHomepageLogistics(),
    []
  );

  return <HomePageClient config={publicConfig} contentNodes={contentNodes} />;
}
