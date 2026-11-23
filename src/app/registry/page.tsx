import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import { RegistryPage } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const metadata: Metadata = createPageMetadata({
  title: 'Gift Registry',
  description: 'Browse our wedding gift registry, cash funds, and group gifting options.',
  canonical: '/registry',
});

export default async function Page() {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <RegistryPage />;
}
