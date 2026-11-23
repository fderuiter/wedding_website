import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import SeatingChartClient from './SeatingChartClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Seating Chart',
  description: 'Arrange reception tables, assign guests to seats, and export floorplan layouts.',
  noIndex: true,
});

export default function SeatingChartAdminPage() {
  return <SeatingChartClient />;
}
