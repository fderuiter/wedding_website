'use client';

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '@/components/ui/Icon';
import type { AttractionDTO } from '@/features/attractions';
import {
  compareFaqNodesByOrder,
  isFaqNodeVisible,
  type ContentNodeDTO,
} from '@/features/content';
import type { PublicAppConfig } from '@/lib/config';
import Link from 'next/link';
import BackToTop from '@/components/BackToTop';
import { Interactive3DCard } from '@/components/ui/Interactive3DCard';
import { formatDate } from '@/utils/intl';
import { formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import Countdown from '@/components/Countdown';
import AddToCalendar from '@/components/AddToCalendar';
import InteractiveTimeline from '@/components/schedule/InteractiveTimeline';
import FaqAccordion, { type FAQItemInput } from '@/components/faq/FaqAccordion';
import ThingsToDoCard from '@/app/things-to-do/components/ThingsToDoCard';
import { useGuestHelp } from '@/components/guest/GuestHelpModal';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import {
  resolveDirectionsUrl,
  formatVenueStreetAddress,
  formatFullVenueLocation,
  isNonPlaceholderVenueText,
} from '@/utils/maps';

import { isFeatureEnabled } from '@/lib/modules';
import { useTheme } from '@/components/ThemeProvider';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { getPresetTokens, parseMotionEasing, parseDurationSec } from '@/lib/theme/presets';
import { sanitizeUrl } from '@/utils/validation';
import { MediaImage } from '@/components/MediaImage';
import { useStaticDemoPageOverrides } from '@/lib/staticDemo/runtime';
import { withBasePath } from '@/lib/basePath';
import {
  cleanOptionalSetupText,
  formatCleanVenueParts,
  synthesizeSetupStarterCopy,
} from '@/lib/setupCopy';

function getSafeBackgroundImageStyle(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  let url = rawUrl.trim();
  if (url === 'none') return undefined;
  if (url.startsWith('url(') && url.endsWith(')')) {
    url = url.slice(4, -1).trim().replace(/^['"]|['"]$/g, '');
  }
  const safe = sanitizeUrl(url);
  return safe ? `url("${withBasePath(safe)}")` : undefined;
}

function splitParagraphs(text?: string | null): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function isHotelRecommendation(attraction: AttractionDTO): boolean {
  if (attraction.isVisible === false) return false;
  const normalizedCategory = attraction.category?.trim().toLowerCase() || '';
  const isHotelCategory =
    normalizedCategory === 'hotel' ||
    normalizedCategory === 'hotels' ||
    normalizedCategory === 'stay' ||
    normalizedCategory === 'lodging' ||
    normalizedCategory === 'accommodation' ||
    normalizedCategory === 'accommodations';
  const hasRoomBlockDetails = Boolean(
    attraction.promoCode?.trim() ||
    attraction.roomRate?.trim() ||
    attraction.cutoffDate?.trim() ||
    sanitizeUrl(attraction.bookingUrl) ||
    attraction.shuttleInfo?.trim()
  );
  return isHotelCategory || hasRoomBlockDetails;
}

const subscribePreviewNoop = () => () => {};
const getAdminPreviewClientSnapshot = () =>
  typeof window !== 'undefined' &&
  (window !== window.parent ||
    new URLSearchParams(window.location.search).get('preview') === 'true');
const getAdminPreviewServerSnapshot = () => false;

/**
 * Renders the client-side wedding homepage and updates its content live when receiving cross-window draft updates.
 *
 * Renders sections (story, details, accommodations, venue, travel, faq, and custom) driven by `config`, `contentNodes`, and `attractions`, formats the wedding date for display, and animates sections with Framer Motion. While mounted inside an iframe, listens for postMessage events of type `DRAFT_UPDATE` and merges incoming `config` updates or replaces `contentNodes` / `attractions` when draft data arrives.
 *
 * @param config - Initial public application configuration used to populate page content and settings.
 * @param contentNodes - Optional initial array of CMS content nodes that drive FAQs, logistics, and custom sections.
 * @param attractions - Optional initial array of visible attractions used to render hotel room block cards.
 * @returns The rendered homepage JSX element.
 */
export default function HomePageClient({
  config: initialConfig,
  contentNodes: initialContentNodes = [],
  attractions: initialAttractions = [],
}: {
  config: PublicAppConfig;
  contentNodes?: ContentNodeDTO[];
  attractions?: AttractionDTO[];
}) {
  const demo = useOptionalDemo();
  const demoOverrides = useStaticDemoPageOverrides();
  const [draftConfig, setDraftConfig] = useState<Partial<PublicAppConfig> | null>(null);
  const [draftContentNodes, setDraftContentNodes] = useState<ContentNodeDTO[] | null>(null);
  const [draftAttractions, setDraftAttractions] = useState<AttractionDTO[] | null>(null);
  const hasDraftContent = draftContentNodes !== null;

  const isDemoMode = Boolean(demo?.isDemoMode);
  const demoConfigOverrides = demo?.configOverrides;
  const demoLogisticsNodes = demo?.activeDataset.logisticsNodes;
  const demoFaqs = demo?.activeDataset.faqs;

  const baseConfig = useMemo<PublicAppConfig>(() => {
    const seededConfig = demoOverrides?.config ?? initialConfig;
    return isDemoMode && demoConfigOverrides
      ? { ...seededConfig, ...demoConfigOverrides }
      : seededConfig;
  }, [demoConfigOverrides, demoOverrides?.config, initialConfig, isDemoMode]);

  const config = useMemo<PublicAppConfig>(
    () => (draftConfig ? { ...baseConfig, ...draftConfig } : baseConfig),
    [baseConfig, draftConfig]
  );

  const contentNodes = useMemo<ContentNodeDTO[]>(() => {
    if (draftContentNodes) return draftContentNodes;
    if (isDemoMode && demoLogisticsNodes && demoFaqs) {
      const sourceNodes = demoOverrides?.contentNodes ?? initialContentNodes;
      const scheduleNodes = sourceNodes.filter((n) => n.type === 'Schedule');
      return [...scheduleNodes, ...demoLogisticsNodes, ...demoFaqs];
    }
    return demoOverrides?.contentNodes ?? initialContentNodes;
  }, [
    demoFaqs,
    demoLogisticsNodes,
    demoOverrides?.contentNodes,
    draftContentNodes,
    initialContentNodes,
    isDemoMode,
  ]);

  const attractions =
    draftAttractions ??
    (isDemoMode && demo
      ? demo.activeDataset.attractions
      : (demoOverrides?.attractions ?? initialAttractions));
  const isAdminPreview = useSyncExternalStore(
    subscribePreviewNoop,
    getAdminPreviewClientSnapshot,
    getAdminPreviewServerSnapshot
  );
  const { hasProvider: hasGuestHelpProvider, syncLiveConfig } = useGuestHelp();
  const { themePreset } = useTheme();
  const presetTokens = getPresetTokens(themePreset);

  const entranceDuration = parseDurationSec(presetTokens['--motion-duration-slow'], 0.8);
  const entranceDelayStep = parseDurationSec(presetTokens['--motion-duration-fast'], 0.15);

  const fadeUp = {
    hidden: { opacity: 0, y: 40 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: entranceDelayStep * i,
        duration: entranceDuration,
        ease: parseMotionEasing(presetTokens['--motion-ease-default']),
      },
    }),
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isIframe = window !== window.parent;
    const isPreviewQuery = new URLSearchParams(window.location.search).get('preview') === 'true';
    if (!isIframe && !isPreviewQuery) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'DRAFT_UPDATE') {
        if (event.data.draftType === 'config' && event.data.draftData) {
          setDraftConfig((prev) => ({ ...(prev ?? {}), ...event.data.draftData }));
        } else if (event.data.draftType === 'content' && Array.isArray(event.data.draftData)) {
          setDraftContentNodes(event.data.draftData);
        } else if (event.data.draftType === 'attractions' && Array.isArray(event.data.draftData)) {
          setDraftAttractions(event.data.draftData);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#schedule') return;
    const scheduleEl = document.getElementById('schedule');
    if (scheduleEl && typeof scheduleEl.scrollIntoView === 'function') {
      scheduleEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [contentNodes.length, isAdminPreview]);

  let formattedDate: string;
  try {
    formattedDate = formatDate(config.weddingDate, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: config.timezone || 'UTC',
    });
  } catch {
    formattedDate = formatDate(config.weddingDate, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  const visibleFaqNodes = useMemo(
    () =>
      contentNodes
        .filter((n) => {
          if (n.type !== 'FAQ' || !isFaqNodeVisible(n)) return false;
          const data =
            n.data && typeof n.data === 'object' && !Array.isArray(n.data)
              ? (n.data as Record<string, unknown>)
              : {};
          const question = typeof data.question === 'string' ? data.question.trim() : '';
          const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
          return Boolean(question || answer);
        })
        .sort(compareFaqNodesByOrder),
    [contentNodes]
  );

  useEffect(() => {
    if (!hasGuestHelpProvider) return;
    syncLiveConfig({
      faqs: visibleFaqNodes.map((node, index) => {
        const data = node.data as Record<string, unknown>;
        return {
          id: node.id,
          question: typeof data.question === 'string' ? data.question : '',
          answer: typeof data.answer === 'string' ? data.answer : '',
          category: typeof data.category === 'string' ? data.category : undefined,
          isVisible: typeof data.isVisible === 'boolean' ? data.isVisible : undefined,
          displayOrder:
            typeof data.displayOrder === 'number' ? data.displayOrder : index,
        };
      }),
    });
  }, [hasGuestHelpProvider, syncLiveConfig, visibleFaqNodes]);

  const partner1Display = (config.partner1Name || config.brideName || '').trim();
  const partner2Display = (config.partner2Name || config.groomName || '').trim();
  const cleanVenue = formatCleanVenueParts({
    venueName: config.venueName,
    venueAddress: config.venueAddress,
    venueCity: config.venueCity,
    venueState: config.venueState,
    venueZip: config.venueZip,
  });
  const starterCopy = synthesizeSetupStarterCopy({
    partner1Name: partner1Display,
    partner2Name: partner2Display,
    weddingDate: config.weddingDate,
    timezone: config.timezone,
    venueName: cleanVenue.venueName,
    venueCity: cleanVenue.venueCity,
    venueState: cleanVenue.venueState,
  });

  const defaultHeroTitle =
    partner1Display && partner2Display
      ? `${partner1Display} & ${partner2Display}`
      : 'Celebrate With Us';
  const defaultHeroSubtitle = cleanVenue.cityState
    ? `Join us as we celebrate our wedding on ${formattedDate} in ${cleanVenue.cityState}.`
    : `Join us as we celebrate our wedding on ${formattedDate}.`;

  const rawHeroTitle = config.heroTitle?.trim() || '';
  const isLegacyPastHeroTitle = rawHeroTitle.toLowerCase() === 'we tied the knot!';
  const resolvedHeroTitle =
    rawHeroTitle && !(isLegacyPastHeroTitle && starterCopy.isUpcoming)
      ? rawHeroTitle
      : starterCopy.isUpcoming
        ? starterCopy.heroTitle
        : defaultHeroTitle;
  const resolvedHeroSubtitle =
    config.heroSubtitle?.trim() ||
    (!starterCopy.isUpcoming && isLegacyPastHeroTitle
      ? `Thank you for celebrating with us on ${formattedDate}${cleanVenue.cityState ? `, in ${cleanVenue.cityState}` : ''}. We're so grateful for all the love and support from our family and friends.`
      : starterCopy.isUpcoming
        ? starterCopy.heroSubtitle
        : defaultHeroSubtitle);

  const logisticsNodes = contentNodes
    .filter((n): n is Extract<ContentNodeDTO, { type: 'Logistics' }> => n.type === 'Logistics')
    .map(n => n.data);

  let features = config.features || [];

  if (features.length === 0) {
    features = [
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
      { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
      { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
      { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
      { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
    ];
  }

  const renderSection = (feature: any, index: number) => {
    if (!feature.visible) return null;

    switch (feature.type) {
      case 'story': {
        const cleanedStory = cleanOptionalSetupText(config.storyText);
        const storyParagraphs = splitParagraphs(cleanedStory || starterCopy.storyText);
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary">{feature.title || 'Our Story'}</h2>
            {storyParagraphs.length > 0 ? (
              storyParagraphs.map((paragraph, i) => (
                <p key={i} className="type-body">{paragraph}</p>
              ))
            ) : (
              <p className="text-center text-gray-600 dark:text-gray-300">Story details coming soon...</p>
            )}
          </motion.section>
        );
      }
      case 'details': {
        const hasStructuredSchedule = contentNodes.some(
          n => n.type === 'Schedule' || (n.type === 'Logistics' && (n.data as any)?.startTime) || (n.data as any)?.startTime
        );
        const innerSectionId = feature.id === 'schedule' ? undefined : feature.id;

        if (hasStructuredSchedule) {
          return (
            <div key={feature.id} id="schedule" className="scroll-mt-24">
              <motion.div id={innerSectionId} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
                <InteractiveTimeline
                  events={contentNodes}
                  timezone={config.timezone}
                  title={feature.title || 'Wedding Day Details'}
                  isPreview={hasDraftContent}
                />
              </motion.div>
            </div>
          );
        }

        const detailsNode = logisticsNodes.find(n => n.ceremonyTitle);
        if (!detailsNode) return (
          <div key={feature.id} id="schedule" className="scroll-mt-24">
            <motion.section id={innerSectionId} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
              <h2 className="text-center type-h2 text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
              <div className="text-center text-gray-600 dark:text-gray-300">Details coming soon...</div>
            </motion.section>
          </div>
        );
        return (
          <div key={feature.id} id="schedule" className="scroll-mt-24">
            <motion.section id={innerSectionId} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
              <h2 className="text-center type-h2 text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
              <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
                <div className="rounded-2xl border border-primary dark:border-primary bg-white dark:bg-gray-800 p-8 shadow-[var(--shadow-lg)] transition-transform hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-lg)' }}>
                  <h3 className="mb-4 type-h3 text-gray-800 dark:text-gray-100">{detailsNode.ceremonyTitle}</h3>
                  <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                    {detailsNode.ceremonyTime && <li>{detailsNode.ceremonyTime}</li>}
                    {cleanVenue.venueWithAddress && <li>{cleanVenue.venueWithAddress}</li>}
                    {cleanVenue.cityState && <li>{cleanVenue.cityState}</li>}
                  </ul>
                </div>
                <div className="rounded-2xl border border-secondary dark:border-secondary bg-white dark:bg-gray-800 p-8 shadow-[var(--shadow-lg)] transition-transform hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-lg)' }}>
                  <h3 className="mb-4 type-h3 text-gray-800 dark:text-gray-100">{detailsNode.receptionTitle}</h3>
                  <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                    {detailsNode.receptionTime && <li>{detailsNode.receptionTime}</li>}
                    {detailsNode.receptionDetails && <li>{detailsNode.receptionDetails}</li>}
                    {detailsNode.receptionAttire && <li>{detailsNode.receptionAttire}</li>}
                  </ul>
                </div>
              </div>
            </motion.section>
          </div>
        );
      }
      case 'accommodations': {
        const accNode = logisticsNodes.find(n => n.title?.includes('Accommodations') || n.description?.includes('hotel'));
        const isAttractionsEnabled = isFeatureEnabled('attractions', config.modules);
        const hotelAttractions = isAttractionsEnabled
          ? attractions.filter(isHotelRecommendation)
          : [];
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-5xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="type-h2 text-primary">{accNode?.title || feature.title || 'Accommodations'}</h2>
            {accNode?.description && (
              <p className="mx-auto max-w-xl type-body">{accNode.description}</p>
            )}
            {hotelAttractions.length > 0 ? (
              <div
                className={
                  hotelAttractions.length === 1
                    ? 'mx-auto max-w-md text-left'
                    : 'mx-auto grid max-w-5xl gap-8 text-left md:grid-cols-2'
                }
              >
                {hotelAttractions.map((hotel) => (
                  <ThingsToDoCard
                    key={hotel.id || hotel.name}
                    attraction={hotel}
                    venueCoords={{
                      latitude: config.latitude,
                      longitude: config.longitude,
                    }}
                  />
                ))}
              </div>
            ) : !accNode?.description ? (
              <div className="text-center text-gray-600 dark:text-gray-300">Accommodation details coming soon...</div>
            ) : null}
          </motion.section>
        );
      }
      case 'venue': {
        const venueDisplayName = isNonPlaceholderVenueText(config.venueName)
          ? config.venueName.trim()
          : '';
        const venueStreetLine = formatVenueStreetAddress(config);
        const fullVenueLocation = formatFullVenueLocation(config);
        const venueDirectionsUrl = resolveDirectionsUrl({
          latitude: config.latitude,
          longitude: config.longitude,
          directions: fullVenueLocation,
        });
        const hasVenueLocationSummary = Boolean(
          venueDisplayName || venueStreetLine || venueDirectionsUrl
        );
        const venueParagraphs = splitParagraphs(cleanOptionalSetupText(config.venueDescription));

        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="type-h2 text-primary">{feature.title || 'About Our Venue'}</h2>
            {hasVenueLocationSummary && (
              <div
                data-testid="venue-location-summary"
                className="mx-auto max-w-xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-[var(--shadow-md)] space-y-3"
                style={{ boxShadow: 'var(--shadow-md)' }}
              >
                {venueDisplayName && (
                  <h3 className="type-h3 text-gray-900 dark:text-gray-100">{venueDisplayName}</h3>
                )}
                {venueStreetLine && (
                  <p className="type-body text-gray-700 dark:text-gray-300">{venueStreetLine}</p>
                )}
                {venueDirectionsUrl && (
                  <div className="pt-1">
                    <AccessibleExternalLink
                      href={venueDirectionsUrl}
                      srContext={`to ${venueDisplayName || venueStreetLine || 'wedding venue'}`}
                      className="btn-secondary inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 min-h-11 min-w-11 font-semibold"
                    >
                      <Icon name="MapPin" className="h-5 w-5" />
                      Get Directions
                    </AccessibleExternalLink>
                  </div>
                )}
              </div>
            )}
            {venueParagraphs.length > 0 ? (
              venueParagraphs.map((paragraph, i) => (
                <p key={i} className="mx-auto max-w-xl type-body">{paragraph}</p>
              ))
            ) : !hasVenueLocationSummary ? (
              <div className="text-center text-gray-600 dark:text-gray-300">Venue details coming soon...</div>
            ) : null}
          </motion.section>
        );
      }
      case 'travel': {
        const travelParagraphs = splitParagraphs(cleanOptionalSetupText(config.travelAdvice));
        const travelNodes = logisticsNodes.filter(n => !n.ceremonyTitle && !n.title?.includes('Accommodations'));
        const hasTravelContent = travelParagraphs.length > 0 || travelNodes.length > 0;
        const isAttractionsEnabled = isFeatureEnabled('attractions', config.modules);
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="type-h2 text-primary">{feature.title || 'Travel & Things to Do'}</h2>
            {travelParagraphs.length > 0 && (
              <div className="space-y-4">
                {travelParagraphs.map((paragraph, i) => (
                  <p key={i} className="mx-auto max-w-2xl type-body whitespace-pre-line">{paragraph}</p>
                ))}
              </div>
            )}
            {travelNodes.length > 0 && (
              <div className="space-y-4">
                {travelNodes.map((node: any, i: number) => (
                  <Interactive3DCard as="article" key={i} className="mt-4">
                    <div className="text-left bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-[var(--shadow-lg)] border border-primary dark:border-primary h-full" style={{ boxShadow: 'var(--shadow-lg)' }}>
                      {node.title && <h3 className="type-h3 mb-2 text-primary [transform:translateZ(10px)]">{node.title}</h3>}
                      {node.description && <p className="type-body [transform:translateZ(10px)]">{node.description}</p>}
                    </div>
                  </Interactive3DCard>
                ))}
              </div>
            )}
            {!hasTravelContent && (
              <div className="text-center text-gray-600 dark:text-gray-300">Travel details coming soon...</div>
            )}
            {isAttractionsEnabled && (
              <div className="pt-2">
                <Link
                  href="/things-to-do"
                  className="btn-secondary inline-flex items-center gap-2 rounded-full px-6 py-3"
                >
                  <Icon name="MapPin" className="h-5 w-5" />
                  Explore Local Guide &amp; Things to Do
                </Link>
              </div>
            )}
          </motion.section>
        );
      }
      case 'faq':
        if (visibleFaqNodes.length === 0 && !isAdminPreview) {
          return null;
        }
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary mb-8">{feature.title || 'Questions You Probably Have'}</h2>
            {visibleFaqNodes.length === 0 && isAdminPreview ? (
              <div
                data-testid="faq-admin-preview-empty"
                className="rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30 p-6 text-center space-y-2"
              >
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Preview Only — Hidden from Public Guests
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Add at least one visible FAQ in the Content Hub to publish this section on your live homepage.
                </p>
              </div>
            ) : (
              <FaqAccordion faqs={visibleFaqNodes as FAQItemInput[]} />
            )}
          </motion.section>
        );
      case 'custom':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary">{feature.title}</h2>
            {feature.content?.split('\n\n').map((paragraph: string, i: number) => (
              <p key={i} className="type-body">{paragraph}</p>
            ))}
          </motion.section>
        );
      default:
        return null;
    }
  };

  const weddingDateObj = new Date(config.weddingDate);
  const hasValidWeddingDate = !isNaN(weddingDateObj.getTime());
  const calendarEvent = formatScheduleEventToCalendarEvent(
    {
      title: resolvedHeroTitle || 'Wedding',
      startTime: hasValidWeddingDate ? weddingDateObj.toISOString() : undefined,
      endTime: hasValidWeddingDate
        ? new Date(weddingDateObj.getTime() + 6 * 60 * 60 * 1000).toISOString()
        : undefined,
      location: formatFullVenueLocation(config),
      description: resolvedHeroSubtitle || defaultHeroSubtitle,
    },
    undefined,
    config.timezone
  );

  const rawHeroBgUrl = config.heroImageUrl || (presetTokens['--brand-hero-image'] && presetTokens['--brand-hero-image'] !== 'none' ? presetTokens['--brand-hero-image'] : undefined);
  const safeHeroBgStyle = getSafeBackgroundImageStyle(rawHeroBgUrl);
  const safeWatermarkUrl = sanitizeUrl(config.brandWatermarkUrl);
  const safeBadgeUrl = sanitizeUrl(config.badgeGraphicUrl);

  return (
    <>
      <div id="top" />
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-primary selection:text-[var(--color-text-on-primary)] dark:selection:bg-primary"
      >
        <div id="home-main">
          <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
            {safeHeroBgStyle && (
              <div
                className="absolute inset-0 z-0 bg-cover bg-center opacity-25 pointer-events-none"
                style={{ backgroundImage: safeHeroBgStyle }}
                aria-hidden="true"
              />
            )}
            {safeWatermarkUrl && (
              <MediaImage
                src={safeWatermarkUrl}
                alt={config.brandWatermarkAlt || ''}
                aria-hidden={!config.brandWatermarkAlt}
                className="absolute bottom-6 right-6 h-16 w-auto opacity-30 pointer-events-none object-contain z-0"
              />
            )}
            <div className="relative z-10 flex flex-col items-center justify-center max-w-4xl mx-auto">
              {safeBadgeUrl && (
                <MediaImage
                  src={safeBadgeUrl}
                  alt={config.badgeGraphicAlt || ''}
                  aria-hidden={!config.badgeGraphicAlt}
                  className="mb-6 h-16 w-auto object-contain"
                />
              )}
              <motion.h1 className="mb-6 type-display text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary" variants={fadeUp} initial="hidden" animate="visible" custom={0}>
                {resolvedHeroTitle}
              </motion.h1>
              <motion.p className="mb-4 type-body" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
                {resolvedHeroSubtitle}
              </motion.p>
              {config.showCountdown && isFeatureEnabled('countdown', config.modules) && (
                <motion.div className="mb-8 text-2xl font-semibold text-primary" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
                  <Countdown targetDate={weddingDateObj.toISOString()} />
                </motion.div>
              )}
              <motion.nav aria-label="Primary navigation" role="navigation" className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={3}>
                <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-primary bg-gradient-to-r from-primary to-secondary px-8 py-3 text-white visited:text-white shadow-lg transition hover:shadow-xl">
                  Our Story
                  <Icon name="ChevronDown" className="h-5 w-5 transition-transform group-hover:translate-y-1" />
                </a>
                {isFeatureEnabled('gallery', config.modules) && (
                  <Link href="/photos" className="group inline-flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 px-8 py-3 text-gray-800 visited:text-gray-800 dark:text-gray-100 dark:visited:text-gray-100 shadow-lg transition hover:shadow-xl">
                    View Photos
                  </Link>
                )}
              </motion.nav>
              {config.showAddToCalendar && isFeatureEnabled('addToCalendar', config.modules) && (
                <motion.div className="mt-8" variants={fadeUp} initial="hidden" animate="visible" custom={4}>
                  <AddToCalendar event={calendarEvent} />
                </motion.div>
              )}
            </div>
          </section>

          {features.map((feature, index) => renderSection(feature, index + 3))}
        </div>
        <BackToTop />
      </div>
    </>
  );
}
