'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import LoadingScreen from '@/components/LoadingScreen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { WebVitals } from '@/components/WebVitals';
import Link from 'next/link';

const queryClient = new QueryClient();

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/photos', label: 'Photos' },
  { href: '/wedding-party', label: 'Wedding Party' },
  { href: '/things-to-do', label: 'Things to Do' },
];

const homeNavLinks = [
  { href: '#details', label: 'Details' },
  { href: '#travel', label: 'Travel' },
  { href: '#faq', label: 'FAQ' },
  { href: '#registry', label: 'Registry' },
];

export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const checkLoginStatus = () => {
      const loggedIn = localStorage.getItem('isAdminLoggedIn') === 'true';
      setIsAdmin(loggedIn);
    };

    checkLoginStatus();
    window.addEventListener('storage', checkLoginStatus);

    return () => {
      window.removeEventListener('storage', checkLoginStatus);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('isAdminLoggedIn');
    setIsAdmin(false);
    router.push('/');
  };

  return (
    <QueryClientProvider client={queryClient}>
      <header className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 p-4 text-center text-sm flex justify-between items-center fixed top-0 w-full z-50 border-b border-gray-200 dark:border-gray-700">
        <nav>
          <ul className="flex gap-4">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-rose-400">
                  {link.label}
                </Link>
              </li>
            ))}
            {pathname === '/' && homeNavLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-rose-400">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {isAdmin && (
          <div className="flex items-center gap-4">
            <span>Admin Mode Active</span>
            <button
              onClick={handleLogout}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs py-1 px-3 rounded-md"
            >
              Logout
            </button>
          </div>
        )}
      </header>
      <main id="main-content" className={'pt-14'}>
        {children}
      </main>
      <SpeedInsights />
      <Analytics />
      <WebVitals />
    </QueryClientProvider>
  );
}
