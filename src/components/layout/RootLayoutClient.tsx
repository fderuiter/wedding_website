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
import { stripBasePath } from '@/utils/basePath';
import type { DemoRuntimeProviderProps } from '@/components/demo/DemoRuntimeProvider';

let staticDemoGateInstalled = false;

function ensureStaticDemoFetchGate(): void {
  if (staticDemoGateInstalled || typeof window === 'undefined') return;
  staticDemoGateInstalled = true;
  document.documentElement.dataset.staticDemo = 'true';
  try {
    if (window.localStorage.getItem('isAdminLoggedIn') === null) {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    }
  } catch {
    // Ignore storage errors
  }

  const win = window as Window & { __WEDDING_NATIVE_FETCH__?: typeof window.fetch };
  const nativeFetch = win.__WEDDING_NATIVE_FETCH__ ?? window.fetch.bind(window);
  win.__WEDDING_NATIVE_FETCH__ = nativeFetch;
  const runtimePromise = import('@/lib/demo/runtime').then((mod) => {
    mod.installDemoBrowserRuntime();
    return mod;
  });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (
        parsed.origin === window.location.origin &&
        stripBasePath(parsed.pathname).startsWith('/api/')
      ) {
        const runtime = await runtimePromise;
        return runtime.handleDemoFetch(input, init, nativeFetch);
      }
    } catch {
      // Fall through to native fetch
    }
    return nativeFetch(input, init);
  };
}

if (
  typeof document !== 'undefined' &&
  document.documentElement?.dataset?.staticDemo === 'true'
) {
  ensureStaticDemoFetchGate();
}

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
  if (isStaticExport && typeof window !== 'undefined') {
    ensureStaticDemoFetchGate();
  }

  const [isAdmin, setIsAdmin] = useState(false);
  const [isSetupWizardPreview, setIsSetupWizardPreview] = useState(false);
  const [demoConfigOverride, setDemoConfigOverride] = useState<PublicAppConfig | null>(null);
  const [DemoRuntimeComponent, setDemoRuntimeComponent] =
    useState<React.ComponentType<DemoRuntimeProviderProps> | null>(null);
  const effectiveConfig = demoConfigOverride ?? config;
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
  const isSlideshowPage = pathname === '/photos/slideshow';
  const isStandalonePage = isHeartPage || isSlideshowPage;
  const isAdminDashboardPage =
    pathname === '/admin/dashboard' || pathname?.startsWith('/admin/dashboard/');

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

  useEffect(() => {
    if (!isStaticExport) return;
    let cancelled = false;
    void import('@/components/demo/DemoRuntimeProvider').then((mod) => {
      if (!cancelled) {
        setDemoRuntimeComponent(() => mod.default);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isStaticExport]);

  const helpConfig = useMemo<GuestHelpConfig>(() => {
    if (!faqs) return effectiveConfig;
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
      ...effectiveConfig,
      faqs: mappedFaqs,
    };
  }, [effectiveConfig, faqs]);

  return (
    <QueryClientProvider client={queryClient}>
      <GuestHelpProvider config={helpConfig} pathname={pathname}>
        <GlobalRadialGlow />
        {!isSetupWizardPreview && !isStandalonePage && (
          <Navbar
            headerRef={headerRef}
            isAdmin={isAdmin}
            handleLogout={handleLogout}
            config={effectiveConfig}
            hasVisibleFaqs={faqs ? faqs.length > 0 : undefined}
          />
        )}
        {!isSetupWizardPreview && (
          isAdminDashboardPage ? (
            <div style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}>
              {children}
            </div>
          ) : (
            <main aria-label="Application Content" id="main-content" style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}>
              {children}
            </main>
          )
        )}
        {isStaticExport && DemoRuntimeComponent && (
          <DemoRuntimeComponent
            onConfigSync={setDemoConfigOverride}
            onAdminSync={setIsAdmin}
            onSetupWizardPreviewSync={setIsSetupWizardPreview}
          />
        )}
      </GuestHelpProvider>
    </QueryClientProvider>
  );
}
