'use client'

import dynamic from 'next/dynamic'
import LoadingScreen from '@/components/LoadingScreen'

const WeddingIntro = dynamic(() => import('@/components/WeddingIntro'), {
  ssr: false,
  loading: () => <LoadingScreen />,
})

export default function HeartScenePage() {
  return <WeddingIntro />
}
