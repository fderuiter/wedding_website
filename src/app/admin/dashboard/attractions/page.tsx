import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import AttractionsDashboardClient from './AttractionsDashboardClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Attractions Studio',
  description: 'Curate local attractions, hotels, and recommendations for wedding guests.',
  noIndex: true,
});

export default function AttractionsDashboardPage() {
  return <AttractionsDashboardClient />;
}
