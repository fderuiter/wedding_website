'use client'

import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import AddToCalendar, { CalendarEvent } from '@/components/AddToCalendar'
import Link from 'next/link'
import BackToTop from '@/components/BackToTop'
import Countdown from '@/components/Countdown'

/* ----------------------------- Dynamic imports ---------------------------- */
const WeddingIntro = dynamic<{ onFinish?: () => void }>(() => import('@/components/WeddingIntro'), { ssr: false })

/**
 * Framer Motion variant for a fade-up animation.
 * @type {{hidden: {opacity: number, y: number}, visible: (function(number): {opacity: number, y: number, transition: {delay: number, duration: number}})}}
 */
const fadeUp = { hidden: { opacity: 0, y: 40 }, visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.15 * i, duration: 0.8 } }) }

/**
 * @function HomePageClient
 * @description The main client component for the home page.
 * It handles the display of the wedding intro animation for first-time visitors
 * and renders the main content of the home page.
 * @param {object} props - The component props.
 * @param {CalendarEvent} props.calendarEvent - The event details for the "Add to Calendar" button.
 * @returns {JSX.Element | null} The rendered HomePageClient component, or null while checking visitor status.
 */
export default function HomePageClient({ calendarEvent }: { calendarEvent: CalendarEvent }) {
  const [hasVisited, setHasVisited] = useState<boolean | null>(null);
  const [introPlayed, setIntroPlayed] = useState(false);

  useEffect(() => {
    const visited = localStorage.getItem('hasVisited');
    if (visited) {
      setHasVisited(true);
    } else {
      localStorage.setItem('hasVisited', 'true');
      setHasVisited(false);
    }
  }, []);

  const introFinished = hasVisited || introPlayed;

  if (hasVisited === null) {
    return null; // Or a loading spinner
  }

  return (
    <>

      <div id="top" />
      <div className={`min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-100 selection:text-rose-900 dark:selection:bg-rose-800 ${!introFinished ? '' : ''}`}
      >
        <main id="main">
          <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-28 text-center sm:px-6 lg:px-8">
            <motion.div className="absolute inset-0 -z-10 bg-[radial-gradient(800px_circle_at_50%_50%,rgba(190,18,60,0.06),transparent)]" animate={{ scale: [1, 1.04, 1], opacity: [0.7, 0.5, 0.7] }} transition={{ duration: 14, repeat: Infinity, repeatType: 'reverse' }} />
            <motion.h1 className="mb-6 text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-700 to-amber-500 sm:text-6xl lg:text-7xl" variants={fadeUp} initial="hidden" animate="visible" custom={0}>
              We Tied the Knot!
            </motion.h1>
            <motion.p className="mb-4 text-lg font-medium sm:text-xl" variants={fadeUp} initial="hidden" animate="visible" custom={1}>
              Thank you for celebrating with us on October&nbsp;10,&nbsp;2025, in Rochester, Minnesota. We&apos;re so grateful for all the love and support from our family and friends.
            </motion.p>
            <motion.div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6" variants={fadeUp} initial="hidden" animate="visible" custom={2}>
              <a href="#story" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
                Our Story
                <ChevronDown className="h-5 w-5 transition-transform group-hover:translate-y-1" />
              </a>
              <Link href="/photos" className="group inline-flex items-center gap-2 rounded-full bg-white dark:bg-gray-800 px-8 py-3 text-gray-800 dark:text-gray-100 shadow-lg transition hover:shadow-xl">
                View Photos
              </Link>
            </motion.div>
          </section>
          <motion.section id="story" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
            <h2 className="text-center text-4xl font-bold text-rose-700">Our Story</h2>
            <p className="text-lg leading-relaxed">It all began with a swipe right on a cool evening in 2024. Abbi was drawn to Fred&apos;s adventurous spirit, while Fred was captivated by Abbi&apos;s warm smile and shared love for hotdogs. Our first date involved Fred plugging the laser loon and ended with hours of conversation that felt like minutes.</p>
            <p className="text-lg leading-relaxed">Since then, we&apos;ve built a life filled with laughter, shared dreams, and countless adventures. From exploring parks to cozy nights in binge-watching our favorite shows, we&apos;ve collected countless miles on the odometer, concert stubs, a few wolves tickets, and a growing library of inside jokes. We&apos;ve supported each other through thick and thin, celebrating milestones like Abbi&apos;s graduation as a Nurse Practitioner, and learned that home isn&apos;t just a place, but a feeling we find in each other.</p>
            <p className="text-lg leading-relaxed">As we all were saying goodbye to 2024 and bringing in 2025, Fred recreated our very first date together in downtown Minneapolis. While the ball had just dropped, Fred asked Abbi to be his forever adventure partner, starting the new year right. Through happy tears, she said yes! We were so excited to celebrate our love and begin our next chapter with you at our Plummer House wedding.</p>
          </motion.section>
          <motion.section id="details" className="px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1}>
            <h2 className="text-center text-4xl font-bold text-rose-700 mb-10">Wedding Day Details</h2>
            <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
              <div className="rounded-2xl border border-rose-100 dark:border-rose-700 bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">Wedding Ceremony</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>4:00&nbsp;pm</li>
                  <li>Plummer House · 1091 Plummer Ln SW</li>
                  <li>Rochester, Minnesota</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 p-8 shadow-lg transition-transform hover:scale-[1.02]">
                <h3 className="mb-4 text-2xl font-semibold text-gray-800 dark:text-gray-100">Wedding Reception</h3>
                <ul className="space-y-2 text-gray-800 dark:text-gray-100">
                  <li>Buffet dinner began at 5:30&nbsp;pm</li>
                  <li>Cocktails with music if weather permitted</li>
                  <li>Attire: Garden formal</li>
                </ul>
              </div>
            </div>
          </motion.section>
          <motion.section id="accommodations" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.5}>
            <h2 className="text-4xl font-bold text-rose-700">Accommodations in Rochester, MN</h2>
            <p className="mx-auto max-w-xl text-lg">Rochester offers plenty of places to stay for our wedding weekend. We opted not to reserve a block so you can choose what fits your style and budget. For a luxurious stay, consider the <a href="https://www.hilton.com/en/hotels/rstmahh-hilton-rochester-mayo-clinic-area/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">Hilton Rochester Mayo Clinic Area</a> or the <a href="https://rochesterbroadwayplaza.com/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">Broadway Plaza</a>. For more budget-friendly options, there are many comfortable motels in the area. Your favorite booking site will have the best deals for hotels in Rochester.</p>
          </motion.section>
          <motion.section id="venue" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.6}>
            <h2 className="text-4xl font-bold text-rose-700">About Our Venue</h2>
            <p className="mx-auto max-w-xl text-lg">Our wedding will be held at the beautiful Plummer House, a historic English Tudor mansion that was the former home of Dr. Henry Stanley Plummer, a key figure in the history of the Mayo Clinic, and his wife, Daisy. Originally known as <a href="https://mngardens.horticulture.umn.edu/plummer-house-arts-gardens" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">&quot;Quarry Hill,&quot;</a> the house was filled with innovations for its time and is a cherished landmark in Rochester. We are so excited to share this special place with you.</p>
          </motion.section>
          <motion.section id="travel" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.7}>
            <h2 className="text-4xl font-bold text-rose-700">Travel & Things to Do in Rochester</h2>
            <p className="mx-auto max-w-xl text-lg">For our guests flying in, you can fly into Rochester International Airport (RST) for a quick trip, or Minneapolis-Saint Paul International Airport (MSP) if you don&rsquo;t mind a scenic 90-minute drive. There is ample parking at the Plummer House for the wedding ceremony and reception.</p>
            <p className="mx-auto max-w-xl text-lg mt-4">While you&apos;re in town, we recommend visiting the <a href="https://www.mayoclinic.org/patient-visitor-guide/minnesota" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">Mayo Clinic campus</a> to see the beautiful architecture and its world-renowned art collection. A highlight of the campus is the Plummer Building (not to be confused with the Plummer House where our wedding is located!), a National Historic Landmark. Atop the Plummer Building is the famous 56-bell Carillon of Mayo, one of the largest musical instruments of its kind. You can often hear its beautiful music throughout downtown Rochester. We also recommend taking a stroll through <a href="https://www.rochestermn.gov/Home/Components/FacilityDirectory/FacilityDirectory/138/1258" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">Silver Lake Park</a> or exploring the many great restaurants and breweries in the city.</p>
          </motion.section>
          <motion.section id="faq" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={1.9}>
            <h2 className="text-center text-4xl font-bold text-rose-700">Questions You Probably Have</h2>
            <div className="space-y-4 text-left">
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
            </div>
          </motion.section>
          <footer className="flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-500 dark:text-gray-400">
            <p>© {new Date().getFullYear()} Abbigayle & Frederick • Designed with ❤️ in Minnesota</p>
            <p>Stay tuned for more updates from our lives together!</p>
            <a href="/project-info" className="text-rose-600 dark:text-rose-400 hover:underline">About this site</a>
            <Link
              href="/heart"
              className="inline-block rounded-full bg-gradient-to-r from-amber-500 to-rose-700 px-10 py-4 font-medium text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
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
