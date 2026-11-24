'use client';

import Link from 'next/link';
import type { PublicAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { cleanOptionalSetupText } from '@/lib/setupCopy';

export interface HomeFooterContentProps {
  config: PublicAppConfig;
}

export function HomeFooterContent({ config }: HomeFooterContentProps) {
  const partner1Display = (config.partner1Name || config.brideName || '').trim();
  const partner2Display = (config.partner2Name || config.groomName || '').trim();
  const cleanVenueState = cleanOptionalSetupText(config.venueState);

  return (
    <>
      <p>
        © {new Date().getFullYear()} {partner1Display} &amp; {partner2Display}
        {cleanVenueState ? ` • Designed with ❤️ in ${cleanVenueState}` : ''}
      </p>
      <p>We look forward to celebrating with you!</p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <Link
          href="/project-info"
          className="text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white hover:underline focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 rounded"
        >
          About this site
        </Link>
        <span aria-hidden="true" className="text-muted-text">
          •
        </span>
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
    </>
  );
}
