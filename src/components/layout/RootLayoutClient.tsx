'use client';

import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { WebVitals } from '@/components/WebVitals';
import Navbar from './Navbar';
import { GlobalRadialGlow } from '@/components/ui/GlobalRadialGlow';
import { useToast } from '@/components/ui/ToastProvider';
import { MotionGlobalConfig } from 'framer-motion';

if (typeof window !== 'undefined' && window.navigator.userAgent.includes('HeadlessChrome')) {
  MotionGlobalConfig.skipAnimations = true;
}

import type { PublicAppConfig } from '@/lib/config';

/**
 * @interface RootLayoutClientProps
 * @description Defines the props for the RootLayoutClient component.
 * @property {React.ReactNode} children - The child components to be rendered within the layout.
 * @property {AppConfig} config - The app config.
 */
interface RootLayoutClientProps {
  children: React.ReactNode;
  config: PublicAppConfig;
}

/**
 * @function RootLayoutClient
 * @description A client-side component that wraps the main application layout.
 * It handles the admin login state, provides a query client for React Query,
 * and includes analytics and web vitals reporting. It also dynamically adjusts
 * the main content padding to account for the fixed navbar height.
 * @param {RootLayoutClientProps} props - The component props.
 * @returns {JSX.Element} The rendered RootLayoutClient component.
 */
export default function RootLayoutClient({
  children,
  config,
}: RootLayoutClientProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [mainPaddingTop, setMainPaddingTop] = useState(0);
  const { addToast } = useToast();

  const [queryClient] = useState(() => new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        if (mutation.meta?.successMessage) {
          addToast(mutation.meta.successMessage as string, 'success');
        } else if (mutation.meta?.showSuccessToast !== false) {
          addToast('Operation completed successfully!', 'success');
        }
      },
      onError: (error: any, _variables, _context, mutation) => {
        if (mutation.meta?.errorMessage) {
          addToast(mutation.meta.errorMessage as string, 'error');
        } else if (mutation.meta?.showErrorToast !== false) {
          let message = error?.message || 'An error occurred during the operation.';
          if (error && typeof error === 'object' && 'status' in error) {
            switch (error.status) {
              case 400: message = 'Invalid request. Please check your inputs.'; break;
              case 401: message = 'Please log in to continue.'; break;
              case 403: message = 'You do not have permission to perform this action.'; break;
              case 404: message = 'The requested resource was not found.'; break;
              case 500: message = 'An unexpected server error occurred. Please try again later.'; break;
            }
          }
          addToast(message, 'error');
        }
      },
    }),
  }));

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

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('isAdminLoggedIn');
      setIsAdmin(false);
      router.push('/admin/login');
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalRadialGlow />
      {!isHeartPage && (
        <Navbar
          headerRef={headerRef}
          isAdmin={isAdmin}
          handleLogout={handleLogout}
          config={config}
        />
      )}
      <main aria-label="Application Content" id="main-content" style={{ paddingTop: isHeartPage ? 0 : mainPaddingTop }}>
        {children}
      </main>
      <SpeedInsights />
      <Analytics />
      <WebVitals />
    </QueryClientProvider>
  );
}
