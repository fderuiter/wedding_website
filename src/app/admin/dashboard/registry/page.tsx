import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import AdminRegistryClient from './AdminRegistryClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Registry Management',
  description: 'Manage wedding registry gifts, cash funds, and guest contributions.',
  noIndex: true,
});

export default function AdminRegistryPage() {
  return <AdminRegistryClient />;
}
