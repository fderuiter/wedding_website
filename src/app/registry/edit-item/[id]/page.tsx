import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import { EditItemPage } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const metadata: Metadata = createPageMetadata({
  title: 'Edit Registry Item',
  description: 'Update gift details, pricing, and settings for a wedding registry item.',
  noIndex: true,
});

export function generateStaticParams() {
  return [{ id: '1' }];
}

export default async function Page() {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <EditItemPage />;
}
