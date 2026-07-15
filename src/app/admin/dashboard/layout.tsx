import React from 'react';
import Link from 'next/link';

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] flex flex-col">
      <header aria-label="Admin Dashboard" className="bg-white dark:bg-gray-800 shadow p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary">Admin Control Panel</h1>
          <nav aria-label="Admin Navigation">
            <ul className="flex flex-wrap space-x-4">
              <li>
                <Link href="/admin/dashboard" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Registry
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/site-manager" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Site Manager
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/wedding-party" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Wedding Party
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/media" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Media
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/attractions" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Attractions
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/content" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Content
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/settings" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Settings
                </Link>
              </li>
              <li>
                <Link href="/admin/dashboard/maintenance" className="text-gray-700 dark:text-gray-300 hover:text-primary">
                  Maintenance
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
