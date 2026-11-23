import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import SiteManagerClient from './SiteManagerClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Site Manager',
  description: 'Reorder and customize homepage feature cards and sections.',
  noIndex: true,
});

export default function SiteManagerPage() {
  return <SiteManagerClient />;
}
