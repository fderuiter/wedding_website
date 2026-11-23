import { notFound } from 'next/navigation';
import { EditItemPage } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getRegistryEditStaticParams } from '@/lib/sampleData/builder';

export function generateStaticParams() {
  return getRegistryEditStaticParams();
}

export default async function Page() {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <EditItemPage />;
}
