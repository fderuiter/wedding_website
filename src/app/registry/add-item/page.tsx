import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import { AddItemPage } from '@/features/registry';
import { enforceAdminPageSession } from '@/core/auth/adminPageGuard';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const metadata: Metadata = createPageMetadata({
  title: 'Add Registry Item',
  description: 'Add a new gift or cash fund to the wedding registry.',
  noIndex: true,
});

export default async function Page() {
  await enforceAdminPageSession();

  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <AddItemPage />;
}
