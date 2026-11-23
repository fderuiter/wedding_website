import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import MaintenanceHubClient from './MaintenanceHubClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Maintenance Hub',
  description: 'Export backups, restore snapshots, and manage sample wedding data.',
  noIndex: true,
});

export default function MaintenanceHubPage() {
  return <MaintenanceHubClient />;
}
