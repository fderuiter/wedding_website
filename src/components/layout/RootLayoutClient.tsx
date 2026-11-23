'use client';

import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import Navbar from './Navbar';
import {
  GuestHelpProvider,
  type GuestHelpConfig,
  type GuestHelpFaqItem,
} from '@/components/guest/GuestHelpModal';
import { GlobalRadialGlow } from '@/components/ui/GlobalRadialGlow';
import { useToast } from '@/components/ui/ToastProvider';
import { MotionConfig, MotionGlobalConfig } from 'framer-motion';
import type { ContentNodeDTO } from '@/features/content';
import {
  invalidateOnboardingMilestones,
  invalidateSampleDataCaches,
} from '@/lib/adminCacheSync';

if (
  typeof window !== 'undefined' &&
  (window.navigator.userAgent.includes('HeadlessChrome') ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
) {
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
  faqs?: ContentNodeDTO[];
}

/**
 * @function RootLayoutClient
 * @description A client-side component that wraps the main application layout.
 * It handles the admin login state, provides a query client for React Query.
 * It also dynamically adjusts the main content padding to account for the fixed navbar height.
 * @param {RootLayoutClientProps} props - The component props.
 * @returns {JSX.Element} The rendered RootLayoutClient component.
 */
export default function RootLayoutClient({
  children,
  config,
  faqs,
}: RootLayoutClientProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [mainPaddingTop, setMainPaddingTop] = useState(0);
  const { addToast } = useToast();
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: (_data, _variables, _context, mutation) => {
          invalidateOnboardingMilestones(client);
          if (mutation.meta?.successMessage) {
            addToast(mutation.meta.successMessage as string, 'success');
          } else if (mutation.meta?.showSuccessToast !== false) {
            addToast('Operation completed successfully!', 'success');
          }
        },
        onError: (error: any, _variables, _context, mutation) => {
          if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
            void invalidateSampleDataCaches(client);
          }
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
    });
    return client;
  });

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

  const normalizedPathname = pathname && pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const isHeartPage = normalizedPathname === '/heart';
  const isSlideshowPage = normalizedPathname === '/photos/slideshow';
  const isSetupPage = normalizedPathname === '/admin/setup' || pathname?.startsWith('/admin/setup/');
  const isStandalonePage = isHeartPage || isSlideshowPage || isSetupPage;
  const isAdminDashboardPage =
    pathname === '/admin/dashboard' ||
    pathname?.startsWith('/admin/dashboard/') ||
    isSetupPage;
  const hasOwnMainLandmark =
    isAdminDashboardPage ||
    normalizedPathname === '/guest/claim' ||
    normalizedPathname === '/guest/collect';

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

  const helpConfig = useMemo<GuestHelpConfig>(() => {
    if (!faqs) return config;
    const mappedFaqs: GuestHelpFaqItem[] = faqs
      .filter((n): n is Extract<ContentNodeDTO, { type: 'FAQ' }> => n.type === 'FAQ')
      .map((n, index) => ({
        id: n.id,
        question: n.data.question || '',
        answer: n.data.answer || '',
        category: n.data.category,
        isVisible: n.data.isVisible,
        displayOrder:
          typeof n.data.displayOrder === 'number' ? n.data.displayOrder : index,
      }));
    return {
      ...config,
      faqs: mappedFaqs,
    };
  }, [config, faqs]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <GuestHelpProvider config={helpConfig} pathname={pathname}>
          <GlobalRadialGlow />
          {!isStandalonePage && (
            <Navbar
              headerRef={headerRef}
              isAdmin={isAdmin}
              handleLogout={handleLogout}
              config={config}
              hasVisibleFaqs={faqs ? faqs.length > 0 : undefined}
            />
          )}
          {hasOwnMainLandmark ? (
            <div style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}>
              {children}
            </div>
          ) : (
            <main aria-label="Application Content" id="main-content" style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}>
              {children}
            </main>
          )}
        </GuestHelpProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
