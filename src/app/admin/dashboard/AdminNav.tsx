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

  return (
    <nav aria-label="Admin Navigation">
      <ul className="flex flex-wrap space-x-4">
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/admin/dashboard' &&
              Boolean(pathname?.startsWith(`${item.href}/`)));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'font-semibold text-primary dark:text-primary hover:text-primary'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary'
                }
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
