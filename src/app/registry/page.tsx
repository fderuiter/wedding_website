import { Metadata } from 'next';
import RegistryPageClient from '@/features/registry/pages/index';

export const metadata: Metadata = {
  title: 'Registry',
  description: 'Browse our wedding registry and contribute to our future together.',
  alternates: {
    canonical: '/registry',
  },
};

/**
 * @page RegistryPage
 * @description The server component wrapper for the registry page.
 * It defines the metadata for SEO and renders the client-side RegistryPageClient.
 *
 * @returns {JSX.Element} The rendered registry page.
 */
export default function RegistryPage() {
  return <RegistryPageClient />;
}
