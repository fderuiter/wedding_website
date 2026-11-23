import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import MediaDashboardClient from './MediaDashboardClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Media Library',
  description: 'Upload, organize, and moderate wedding photos and media assets.',
  noIndex: true,
});

export default function MediaDashboardPage() {
  return <MediaDashboardClient />;
}
