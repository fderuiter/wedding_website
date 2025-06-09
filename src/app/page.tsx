// HomePage.tsx – single‑page wedding site with studio‑grade consistency
// -----------------------------------------------------------------------------
'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import LoadingScreen from '@/components/LoadingScreen'

/* ----------------------------- Dynamic imports ---------------------------- */
const WeddingIntro = dynamic<{ onFinish?: () => void }>(() => import('@/components/WeddingIntro'), { ssr: false, loading: () => <LoadingScreen /> })
const AddToCalendarButtonClient = dynamic(() => import('add-to-calendar-button-react').then((m) => m.AddToCalendarButton), { ssr: false })

/* -------------------------------------------------------------------------- */
/*                                  Palette                                   */
/* -------------------------------------------------------------------------- */
// Elegant neutrals + rose accent
const COLORS = {
  text: '#374151', // gray‑700
  heading: '#be123c', // rose‑700
  accentFrom: '#be123c', // rose‑700
  accentTo: '#f59e0b', // amber‑500
  bg: '#fffdfc',
}

/* -------------------------------------------------------------------------- */
/*                                  JSON‑LD                                   */
/* -------------------------------------------------------------------------- */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: "Abbigayle & Frederick's Wedding",
  startDate: '2025-10-10T15:00:00-05:00',
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
  organizer: { '@type': 'Person', name: 'Frederick de', url: '*   https://github.com/fderuiter/wedding_website' },
}

const fadeUp = { hidden: { opacity: 0, y: 40 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 * i, duration: 0.8 } }) }

/* -------------------------------------------------------------------------- */
export default function HomePage() {
  const [showIntro, setShowIntro] = useState(true)
  if (showIntro) return <WeddingIntro onFinish={() => setShowIntro(false)} />

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Global wrapper provides consistent background */}
      <div className="min-h-screen bg-[${COLORS.bg}] text-[${COLORS.text}] selection:bg-rose-100 selection:text-rose-900">
        {/* -------------------------------------------------------------- */}
        {/* Hero                                                          */}
        {/* -------------------------------------------------------------- */}
        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
          {/* Subtle radial for depth */}
          <motion.div className="absolute inset-0 -z-10 bg-[radial-gradient(800px_circle_at_50%_50%,rgba(190,18,60,0.06),transparent)]" animate={{ scale: [1, 1.04, 1], opacity: [0.7, 0.5, 0.7] }} transition={{ duration: 14, repeat: Infinity, repeatType: 'reverse' }} />

          <motion.h1 className="mb-6 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-700 to-amber-500 sm:text-6xl lg:text-7xl" variants={fadeUp} initial="hidden" animate="visible" custom={0}>
            Abbi&nbsp;&amp;&nbsp;Fred
          </motion.h1>
          <motion.p className="mb-8 text-lg font-medium sm:text-xl" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
            October&nbsp;10,&nbsp;2025 • Rochester, Minnesota
          </motion.p>
          <motion.div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
            <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
              Our Story
              <ChevronDown className="h-5 w-5 transition-transform group-hover:translate-y-1" />
            </a>
            <a href="/registry" className="inline-block rounded-full border border-rose-600 px-8 py-3 font-medium text-rose-700 transition-colors hover:bg-rose-50">
              Registry
            </a>
          </motion.div>
        </section>

        {/* -------------------------------------------------------------- */}
        {/* Story                                                         */}
        {/* -------------------------------------------------------------- */}
        <motion.section id="story" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
          <h2 className="text-center text-4xl font-bold text-rose-700">Our Story</h2>
          <p className="text-lg leading-relaxed">It all began with a swipe right on a cool evening in 2024. Abbi was drawn to Fred&apos;s adventurous spirit, while Fred was captivated by Abbi&apos;s warm smile and shared love for hotdogs. Our first date involved Fred plugging the laser loon and ended with hours of conversation that felt like minutes.</p>
          <p className="text-lg leading-relaxed">Since then, we&apos;ve built a life filled with laughter, shared dreams, and countless adventures. From exploring parks to cozy nights in binge-watching our favorite shows, we&apos;ve collected countless miles on the odometer, concert stubs, a few wolves tickets, and a growing library of inside jokes. We&apos;ve supported each other through thick and thin, celebrated milestones such as Abbi&apos;s DNP graduation, and learned that home isn&apos;t just a place, but a feeling we find in each other.</p>
          <p className="text-lg leading-relaxed">As we all were saying goodbye to 2024 and bringing in 2025, Fred recreated our very first date together in downtown Minneaplis. While the ball had just dropped, Fred asked Abbi to be his forever adventure partner, starting the new year right. Through happy tears, she said yes! Now, we&apos;re eagerly counting down the days until we say &quot;I do&quot; surrounded by the people we love most.</p>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* Details                                                       */}
        {/* -------------------------------------------------------------- */}
        <motion.section className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1}>
          <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
            {/* Ceremony */}
            <div className="rounded-2xl border border-rose-100 bg-white p-8 shadow-lg transition-transform hover:scale-[1.02]">
              <h3 className="mb-4 text-2xl font-semibold text-black">Ceremony</h3>
              <ul className="space-y-2 text-black">
                <li>TBD</li>
                <li>Plummer House · 1091 Plummer Ln SW</li>
                <li>Rochester, Minnesota</li>
              </ul>
            </div>
            {/* Reception */}
            <div className="rounded-2xl border border-amber-200 bg-white p-8 shadow-lg transition-transform hover:scale-[1.02]">
              <h3 className="mb-4 text-2xl font-semibold text-black">Reception</h3>
              <ul className="space-y-2 text-black">
                <li>TBD</li>
                <li>Cocktails on the veranda followed by dinner & dancing</li>
                <li>Attire: Garden formal</li>
              </ul>
            </div>
          </div>
          <div className="mt-14 flex justify-center">
            <AddToCalendarButtonClient name={jsonLd.name} startDate="2025-10-10" startTime="15:00" endDate="2025-10-10" endTime="22:00" timeZone="America/Chicago" location="Plummer House, 1091 Plummer Ln SW, Rochester, MN" description={jsonLd.description} options={['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo']} buttonStyle="round" label="Add to Calendar" size="2" inline customCss={`:root{--btn-background:linear-gradient(135deg,${COLORS.accentFrom},${COLORS.accentTo});--btn-text:#fff}`} />
          </div>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* Accommodations                                               */}
        {/* -------------------------------------------------------------- */}
        <motion.section id="accommodations" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.5}>
          <h2 className="text-4xl font-bold text-rose-700">Where to Sleep (If You Must)</h2>
          <p className="mx-auto max-w-xl text-lg">Look, Rochester has hotels. If we get a block everyone ends up paying more in the end and stays at a worse hotel. If you want something nice, stay at the Hilton downtown or the Broadway Plaza. If you want something more affordable, look for motels. Mention our names, perhaps they&apos;ll give you a discount, perhaps they&apos;ll charge you extra. It&apos;s a gamble. Your favorite hotel booking site likely knows more than we do. Good luck.</p>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* Travel                                                       */}
        {/* -------------------------------------------------------------- */}
        <motion.section id="travel" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.7}>
          <h2 className="text-4xl font-bold text-rose-700">Getting Here (The Ordeal)</h2>
          <p className="mx-auto max-w-xl text-lg">Fly into RST if you enjoy quaint, small airports. Fly into MSP if you enjoy driving for 90 minutes after your flight. There&apos;s parking at the venue, allegedly. We assume you know how to use Google Maps. Don&apos;t call us for directions; we&apos;ll be busy.</p>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* FAQs                                                         */}
        {/* -------------------------------------------------------------- */}
        <motion.section id="faqs" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.9}>
          <h2 className="text-center text-4xl font-bold text-rose-700">Questions You Probably Have</h2>
          <div className="space-y-4 text-left">
            <div>
              <h3 className="font-semibold text-lg">What is &quot;Garden Formal&quot;?</h3>
              <p>It means look nice, but maybe don&apos;t wear stilettos unless you enjoy aerating the lawn.</p>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Can I Bring My Kids?</h3>
              <p>We love your kids! Just kidding. Please leave them at home. Consider this a date night mixed with a grad party. Graduating from our single lives that is.</p>
            </div>
            <div>
              <h3 className="font-semibold text-lg">Is there parking available?</h3>
              <p>Yes, there are 40 spots of parking available at the Plummer House.</p>
            </div>
          </div>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* Registry                                                      */}
        {/* -------------------------------------------------------------- */}
        <motion.section className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={2}>
          <h2 className="text-4xl font-bold text-rose-700">Gifts & Registry</h2>
          <p className="mx-auto max-w-xl text-lg">Your presence is the greatest gift, but if you’d like to help us feather our first nest…</p>
          <a href="/registry" className="inline-block rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-10 py-4 font-medium text-white shadow-lg transition hover:scale-105 hover:shadow-xl">View Registry</a>
        </motion.section>

        {/* -------------------------------------------------------------- */}
        {/* Footer                                                       */}
        {/* -------------------------------------------------------------- */}
        <footer className="flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-500">
          <p>© {new Date().getFullYear()} Abbigayle & Frederick • Designed with ❤️ in Minnesota</p>
          <a href="/project-info" className="text-rose-600 hover:underline">About this site</a>
        </footer>
      </div>
    </>
  )
}
