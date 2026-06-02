'use client'

import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import AddToCalendar from '@/components/AddToCalendar'
import { CalendarEvent } from '@/utils/calendar'
import { AppConfig, ContentNode } from '@prisma/client'
import Link from 'next/link'
import BackToTop from '@/components/BackToTop'
import Countdown from '@/components/Countdown'

const fadeUp = { hidden: { opacity: 0, y: 40 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 * i, duration: 0.8 } }) }

export default function HomePageClient({ calendarEvent, config: initialConfig, contentNodes: initialContentNodes = [] }: { calendarEvent: CalendarEvent, config: AppConfig, contentNodes?: ContentNode[] }) {
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [contentNodes, setContentNodes] = useState<ContentNode[]>(initialContentNodes);

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

  const formattedDate = new Date(config.weddingDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const faqs = contentNodes.filter(n => n.type === 'FAQ').map(n => n.data as { question?: string, answer?: string });
  const logisticsNodes = contentNodes.filter(n => n.type === 'Logistics').map(n => n.data as { title?: string, description?: string });

  let features: any[] = [];
  try {
    if (typeof config.features === 'string') {
      features = JSON.parse(config.features);
    } else if (Array.isArray(config.features)) {
      features = config.features;
    }
  } catch(e) {}

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
      case 'details':
        return (
          <motion.section key={feature.id} id={feature.id} className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-center text-4xl font-bold text-primary mb-10">{feature.title || 'Wedding Day Details'}</h2>
            <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
              <div className="rounded-2xl border border-primary dark:border-primary bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">Wedding Ceremony</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>4:00&nbsp;pm</li>
                  <li>{config.venueName} · {config.venueAddress}</li>
                  <li>{config.venueCity}, {config.venueState}</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-secondary dark:border-secondary bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">Wedding Reception</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>Buffet dinner began at 5:30&nbsp;pm</li>
                  <li>Cocktails with music if weather permitted</li>
                  <li>Attire: Garden formal</li>
                </ul>
              </div>
            </div>
          </motion.section>
        );
      case 'accommodations':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{feature.title || `Accommodations in ${config.venueCity}, ${config.venueState}`}</h2>
            <p className="mx-auto max-w-xl text-lg">{config.venueCity} offers plenty of places to stay for our wedding weekend. We opted not to reserve a block so you can choose what fits your style and budget. Your favorite booking site will have the best deals for hotels in {config.venueCity}.</p>
          </motion.section>
        );
      case 'venue':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{feature.title || 'About Our Venue'}</h2>
            {config.venueDescription.split('\n\n').map((paragraph, i) => (
              <p key={i} className="mx-auto max-w-xl text-lg">{paragraph}</p>
            ))}
          </motion.section>
        );
      case 'travel':
        return (
          <motion.section key={feature.id} id={feature.id} className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={index * 0.1}>
            <h2 className="text-4xl font-bold text-primary">{feature.title || `Travel & Things to Do in ${config.venueCity}`}</h2>
            {logisticsNodes.length > 0 ? (
              logisticsNodes.map((node, i) => (
                <div key={i} className="text-left bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg mt-4 border border-primary dark:border-primary">
                  {node.title && <h3 className="font-semibold text-xl mb-2 text-primary">{node.title}</h3>}
                  {node.description && <p className="text-lg">{node.description}</p>}
                </div>
              ))
            ) : (
              config.travelAdvice.split('\n\n').map((paragraph, i) => (
                <p key={i} className="mx-auto max-w-xl text-lg mt-4">{paragraph}</p>
              ))
            )}
          </motion.section>
        );
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
                <>
                  <div>
                    <h3 className="font-semibold text-lg">What is &quot;Garden Formal&quot;?</h3>
                    <p>It means look nice, but maybe don&apos;t wear stilettos unless you enjoy aerating the lawn.</p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Can I Bring My Kids?</h3>
                    <p>We adore your little ones, but this celebration is adults only. Treat it as a date night while we toast to the next chapter of our lives.</p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Is there parking available?</h3>
                    <p>Yes, there are 40 spots of parking available at the Plummer House.</p>
                  </div>
                </>
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
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-primary selection:text-primary dark:selection:bg-primary"
      >
        <main id="main">
          <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(800px_circle_at_50%_50%,rgba(190,18,60,0.06),transparent)] animate-pulse-scale" />
            <motion.h1 className="mb-6 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary sm:text-6xl lg:text-7xl" variants={fadeUp} initial="hidden" animate="visible" custom={0}>
              {config.heroTitle || 'We Tied the Knot!'}
            </motion.h1>
            <motion.p className="mb-4 text-lg font-medium sm:text-xl" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
              {config.heroSubtitle || `Thank you for celebrating with us on ${formattedDate}, in ${config.venueCity}, ${config.venueState}. We're so grateful for all the love and support from our family and friends.`}
            </motion.p>
            <motion.div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
              <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-secondary px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
                Our Story
                <ChevronDown className="h-5 w-5 transition-transform group-hover:translate-y-1" />
              </a>
              <Link href="/photos" className="group inline-flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 px-8 py-3 text-gray-800 dark:text-gray-100 shadow-lg transition hover:shadow-xl">
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
              className="inline-block rounded-full bg-gradient-to-r from-secondary to-primary px-10 py-4 font-medium text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
            >
              Play with the Heart
            </Link>
          </footer>
        </main>
        <BackToTop />
      </div>
    </>
  )
}
