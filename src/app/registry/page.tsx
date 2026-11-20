import { notFound } from 'next/navigation';
import { RegistryPage } from '@/features/registry';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export default async function Page() {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    notFound();
  }

  return <RegistryPage />;
}
