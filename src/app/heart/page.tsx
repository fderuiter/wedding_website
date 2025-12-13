import { Metadata } from 'next';
import HeartPageClient from './HeartPageClient';

export const metadata: Metadata = {
  title: 'Heart',
  description: 'An interactive 3D heart animation.',
  alternates: {
    canonical: '/heart',
  },
};

/**
 * @page HeartPage
 * @description The server component wrapper for the heart page.
 * It defines the metadata for SEO and renders the client-side HeartPageClient.
 *
 * @returns {JSX.Element} The rendered heart page.
 */
export default function HeartPage() {
  return <HeartPageClient />;
}
