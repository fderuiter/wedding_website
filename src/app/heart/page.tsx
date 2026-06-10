import { getAppConfig } from '@/lib/config';
import HeartClient from './HeartClient';

export default async function HeartPage() {
  const config = await getAppConfig();
  return <HeartClient name1={config.brideName} name2={config.groomName} />;
}
