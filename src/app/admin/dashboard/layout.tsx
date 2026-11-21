import React from 'react';
import { redirect } from 'next/navigation';
import { getAppConfig } from '@/lib/config';
import { getVerifiedAdminPayload } from '@/core/auth/auth.server';
import { isFeatureEnabled } from '@/lib/modules';
import { AdminNav, AdminNavItem } from './AdminNav';
import { SampleDataBanner } from '@/components/admin/SampleDataBanner';

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
  let expectedAdminSessionVersion = 1;
  try {
    const config = await getAppConfig();
    moduleConfig = config.modules;
    if (typeof config.adminSessionVersion === 'number') {
      expectedAdminSessionVersion = config.adminSessionVersion;
    }
  } catch (e) {
    // Fallback if unreachable
  }

  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  if (!isStaticExport && typeof getVerifiedAdminPayload === 'function') {
    const adminPayload = await getVerifiedAdminPayload();
    if (adminPayload) {
      const tokenVersion =
        typeof adminPayload.adminSessionVersion === 'number'
          ? adminPayload.adminSessionVersion
          : 1;
      if (tokenVersion !== expectedAdminSessionVersion) {
        redirect('/admin/login');
      }
    }
  }

  const visibleNavItems = ADMIN_NAV_ITEMS.filter((item) => {
    if (!item.featureId) return true;
    return isFeatureEnabled(item.featureId, moduleConfig);
  });

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] flex flex-col">
      <header aria-label="Admin Dashboard" className="bg-white dark:bg-gray-800 shadow p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary">Admin Control Panel</h1>
          <AdminNav items={visibleNavItems} />
        </div>
      </header>
      <SampleDataBanner />
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
