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

import { isFeatureEnabled } from '@/lib/modules';
import { useTheme } from '@/components/ThemeProvider';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { getPresetTokens, parseMotionEasing, parseDurationSec } from '@/lib/theme/presets';
import { sanitizeUrl } from '@/utils/validation';
import { MediaImage } from '@/components/MediaImage';

function getSafeBackgroundImageStyle(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  let url = rawUrl.trim();
  if (url === 'none') return undefined;
  if (url.startsWith('url(') && url.endsWith(')')) {
    url = url.slice(4, -1).trim().replace(/^['"]|['"]$/g, '');
  }
  const safe = sanitizeUrl(url);
  return safe ? `url("${safe}")` : undefined;
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
  const [draftConfig, setConfig] = useState<PublicAppConfig>(initialConfig);
  const [draftContentNodes, setContentNodes] = useState<ContentNodeDTO[]>(initialContentNodes);
  const [draftAttractions, setAttractions] = useState<AttractionDTO[]>(initialAttractions);

  const isDemoMode = Boolean(demo?.isDemoMode);
  const demoConfigOverrides = demo?.configOverrides;
  const demoLogisticsNodes = demo?.activeDataset.logisticsNodes;
  const demoFaqs = demo?.activeDataset.faqs;

  const config = useMemo<PublicAppConfig>(
    () => (isDemoMode && demoConfigOverrides ? { ...draftConfig, ...demoConfigOverrides } : draftConfig),
    [demoConfigOverrides, draftConfig, isDemoMode]
  );
  const contentNodes = useMemo<ContentNodeDTO[]>(
    () =>
      isDemoMode && demoLogisticsNodes && demoFaqs
        ? [...demoLogisticsNodes, ...demoFaqs]
        : draftContentNodes,
    [demoFaqs, demoLogisticsNodes, draftContentNodes, isDemoMode]
  );
  const attractions = isDemoMode && demo ? demo.activeDataset.attractions : draftAttractions;
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
    // Only listen for messages if inside an iframe
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE') {
          if (event.data.draftType === 'config' && event.data.draftData) {
            setConfig((prev) => ({ ...prev, ...event.data.draftData }));
          } else if (event.data.draftType === 'content' && Array.isArray(event.data.draftData)) {
            setContentNodes(event.data.draftData);
          } else if (event.data.draftType === 'attractions' && Array.isArray(event.data.draftData)) {
            setAttractions(event.data.draftData);
          }
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

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
      case 'story':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary">{feature.title || 'Our Story'}</h2>
            {config.storyText.split('\n\n').map((paragraph, i) => (
              <p key={i} className="type-body">{paragraph}</p>
            ))}
          </motion.section>
        );
      case 'details': {
        const hasStructuredSchedule = contentNodes.some(
          n => n.type === 'Schedule' || (n.type === 'Logistics' && (n.data as any)?.startTime) || (n.data as any)?.startTime
        );

        if (hasStructuredSchedule) {
          return (
            <motion.div key={feature.id} id={feature.id} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
              <InteractiveTimeline events={contentNodes} timezone={config.timezone} title={feature.title || 'Wedding Day Details'} />
            </motion.div>
          );
        }

        const detailsNode = logisticsNodes.find(n => n.ceremonyTitle);
        if (!detailsNode) return (
          <motion.section key={feature.id} id={feature.id} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
            <div className="text-center text-gray-500 dark:text-gray-400">Details coming soon...</div>
          </motion.section>
        );
        return (
          <motion.section key={feature.id} id={feature.id} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center type-h2 text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
            <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
              <div className="rounded-2xl border border-primary dark:border-primary bg-white dark:bg-gray-800 p-8 shadow-[var(--shadow-lg)] transition-transform hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-lg)' }}>
                <h3 className="mb-4 type-h3 text-gray-800 dark:text-gray-100">{detailsNode.ceremonyTitle}</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>{detailsNode.ceremonyTime}</li>
                  <li>{config.venueName} · {config.venueAddress}</li>
                  <li>{config.venueCity}, {config.venueState}</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-secondary dark:border-secondary bg-white dark:bg-gray-800 p-8 shadow-[var(--shadow-lg)] transition-transform hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-lg)' }}>
                <h3 className="mb-4 type-h3 text-gray-800 dark:text-gray-100">{detailsNode.receptionTitle}</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>{detailsNode.receptionTime}</li>
                  <li>{detailsNode.receptionDetails}</li>
                  <li>{detailsNode.receptionAttire}</li>
                </ul>
              </div>
            </div>
          </motion.section>
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
                  <ThingsToDoCard key={hotel.id || hotel.name} attraction={hotel} />
                ))}
              </div>
            ) : !accNode?.description ? (
              <div className="text-center text-gray-500 dark:text-gray-400">Accommodation details coming soon...</div>
            ) : null}
          </motion.section>
        );
      }
      case 'venue':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="type-h2 text-primary">{feature.title || 'About Our Venue'}</h2>
            {config.venueDescription.split('\n\n').map((paragraph, i) => (
              <p key={i} className="mx-auto max-w-xl type-body">{paragraph}</p>
            ))}
          </motion.section>
        );
      case 'travel': {
        const travelParagraphs = splitParagraphs(config.travelAdvice);
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
              <div className="text-center text-gray-500 dark:text-gray-400">Travel details coming soon...</div>
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
      title: config.heroTitle || 'Wedding',
      startTime: hasValidWeddingDate ? weddingDateObj.toISOString() : undefined,
      endTime: hasValidWeddingDate
        ? new Date(weddingDateObj.getTime() + 6 * 60 * 60 * 1000).toISOString()
        : undefined,
      location: `${config.venueName}, ${config.venueCity}, ${config.venueState}`,
      description: config.heroSubtitle || 'Join us for our wedding!',
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
                {config.heroTitle || 'We Tied the Knot!'}
              </motion.h1>
              <motion.p className="mb-4 type-body" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
                {config.heroSubtitle || `Thank you for celebrating with us on ${formattedDate}, in ${config.venueCity}, ${config.venueState}. We're so grateful for all the love and support from our family and friends.`}
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

          <footer className="flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-600 dark:text-gray-400">
            <p>© {new Date().getFullYear()} {config.partner1Name || config.brideName} & {config.partner2Name || config.groomName} • Designed with ❤️ in {config.venueState}</p>
            <p>Stay tuned for more updates from our lives together!</p>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <a href="/project-info" className="text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white hover:underline focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 rounded">About this site</a>
              <span aria-hidden="true" className="text-gray-400 dark:text-gray-600">•</span>
              <Link
                href="/admin/login"
                className="text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white hover:underline focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 rounded"
              >
                Admin Login
              </Link>
            </div>
            {isFeatureEnabled('interactive3D', config.modules) && (
              <Link
                href="/heart"
                className="inline-block rounded-full bg-secondary bg-gradient-to-r from-secondary to-primary px-10 py-4 font-medium text-white visited:text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
              >
                Play with the Heart
              </Link>
            )}
          </footer>
        </div>
        <BackToTop />
      </div>
    </>
  );
}
