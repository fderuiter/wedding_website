import React from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { Rss, Users, Map, Cloud } from 'lucide-react';

export const metadata: Metadata = {
  title: "Archive",
  alternates: {
    canonical: '/archive',
  },
};

const archivedPages = [
  {
    href: '/archive/rsvp',
    title: 'RSVP',
    description: 'View the original RSVP form.',
    icon: <Rss className="w-8 h-8 text-rose-500" />,
  },
  {
    href: '/archive/wedding-party',
    title: 'Wedding Party',
    description: 'Meet the people who stood by our side.',
    icon: <Users className="w-8 h-8 text-rose-500" />,
  },
  {
    href: '/archive/things-to-do',
    title: 'Things to Do',
    description: 'Explore our favorite spots in Rochester.',
    icon: <Map className="w-8 h-8 text-rose-500" />,
  },
  {
    href: '/archive/weather',
    title: 'Weather',
    description: 'See the weather forecast for our wedding day.',
    icon: <Cloud className="w-8 h-8 text-rose-500" />,
  },
];

export default function ArchivePage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Website Archive
      </h1>
      <p className="text-center text-lg mb-12">
        Here are some pages from our original wedding website.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {archivedPages.map((page) => (
          <Link href={page.href} key={page.href}>
            <div className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <div className="flex items-center mb-4">
                {page.icon}
                <h2 className="text-2xl font-bold ml-4">{page.title}</h2>
              </div>
              <p className="text-gray-700 dark:text-gray-300">{page.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
