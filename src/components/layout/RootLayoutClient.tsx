'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { WebVitals } from '@/components/WebVitals';
import Navbar from './Navbar';

const queryClient = new QueryClient();

/**
 * @function RootLayoutClient
 * @description A client-side component that wraps the main application layout.
 * It handles the admin login state, provides a query client for React Query,
 * and includes analytics and web vitals reporting. It also dynamically adjusts
 * the main content padding to account for the fixed navbar height.
 * @param {object} props - The component props.
 * @param {React.ReactNode} props.children - The child components to be rendered within the layout.
 * @returns {JSX.Element} The rendered RootLayoutClient component.
 */
export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [mainPaddingTop, setMainPaddingTop] = useState(0);

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

  useLayoutEffect(() => {
    if (!headerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (headerRef.current) {
        setMainPaddingTop(headerRef.current.offsetHeight);
      }
    });

    resizeObserver.observe(headerRef.current);

    return () => resizeObserver.disconnect();
  }, [pathname]);

  const isHeartPage = pathname === '/heart';

  const handleLogout = () => {
    localStorage.removeItem('isAdminLoggedIn');
    setIsAdmin(false);
    router.push('/');
  };

  return (
    <QueryClientProvider client={queryClient}>
      {!isHeartPage && (
        <Navbar
          headerRef={headerRef}
          isAdmin={isAdmin}
          handleLogout={handleLogout}
        />
      )}
      <main id="main-content" style={{ paddingTop: isHeartPage ? 0 : mainPaddingTop }}>
        {children}
      </main>
      <SpeedInsights />
      <Analytics />
      <WebVitals />
    </QueryClientProvider>
  );
}
