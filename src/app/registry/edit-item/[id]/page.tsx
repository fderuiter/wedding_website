import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import { EditItemPage } from '@/features/registry';
import { enforceAdminPageSession } from '@/core/auth/adminPageGuard';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getRegistryEditStaticParams } from '@/lib/sampleData/builder';

export const metadata: Metadata = createPageMetadata({
  title: 'Edit Registry Item',
  description: 'Update gift details, pricing, and settings for a wedding registry item.',
  noIndex: true,
});

export function generateStaticParams() {
  return getRegistryEditStaticParams();
}

export default async function Page() {
  await enforceAdminPageSession();

  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <EditItemPage />;
}
