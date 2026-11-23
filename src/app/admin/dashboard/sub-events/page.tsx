import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import SubEventsMatrixClient from './SubEventsMatrixClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Sub-Events Matrix',
  description: 'Manage wedding sub-events, schedules, and guest access permissions.',
  noIndex: true,
});

export default function SubEventsMatrixPage() {
  return <SubEventsMatrixClient />;
}
