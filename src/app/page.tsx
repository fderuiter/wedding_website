import { Metadata } from 'next';
import HomePageClient from '@/components/home/HomePageClient';
import { withBasePath } from '@/lib/basePath';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { attractionsRepository, type AttractionDTO } from '@/features/attractions';
import { logisticsService } from '@/features/logistics';
import { subEventService } from '@/features/sub-events';
import { ContentNodeSchema, isPrivateContentNode, type ContentNodeDTO } from '@/features/content';
import { enforceActiveGuestPageSession, getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { isFeatureEnabled } from '@/lib/modules';
import { withPageQuery } from '@/lib/query-wrapper';
import { isStaticExportBuild } from '@/lib/sampleData/builder';

function cleanVenueField(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  if (upper === 'TBD' || upper === 'TBD VENUE') return undefined;
  return trimmed;
}

/**
 * Build homepage metadata and embedded schema.org JSON-LD from application configuration.
 *
 * @returns A `Metadata` object for the homepage containing a page title and description, `alternates.canonical`, Open Graph and Twitter card fields (including image and URL), and an `application/ld+json` entry with an Event schema. 
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const cleanVenueName = cleanVenueField(config.venueName);
  const cleanStreetAddress = cleanVenueField(config.venueAddress);
  const cleanLocality = cleanVenueField(config.venueCity);
  const cleanRegion = cleanVenueField(config.venueState);
  const cleanPostalCode = cleanVenueField(config.venueZip);

  const title = partner1 && partner2
    ? `${partner1} & ${partner2}'s Wedding`
    : 'Wedding Website';
  const siteTitle = config.seoTitle || title;
  const description = config.seoDescription || (
    partner1 && partner2
      ? `Join ${partner1} and ${partner2} for their wedding celebration${cleanVenueName ? ` at ${cleanVenueName}` : ''}.`
      : 'Welcome to our wedding website.'
  );
  const baseUrl = config.baseUrl || 'http://localhost:3000';
  const ogImageUrl = config.ogImageUrl || '/images/placeholder.png';
  const prefixedOgImageUrl = withBasePath(ogImageUrl);
  const imageUrl = ogImageUrl.startsWith('http') ? ogImageUrl : `${baseUrl}${prefixedOgImageUrl}`;

  const addressFields: Record<string, string> = {};
  if (cleanStreetAddress) addressFields.streetAddress = cleanStreetAddress;
  if (cleanLocality) addressFields.addressLocality = cleanLocality;
  if (cleanRegion) addressFields.addressRegion = cleanRegion;
  if (cleanPostalCode) addressFields.postalCode = cleanPostalCode;

  const hasAddressFields = Object.keys(addressFields).length > 0;
  const location =
    cleanVenueName || hasAddressFields
      ? {
        '@type': 'Place',
        ...(cleanVenueName ? { name: cleanVenueName } : {}),
        ...(hasAddressFields
          ? {
            address: {
              '@type': 'PostalAddress',
              ...addressFields,
              addressCountry: 'US',
            },
          }
          : {}),
      }
      : undefined;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    startDate: config.weddingDate.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(location ? { location } : {}),
    description,
  };

  return {
    title: `Home | ${siteTitle}`,
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
  const isStaticExport = isStaticExportBuild();

  const [config, guestScheduleCode] = await Promise.all([
    getAppConfig(),
    isStaticExport
      ? Promise.resolve<string | null>(null)
      : (async () => {
        await enforceActiveGuestPageSession();
        const guestSession = await getGuestInviteSession();
        return guestSession?.code ?? null;
      })(),
  ]);

  const publicConfig = toPublicAppConfig(config);
  const shouldLoadGuestSchedule = isStaticExport || Boolean(guestScheduleCode);

  const [rawContentNodes, guestSchedule, attractions] = await Promise.all([
    withPageQuery(
      () =>
        logisticsService.getHomepageLogistics({
          includePublicSubEvents: !shouldLoadGuestSchedule,
        }),
      [] as ContentNodeDTO[]
    ),
    shouldLoadGuestSchedule
      ? withPageQuery(
        () =>
          subEventService.getScheduleForGuest(guestScheduleCode, {
            includeContentNodeFallback: false,
          }),
        []
      )
      : Promise.resolve([]),
    isFeatureEnabled('attractions', config.modules)
      ? withPageQuery(
        async () => {
          const rawAttractions = await attractionsRepository.getVisibleAttractions();
          return [...rawAttractions].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          });
        },
        [] as AttractionDTO[]
      )
      : Promise.resolve([] as AttractionDTO[]),
  ]);

  let contentNodes = rawContentNodes.filter((n) => !isPrivateContentNode(n));

  if (shouldLoadGuestSchedule && guestSchedule.length > 0) {
    const nonScheduleNodes = contentNodes.filter((n) => {
      if (isPrivateContentNode(n)) {
        return false;
      }
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
          mealOptions: evt.mealOptions ?? [],
          customQuestions: evt.customQuestions ?? [],
          userRsvp: evt.userRsvp ?? undefined,
        },
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    });

    contentNodes = [...nonScheduleNodes, ...authorizedScheduleNodes];
  }

  return <HomePageClient config={publicConfig} contentNodes={contentNodes} attractions={attractions} />;
}
