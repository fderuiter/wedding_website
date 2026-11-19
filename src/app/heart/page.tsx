import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { notFound } from 'next/navigation';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';
import HeartClient from './HeartClient';

export const metadata = {
  title: 'Interactive Heart',
  description: 'A 3D interactive heart for our wedding.',
};

export default async function HeartPage() {
  await enforceActiveGuestPageSession();
  const config = await getAppConfig();
  if (!isFeatureEnabled('interactive3D', config.modules)) {
    notFound();
  }
  
  return (
    <HeartClient 
      partner1Name={config.partner1Name || config.brideName || ''} 
      partner2Name={config.partner2Name || config.groomName || ''} 
    />
  );
}
