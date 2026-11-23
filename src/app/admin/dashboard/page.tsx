import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import AdminDashboardClient from './AdminDashboardClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Admin Dashboard Overview',
  description: 'Administrative overview of wedding setup progress and management workflows.',
  noIndex: true,
});

export default function AdminDashboardPage() {
  return <AdminDashboardClient />;
}
