'use client'

import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import LoadingScreen from '@/components/LoadingScreen'
import AddToCalendar, { CalendarEvent } from '@/components/AddToCalendar'
import Gallery, { GalleryImage } from '@/components/Gallery'
import StickyHeader from '@/components/StickyHeader'
import BackToTop from '@/components/BackToTop'

/* ----------------------------- Dynamic imports ---------------------------- */
const WeddingIntro = dynamic<{ onFinish?: () => void }>(() => import('@/components/WeddingIntro'), { ssr: false, loading: () => <LoadingScreen /> })

const fadeUp = { hidden: { opacity: 0, y: 40 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 * i, duration: 0.8 } }) }

export default function HomePageClient({
  galleryImages,
  calendarEvent,
  children,
}: {
  galleryImages: GalleryImage[]
  calendarEvent: CalendarEvent
  children: React.ReactNode
}) {
  const [showIntro, setShowIntro] = useState(false)
  useEffect(() => {
    setShowIntro(true)
  }, [])

  return (
    <>
      {showIntro && <WeddingIntro onFinish={() => setShowIntro(false)} />}
      <div id="top" />
      <StickyHeader />
      <div className={`min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-100 selection:text-rose-900 dark:selection:bg-rose-800`}>
        <main id="main">
          <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
            <motion.div
              className="absolute inset-0 -z-10 bg-[radial-gradient(800px_circle_at_50%_50%,rgba(190,18,60,0.06),transparent)]"
              animate={{ scale: [1, 1.04, 1], opacity: [0.7, 0.5, 0.7] }}
              transition={{ duration: 14, repeat: Infinity, repeatType: 'reverse' }}
            />
            <motion.div className="mb-8" variants={fadeUp} initial="hidden" animate="visible" custom={-1}>
              <Gallery images={galleryImages} />
            </motion.div>
            <motion.h1
              className="mb-6 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-700 to-amber-500 sm:text-6xl lg:text-7xl"
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              custom={0}
            >
              Abbigayle &amp; Frederick&apos;s Wedding
            </motion.h1>
            <motion.p className="mb-8 text-lg font-medium sm:text-xl" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
              Join us for our wedding on October&nbsp;10,&nbsp;2025, in Rochester, Minnesota.
            </motion.p>
            <motion.div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
              <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
                Our Story
                <ChevronDown className="h-5 w-5 transition-transform group-hover:translate-y-1" />
              </a>
              <a href="/registry" className="inline-block rounded-full border border-rose-600 dark:border-rose-400 px-8 py-3 font-medium text-rose-700 dark:text-rose-400 transition-colors hover:bg-rose-50 dark:hover:bg-gray-800">
                Registry
              </a>
              <AddToCalendar event={calendarEvent} />
            </motion.div>
          </section>
          {children}
        </main>
        <BackToTop />
      </div>
    </>
  )
}
