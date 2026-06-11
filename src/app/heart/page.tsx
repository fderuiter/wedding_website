import { getAppConfig } from '@/lib/config'
import HeartClient from './HeartClient'

export const metadata = {
  title: 'Interactive Heart',
  description: 'A 3D interactive heart for our wedding.',
}

export default async function HeartPage() {
  const config = await getAppConfig()
  
  return (
    <HeartClient 
      brideName={config.brideName} 
      groomName={config.groomName} 
    />
  )
}
