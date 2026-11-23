import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import AdminSettingsClient from './AdminSettingsClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Site Settings',
  description: 'Configure wedding details, theme presets, SEO metadata, and feature modules.',
  noIndex: true,
});

export default function AdminSettingsPage() {
  return <AdminSettingsClient />;
}
