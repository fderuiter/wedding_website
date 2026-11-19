import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { logisticsService } from '@/features/logistics';
import { subEventService } from '@/features/sub-events';
import { ContentNodeSchema, type ContentNodeDTO } from '@/features/content';
import { enforceActiveGuestPageSession, getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { withPageQuery } from '@/lib/query-wrapper';

/**
 * Build homepage metadata and embedded schema.org JSON-LD from application configuration.
 *
 * @returns A `Metadata` object for the homepage containing a page title and description, `alternates.canonical`, Open Graph and Twitter card fields (including image and URL), and an `application/ld+json` entry with an Event schema. 
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const title = partner1 && partner2
    ? `${partner1} & ${partner2}'s Wedding`
    : 'Wedding Website';
  const description = config.seoDescription || (
    partner1 && partner2
      ? `Join ${partner1} and ${partner2} for their wedding celebration${config.venueName ? ` at ${config.venueName}` : ''}.`
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

  let contentNodes = await withPageQuery(
    () => logisticsService.getHomepageLogistics(),
    []
  );

  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  if (!isStaticExport) {
    await enforceActiveGuestPageSession();
    const guestSession = await getGuestInviteSession();
    if (guestSession?.code) {
      const guestSchedule = await withPageQuery(
        () => subEventService.getScheduleForGuest(guestSession.code),
        []
      );

      if (guestSchedule.length > 0) {
        const nonScheduleNodes = contentNodes.filter((n) => {
          const data = n.data as any;
          return !(
            n.type === 'Schedule' ||
            n.tags.includes('Schedule') ||
            n.tags.includes('schedule') ||
            Boolean(data?.startTime)
          );
        });

        const authorizedScheduleNodes: ContentNodeDTO[] = guestSchedule.map((evt) => {
          const startIso =
            evt.startTime instanceof Date
              ? evt.startTime.toISOString()
              : evt.startTime || undefined;
          const endIso =
            evt.endTime instanceof Date
              ? evt.endTime.toISOString()
              : evt.endTime || undefined;
          const category =
            typeof evt.category === 'string' && evt.category.trim()
              ? evt.category.trim()
              : undefined;

          return ContentNodeSchema.parse({
            id: evt.id,
            type: 'Schedule',
            tags: ['Homepage', 'Schedule'],
            data: {
              title: evt.title,
              description: evt.description || '',
              startTime: startIso,
              endTime: endIso,
              locationName: evt.locationName || evt.location || '',
              location: evt.location || '',
              category,
              categoryTags: category ? [category] : [],
              attireRules: evt.attireRules || undefined,
              isPrivate: Boolean(evt.isPrivate),
              isReadOnly: Boolean(evt.isReadOnly),
              userRsvp: evt.userRsvp ?? undefined,
            },
            createdAt: new Date(0),
            updatedAt: new Date(0),
          });
        });

        contentNodes = [...nonScheduleNodes, ...authorizedScheduleNodes];
      }
    }
  }

  return <HomePageClient config={publicConfig} contentNodes={contentNodes} />;
}
