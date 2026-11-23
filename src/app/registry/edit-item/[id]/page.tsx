import { notFound } from 'next/navigation';
import { EditItemPage, STATIC_EXPORT_REGISTRY_ITEM_IDS } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export function generateStaticParams() {
  return STATIC_EXPORT_REGISTRY_ITEM_IDS.map((id) => ({ id }));
}

export default async function Page() {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <EditItemPage />;
}
