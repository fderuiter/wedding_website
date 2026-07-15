'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@/components/ui/Icon'
import type { ContentNodeDTO } from '@/features/content/schemas'
import type { PublicAppConfig } from '@/lib/config'
import Link from 'next/link'
import BackToTop from '@/components/BackToTop'
import { Interactive3DCard } from '@/components/ui/Interactive3DCard'
import { formatDate } from '@/utils/intl'

const fadeUp = { hidden: { opacity: 0, y: 40 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 * i, duration: 0.8 } }) }

/**
 * Renders the client-side wedding homepage and updates its content live when receiving cross-window draft updates.
 *
 * Renders sections (story, details, accommodations, venue, travel, faq, and custom) driven by `config` and `contentNodes`, formats the wedding date for display, and animates sections with Framer Motion. While mounted inside an iframe, listens for postMessage events of type `DRAFT_UPDATE` and merges incoming `config` updates or replaces `contentNodes` when draft data arrives.
 *
 * @param calendarEvent - Calendar event data used for calendar-related features (provided to optional calendar components).
 * @param config - Initial public application configuration used to populate page content and settings.
 * @param contentNodes - Optional initial array of CMS content nodes that drive FAQs, logistics, and custom sections.
 * @returns The rendered homepage JSX element.
 */
export default function HomePageClient({ config: initialConfig, contentNodes: initialContentNodes = [] }: { config: PublicAppConfig, contentNodes?: ContentNodeDTO[] }) {
  const [config, setConfig] = useState<PublicAppConfig>(initialConfig);
  const [contentNodes, setContentNodes] = useState<ContentNodeDTO[]>(initialContentNodes);

  useEffect(() => {
    // Only listen for messages if inside an iframe
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE') {
          if (event.data.draftType === 'config') {
            setConfig({ ...config, ...event.data.draftData });
          } else if (event.data.draftType === 'content') {
            setContentNodes(event.data.draftData);
          }
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [config]);

  const formattedDate = formatDate(config.weddingDate);

  const faqs = contentNodes
    .filter((n): n is Extract<ContentNodeDTO, { type: 'FAQ' }> => n.type === 'FAQ')
    .map(n => n.data);

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
            <h2 className="text-center text-4xl font-bold text-primary">{feature.title || 'Our Story'}</h2>
            {config.storyText.split('\n\n').map((paragraph, i) => (
              <p key={i} className="text-lg leading-relaxed">{paragraph}</p>
            ))}
          </motion.section>
        );
      case 'details': {
        const detailsNode = logisticsNodes.find(n => n.ceremonyTitle);
        if (!detailsNode) return (
          <motion.section key={feature.id} id={feature.id} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center text-4xl font-bold text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
            <div className="text-center text-gray-500">Details coming soon...</div>
          </motion.section>
        );
        return (
          <motion.section key={feature.id} id={feature.id} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center text-4xl font-bold text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
            <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
              <div className="rounded-2xl border border-primary dark:border-primary bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">{detailsNode.ceremonyTitle}</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>{detailsNode.ceremonyTime}</li>
                  <li>{config.venueName} · {config.venueAddress}</li>
                  <li>{config.venueCity}, {config.venueState}</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-secondary dark:border-secondary bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">{detailsNode.receptionTitle}</h3>
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
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{accNode?.title || feature.title || 'Accommodations'}</h2>
            {accNode?.description ? (
              <p className="mx-auto max-w-xl text-lg">{accNode.description}</p>
            ) : (
              <div className="text-center text-gray-500">Accommodation details coming soon...</div>
            )}
          </motion.section>
        );
      }
      case 'venue':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{feature.title || 'About Our Venue'}</h2>
            {config.venueDescription.split('\n\n').map((paragraph, i) => (
              <p key={i} className="mx-auto max-w-xl text-lg">{paragraph}</p>
            ))}
          </motion.section>
        );
      case 'travel': {
        const travelNodes = logisticsNodes.filter(n => !n.ceremonyTitle && !n.title?.includes('Accommodations'));
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{feature.title || 'Travel & Things to Do'}</h2>
            {travelNodes.length > 0 ? (
              travelNodes.map((node: any, i: number) => (
                <Interactive3DCard as="button" type="button" key={i} className="mt-4 focus-visible:ring-4 focus-visible:ring-primary outline-none" tabIndex={0} aria-label={node.title || 'Travel details'}>
                  <div className="text-left bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-primary dark:border-primary h-full">
                    {node.title && <h3 className="font-semibold text-xl mb-2 text-primary [transform:translateZ(10px)]">{node.title}</h3>}
                    {node.description && <p className="text-lg [transform:translateZ(10px)]">{node.description}</p>}
                  </div>
                </Interactive3DCard>
              ))
            ) : (
              <div className="text-center text-gray-500">Travel details coming soon...</div>
            )}
          </motion.section>
        );
      }
      case 'faq':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center text-4xl font-bold text-primary">{feature.title || 'Questions You Probably Have'}</h2>
            <div className="space-y-4 text-left">
              {faqs.length > 0 ? (
                faqs.map((faq, i) => (
                  <div key={i}>
                    <h3 className="font-semibold text-lg">{faq.question}</h3>
                    <p>{faq.answer}</p>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500">No FAQs available yet.</div>
              )}
            </div>
          </motion.section>
        );
      case 'custom':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center text-4xl font-bold text-primary">{feature.title}</h2>
            {feature.content?.split('\n\n').map((paragraph: string, i: number) => (
              <p key={i} className="text-lg leading-relaxed">{paragraph}</p>
            ))}
          </motion.section>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/*
        NOTE: AddToCalendar and Countdown are imported but currently unused in the layout.
        They are preserved here for future use or reference, as requested.
        To use them: <AddToCalendar event={calendarEvent} /> or <Countdown targetDate="..." />
      */}
      <div id="top" />
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-primary selection:text-[var(--color-text-on-primary)] dark:selection:bg-primary"
      >
        <div aria-label="Home Page Content" id="home-main">
          <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
            <motion.h1 className="mb-6 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary sm:text-6xl lg:text-7xl" variants={fadeUp} initial="hidden" animate="visible" custom={0}>
              {config.heroTitle || 'We Tied the Knot!'}
            </motion.h1>
            <motion.p className="mb-4 text-lg font-medium sm:text-xl" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
              {config.heroSubtitle || `Thank you for celebrating with us on ${formattedDate}, in ${config.venueCity}, ${config.venueState}. We're so grateful for all the love and support from our family and friends.`}
            </motion.p>
            <motion.div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
              <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-primary bg-gradient-to-r from-primary to-secondary px-8 py-3 text-white visited:text-white shadow-lg transition hover:shadow-xl">
                Our Story
                <Icon name="ChevronDown" className="h-5 w-5 transition-transform group-hover:translate-y-1" />
              </a>
              <Link href="/photos" className="group inline-flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 px-8 py-3 text-gray-800 visited:text-gray-800 dark:text-gray-100 dark:visited:text-gray-100 shadow-lg transition hover:shadow-xl">
                View Photos
              </Link>
            </motion.div>
          </section>

          {features.map((feature, index) => renderSection(feature, index + 3))}

          <footer className="flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-500 dark:text-gray-400">
            <p>© {new Date().getFullYear()} {config.brideName} & {config.groomName} • Designed with ❤️ in {config.venueState}</p>
            <p>Stay tuned for more updates from our lives together!</p>
            <a href="/project-info" className="text-primary dark:text-primary hover:underline">About this site</a>
            <Link
              href="/heart"
              className="inline-block rounded-full bg-secondary bg-gradient-to-r from-secondary to-primary px-10 py-4 font-medium text-white visited:text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
            >
              Play with the Heart
            </Link>
          </footer>
        </div>
        <BackToTop />
      </div>
    </>
  )
}
