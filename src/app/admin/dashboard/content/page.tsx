import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import ContentDashboardClient from './ContentDashboardClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Content Hub',
  description: 'Manage wedding FAQs, schedule entries, logistics, and structured content.',
  noIndex: true,
});

export default function ContentDashboardPage() {
  return <ContentDashboardClient />;
}
