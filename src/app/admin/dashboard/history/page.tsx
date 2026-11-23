import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import HistoryTimelineClient from './HistoryTimelineClient';

export const metadata: Metadata = createPageMetadata({
  title: 'System & Activity History',
  description: 'Review configuration snapshots, audit logs, and version rollback points.',
  noIndex: true,
});

export default function HistoryTimelinePage() {
  return <HistoryTimelineClient />;
}
