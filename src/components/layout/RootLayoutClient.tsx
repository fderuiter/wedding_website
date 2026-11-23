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
import { MotionGlobalConfig } from 'framer-motion';
import type { ContentNodeDTO } from '@/features/content';

if (typeof window !== 'undefined' && window.navigator.userAgent.includes('HeadlessChrome')) {
  MotionGlobalConfig.skipAnimations = true;
}

import type { PublicAppConfig } from '@/lib/config';
import SetupWizard from '@/components/setup/SetupWizard';
import { DemoProvider, useOptionalDemo } from '@/components/demo/DemoContext';
import { DemoToolbar } from '@/components/demo/DemoToolbar';

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
  isStaticExport?: boolean;
}

function RootLayoutInner({
  children,
  config: baseConfig,
  faqs: baseFaqs,
}: Omit<RootLayoutClientProps, 'isStaticExport'>) {
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const [storageIsAdmin, setStorageIsAdmin] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [mainPaddingTop, setMainPaddingTop] = useState(0);

  useEffect(() => {
    if (isDemoMode) return;
    const checkLoginStatus = () => {
      const loggedIn = localStorage.getItem('isAdminLoggedIn') === 'true';
      setStorageIsAdmin(loggedIn);
    };

    checkLoginStatus();
    window.addEventListener('storage', checkLoginStatus);

    return () => {
      window.removeEventListener('storage', checkLoginStatus);
    };
  }, [isDemoMode]);

  const isSetupPersona = isDemoMode && demo?.persona === 'setup';
  const isAdmin = isDemoMode ? demo?.persona === 'admin' : storageIsAdmin;

  const effectiveConfig = useMemo<PublicAppConfig>(() => {
    if (!isDemoMode || !demo) return baseConfig;
    return {
      ...baseConfig,
      ...demo.configOverrides,
    };
  }, [baseConfig, demo, isDemoMode]);

  const effectiveFaqs = useMemo<ContentNodeDTO[] | undefined>(() => {
    if (!isDemoMode || !demo) return baseFaqs;
    return demo.activeDataset.faqs;
  }, [baseFaqs, demo, isDemoMode]);

  useLayoutEffect(() => {
    if (isSetupPersona || !headerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (headerRef.current) {
        setMainPaddingTop(headerRef.current.offsetHeight);
      }
    });

    resizeObserver.observe(headerRef.current);

    return () => resizeObserver.disconnect();
  }, [pathname, isSetupPersona]);

  const isHeartPage = pathname === '/heart';
  const isSlideshowPage = pathname === '/photos/slideshow';
  const isStandalonePage = isHeartPage || isSlideshowPage;
  const isAdminDashboardPage =
    pathname === '/admin/dashboard' || pathname?.startsWith('/admin/dashboard/');

  const handleLogout = async () => {
    if (isDemoMode && demo) {
      demo.setPersona('guest');
      return;
    }
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('isAdminLoggedIn');
      setStorageIsAdmin(false);
      router.push('/admin/login');
    }
  };

  const helpConfig = useMemo<GuestHelpConfig>(() => {
    if (!effectiveFaqs) return effectiveConfig;
    const mappedFaqs: GuestHelpFaqItem[] = effectiveFaqs
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
      ...effectiveConfig,
      faqs: mappedFaqs,
    };
  }, [effectiveConfig, effectiveFaqs]);

  const bottomToolbarClearance = isDemoMode
    ? demo?.isToolbarCollapsed
      ? 'pb-16'
      : 'pb-28'
    : '';

  return (
    <GuestHelpProvider config={helpConfig} pathname={pathname}>
      <GlobalRadialGlow />
      {isSetupPersona ? (
        <div className={bottomToolbarClearance}>
          <SetupWizard
            key={`demo-setup-${demo?.resetCounter ?? 0}`}
            onDemoComplete={() => router.push('/admin/dashboard')}
          />
        </div>
      ) : (
        <>
          {!isStandalonePage && (
            <Navbar
              headerRef={headerRef}
              isAdmin={isAdmin}
              handleLogout={handleLogout}
              config={effectiveConfig}
              hasVisibleFaqs={effectiveFaqs ? effectiveFaqs.length > 0 : undefined}
            />
          )}
          {isAdminDashboardPage ? (
            <div
              className={bottomToolbarClearance}
              style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}
            >
              {children}
            </div>
          ) : (
            <main
              aria-label="Application Content"
              id="main-content"
              className={bottomToolbarClearance}
              style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}
            >
              {children}
            </main>
          )}
        </>
      )}
      {isDemoMode && <DemoToolbar />}
    </GuestHelpProvider>
  );
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
  isStaticExport = false,
}: RootLayoutClientProps) {
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

  return (
    <QueryClientProvider client={queryClient}>
      <DemoProvider enabled={isStaticExport}>
        <RootLayoutInner config={config} faqs={faqs}>
          {children}
        </RootLayoutInner>
      </DemoProvider>
    </QueryClientProvider>
  );
}
