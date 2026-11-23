'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { FeatureId } from '@/lib/modules';

export interface AdminNavItem {
  href: string;
  label: string;
  featureId?: FeatureId;
}

interface AdminNavProps {
  items: AdminNavItem[];
}

export function AdminNav({ items }: AdminNavProps) {
  const pathname = usePathname();
  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  return (
    <nav aria-label="Admin Navigation">
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((item) => {
          const isActive =
            normalizedPathname === item.href ||
            (item.href !== '/admin/dashboard' &&
              Boolean(normalizedPathname?.startsWith(`${item.href}/`)));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center justify-center px-3 py-1.5 min-h-[32px] min-w-[24px] rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 ${
                  isActive
                    ? 'font-semibold text-primary dark:text-white bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] dark:bg-gray-700 hover:text-primary dark:hover:text-white hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.08))] dark:hover:bg-gray-600'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary dark:hover:text-white hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
