import { notFound } from 'next/navigation';
import { EditItemPage } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

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
