import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import WeddingPartyDashboardClient from './WeddingPartyDashboardClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Wedding Party Studio',
  description: 'Add, edit, and reorder members of the wedding party.',
  noIndex: true,
});

export default function WeddingPartyDashboardPage() {
  return <WeddingPartyDashboardClient />;
}
