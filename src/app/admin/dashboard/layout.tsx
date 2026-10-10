import React from 'react';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { AdminNav, AdminNavItem } from './AdminNav';

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin/dashboard', label: 'Registry', featureId: 'registry' },
  { href: '/admin/dashboard/thank-you-notes', label: 'Thank-You Notes', featureId: 'registry' },
  { href: '/admin/dashboard/invitation-codes', label: 'Invitation Codes', featureId: 'registry' },
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
  } catch (e) {
    // Fallback if unreachable
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
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
