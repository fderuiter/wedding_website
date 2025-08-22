import React from 'react';
import { Metadata } from 'next';
import HomePageClient from './HomePageClient';
import { CalendarEvent } from '@/components/AddToCalendar';
import AddToCalendar from '@/components/AddToCalendar';
import AnimatedSection from '@/components/AnimatedSection';
import Gallery, { GalleryImage } from '@/components/Gallery';
import Link from 'next/link';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: "Abbigayle & Frederick's Wedding",
  startDate: '2025-10-10T16:00:00-05:00',
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
  organizer: { '@type': 'Person', name: 'Frederick de Ruiter', url: 'https://github.com/fderuiter/wedding_website' },
};

export const metadata: Metadata = {
  title: "Home",
  alternates: {
    canonical: '/',
  },
  other: {
    'application/ld+json': JSON.stringify(jsonLd),
  },
};

const calendarEvent: CalendarEvent = {
  name: jsonLd.name,
  startDate: '2025-10-10',
  startTime: '16:00',
  endDate: '2025-10-10',
  endTime: '22:00',
  timeZone: 'America/Chicago',
  location: 'Plummer House, 1091 Plummer Ln SW, Rochester, MN',
  description: jsonLd.description,
};

const galleryImages: GalleryImage[] = [
  { src: '/images/sunset-embrace.jpg', alt: 'Abbi and Fred hug on a lakeside path at sunset, framed by twisting bare branches and a glowing orange sky.' },
  { src: '/images/jogging-buddies.jpg', alt: 'Sweaty but smiling, Abbi and Fred snap a post-run selfie on a sunny sidewalk beside a brick building.' },
  { src: '/images/winter-warmth.jpg', alt: 'Bundled in winter layers, Abbi and Fred pose against a brick wall—she in leopard-trimmed coat and hat, he in a dark jacket—both beaming.' },
  { src: '/images/sunset-kiss.jpg', alt: 'Abbi and Fred share a quiet kiss at sunset beneath leafless tree silhouettes, golden light reflecting off the lake behind them.' },
  { src: '/images/timberwolves.jpg', alt: 'Abbi and Fred smile from their seats at a packed Timberwolves basketball game, sporting team gear and surrounded by excited fans.' },
  { src: '/images/twins-wins.jpg', alt: 'Abbi and Fred grin for a selfie with Target\u202fField and a cheering Minnesota Twins crowd spread out behind them.' },
  { src: '/images/post-graduation-celebration.jpg', alt: 'Dressed up for the evening, Fred in a crisp white shirt hugs Abbi in a black dress as they smile warmly against a simple light backdrop.' },
];

export default function HomePage() {
  return (
    <HomePageClient galleryImages={galleryImages} calendarEvent={calendarEvent}>
      <AnimatedSection id="story" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" custom={0}>
        <h2 className="text-center text-4xl font-bold text-rose-700">Our Story</h2>
        <p className="text-lg leading-relaxed">
          It all began with a swipe right on a cool evening in 2024. Abbi was drawn to Fred&apos;s adventurous spirit, while Fred was captivated by Abbi&apos;s warm smile and shared love for hotdogs. Our first date involved Fred plugging the laser loon and ended with hours of conversation that felt like minutes.
        </p>
        <p className="text-lg leading-relaxed">
          Since then, we&apos;ve built a life filled with laughter, shared dreams, and countless adventures. From exploring parks to cozy nights in binge-watching our favorite shows, we&apos;ve collected countless miles on the odometer, concert stubs, a few wolves tickets, and a growing library of inside jokes. We&apos;ve supported each other through thick and thin, celebrating milestones like Abbi&apos;s graduation as a Nurse Practitioner, and learned that home isn&apos;t just a place, but a feeling we find in each other.
        </p>
        <p className="text-lg leading-relaxed">
          As we all were saying goodbye to 2024 and bringing in 2025, Fred recreated our very first date together in downtown Minneapolis. While the ball had just dropped, Fred asked Abbi to be his forever adventure partner, starting the new year right. Through happy tears, she said yes! Now, we&apos;re eagerly counting down the days until we say &quot;I do&quot; surrounded by the people we love most. We are so excited to celebrate our love and begin our next chapter with you at our Plummer House wedding.
        </p>
      </AnimatedSection>
      <AnimatedSection id="details" className="px-4 py-20 sm:px-6 lg:px-8" custom={1}>
        <h2 className="text-center text-4xl font-bold text-rose-700 mb-10">Wedding Details</h2>
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
              <li>Buffet dinner begins at 5:30&nbsp;pm</li>
              <li>Cocktails with music if weather permits</li>
              <li>Attire: Garden formal</li>
            </ul>
          </div>
        </div>
        <div className="mt-14 flex justify-center">
          <AddToCalendar event={calendarEvent} />
        </div>
      </AnimatedSection>
      <AnimatedSection id="accommodations" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" custom={1.5}>
        <h2 className="text-4xl font-bold text-rose-700">Accommodations in Rochester, MN</h2>
        <p className="mx-auto max-w-xl text-lg">
          Rochester offers plenty of places to stay for our wedding weekend. We opted not to reserve a block so you can choose what fits your style and budget. For a luxurious stay, consider the{' '}
          <a href="https://www.hilton.com/en/hotels/rstmnhh-hilton-rochester-mayo-clinic-area/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
            Hilton Rochester Mayo Clinic Area
          </a>{' '}
          or the{' '}
          <a href="https://www.broadwayplazarochester.com/" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
            Broadway Plaza
          </a>
          . For more budget-friendly options, there are many comfortable motels in the area. Your favorite booking site will have the best deals for hotels in Rochester.
        </p>
      </AnimatedSection>
      <AnimatedSection id="venue" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" custom={1.6}>
        <h2 className="text-4xl font-bold text-rose-700">About Our Venue</h2>
        <p className="mx-auto max-w-xl text-lg">
          Our wedding will be held at the beautiful Plummer House, a historic English Tudor mansion that was the former home of Dr. Henry Stanley Plummer, a key figure in the history of the Mayo Clinic, and his wife, Daisy. Originally known as &quot;Quarry Hill,&quot; the house was filled with innovations for its time and is a cherished landmark in Rochester. We are so excited to share this special place with you.
        </p>
      </AnimatedSection>
      <AnimatedSection id="travel" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" custom={1.7}>
        <h2 className="text-4xl font-bold text-rose-700">Travel & Things to Do in Rochester</h2>
        <p className="mx-auto max-w-xl text-lg">
          For our guests flying in, you can fly into Rochester International Airport (RST) for a quick trip, or Minneapolis-Saint Paul International Airport (MSP) if you don&rsquo;t mind a scenic 90-minute drive. There is ample parking at the Plummer House for the wedding ceremony and reception.
        </p>
        <p className="mx-auto max-w-xl text-lg mt-4">
          While you&apos;re in town, we recommend visiting the{' '}
          <a href="https://www.mayoclinic.org/about-mayo-clinic" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
            Mayo Clinic campus
          </a>{' '}
          to see the beautiful architecture and its world-renowned art collection. A highlight of the campus is the Plummer Building (not to be confused with the Plummer House where our wedding is located!), a National Historic Landmark. Atop the Plummer Building is the famous 56-bell Carillon of Mayo, one of the largest musical instruments of its kind. You can often hear its beautiful music throughout downtown Rochester. We also recommend taking a stroll through{' '}
          <a href="https://www.rochestermn.gov/government/departments/parks-and-recreation/parks-trails/silver-lake-park" target="_blank" rel="noopener noreferrer" className="text-rose-600 dark:text-rose-400 hover:underline">
            Silver Lake Park
          </a>{' '}
          or exploring the many great restaurants and breweries in the city.
        </p>
      </AnimatedSection>
      <AnimatedSection id="faq" className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-6 lg:px-8" custom={1.9}>
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
      </AnimatedSection>
      <AnimatedSection id="registry" className="mx-auto max-w-3xl space-y-8 px-4 py-20 text-center sm:px-6 lg:px-8" custom={2}>
        <h2 className="text-4xl font-bold text-rose-700">Wedding Registry</h2>
        <p className="mx-auto max-w-xl text-lg">Your presence at our wedding is the greatest gift, but if you’d like to help us feather our first nest, you can view our wedding registry.</p>
        <a href="/registry" className="inline-block rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-10 py-4 font-medium text-white shadow-lg transition hover:scale-105 hover:shadow-xl">
          View Wedding Registry
        </a>
      </AnimatedSection>
      <AnimatedSection className="py-10" custom={2.1}>
        <Gallery images={galleryImages} />
      </AnimatedSection>
      <footer className="flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-500 dark:text-gray-400">
        <p>© {new Date().getFullYear()} Abbigayle & Frederick • Designed with ❤️ in Minnesota</p>
        <a href="/project-info" className="text-rose-600 dark:text-rose-400 hover:underline">
          About this site
        </a>
        <Link href="/heart" className="inline-block rounded-full bg-gradient-to-r from-amber-500 to-rose-700 px-10 py-4 font-medium text-white shadow-lg transition hover:scale-105 hover:shadow-xl">
          Play with the Heart
        </Link>
      </footer>
    </HomePageClient>
  );
}
