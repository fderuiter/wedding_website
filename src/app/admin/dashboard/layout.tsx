import React from 'react';
import Link from 'next/link';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { AdminNav, AdminNavItem } from './AdminNav';
import { SampleDataBanner } from '@/components/admin/SampleDataBanner';
import { MainLandmark } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin/dashboard', label: 'Overview' },
  { href: '/admin/dashboard/registry', label: 'Registry', featureId: 'registry' },
  { href: '/admin/dashboard/thank-you-notes', label: 'Thank-You Notes', featureId: 'registry' },
  { href: '/admin/dashboard/invitation-codes', label: 'Invitation Codes' },
  { href: '/admin/dashboard/sub-events', label: 'Sub-Events Matrix' },
  { href: '/admin/dashboard/seating-chart', label: 'Seating Chart' },
  { href: '/admin/dashboard/site-manager', label: 'Site Manager' },
  { href: '/admin/dashboard/wedding-party', label: 'Wedding Party', featureId: 'weddingParty' },
  { href: '/admin/dashboard/media', label: 'Media', featureId: 'gallery' },
  { href: '/admin/dashboard/attractions', label: 'Attractions', featureId: 'attractions' },
  { href: '/admin/dashboard/content', label: 'Content' },
  { href: '/admin/dashboard/settings', label: 'Settings' },
  { href: '/admin/dashboard/history', label: 'History' },
  { href: '/admin/dashboard/maintenance', label: 'Maintenance' },
];

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let moduleConfig: unknown;
  try {
    const config = await getAppConfig();
    moduleConfig = config.modules;
  } catch {
    // Fallback if unreachable
  }

  const visibleNavItems = ADMIN_NAV_ITEMS.filter((item) => {
    if (!item.featureId) return true;
    return isFeatureEnabled(item.featureId, moduleConfig);
  });

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] flex flex-col">
      <div role="region" aria-label="Admin Dashboard" className="bg-white dark:bg-gray-800 shadow p-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-primary">Admin Control Panel</span>
            <Link
              href="/"
              data-testid="admin-header-view-live-site"
              className="inline-flex min-h-[32px] items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:border-primary hover:text-primary dark:hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <span>View Live Site</span>
              <Icon name="ExternalLink" size={14} />
            </Link>
          </div>
          <AdminNav items={visibleNavItems} />
        </div>
      </div>
      <SampleDataBanner />
      <MainLandmark
        aria-label="Admin Dashboard Content"
        className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6"
      >
        {children}
      </MainLandmark>
    </div>
  );
}
