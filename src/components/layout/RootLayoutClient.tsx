'use client';

import {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import Navbar from './Navbar';
import { HomeFooterContent } from '@/components/home/HomeFooterContent';
import {
  GuestHelpProvider,
  type GuestHelpConfig,
  type GuestHelpFaqItem,
} from '@/components/guest/GuestHelpModal';
import { GlobalRadialGlow } from '@/components/ui/GlobalRadialGlow';
import { MainLandmark, SiteFooter } from '@/components/ui/Layout';
import { useStickyOffset } from '@/components/ui/useStickyOffset';
import { useToast } from '@/components/ui/ToastProvider';
import { useTheme } from '@/components/ThemeProvider';
import type { ThemePreset } from '@/lib/theme/presets';
import { MotionConfig, MotionGlobalConfig } from 'framer-motion';
import type { ContentNodeDTO } from '@/features/content';
import {
  ensureStaticDemoRuntime,
  useStaticDemoPageOverrides,
  StaticDemoMount,
} from '@/lib/staticDemo/runtime';
import {
  invalidateOnboardingMilestones,
  invalidateSampleDataCaches,
} from '@/lib/adminCacheSync';
import { isFeatureEnabled } from '@/lib/modules';
import { ActiveInviteSessionContext } from '@/features/registry';

if (
  typeof window !== 'undefined' &&
  MotionGlobalConfig &&
  (window.navigator.userAgent.includes('HeadlessChrome') ||
    window.navigator.webdriver === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches))
) {
  MotionGlobalConfig.skipAnimations = true;
}

import type { PublicAppConfig } from '@/lib/config';
import { withBasePath } from '@/lib/basePath';
import { DemoProvider, useOptionalDemo } from '@/components/demo/DemoContext';
import { DemoSetupSlot } from '@/components/demo/DemoSetupSlot';
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
  isPreview?: boolean;
  hasInviteSession?: boolean;
}

function subscribeToPreviewLocation(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('popstate', onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
  };
}

function getPreviewSearchSnapshot(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('preview') === 'true';
}

function getServerPreviewSearchSnapshot(): boolean {
  return false;
}

function RootLayoutInner({
  children,
  config: baseConfig,
  faqs: baseFaqs,
  isPreview: isPreviewProp,
  hasInviteSession: initialHasInviteSession = false,
  queryClient,
}: Omit<RootLayoutClientProps, 'isStaticExport'> & { queryClient: QueryClient }) {
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const demoOverrides = useStaticDemoPageOverrides();
  const { setPreviewConfig } = useTheme();
  const isPreviewQuery = useSyncExternalStore(
    subscribeToPreviewLocation,
    getPreviewSearchSnapshot,
    getServerPreviewSearchSnapshot
  );
  const isPreview = isPreviewProp ?? isPreviewQuery;
  const [previewDraftConfig, setPreviewDraftConfig] =
    useState<Partial<PublicAppConfig> | null>(null);
  const [storageIsAdmin, setStorageIsAdmin] = useState(false);
  const [hasActiveInviteSession, setHasActiveInviteSession] = useState<boolean>(
    Boolean(initialHasInviteSession)
  );
  const router = useRouter();
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const [mainPaddingTop, setMainPaddingTop] = useState(64);

  useEffect(() => {
    if (!isPreview || typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        event.data?.type === 'DRAFT_UPDATE' &&
        event.data.draftType === 'config' &&
        event.data.draftData &&
        typeof event.data.draftData === 'object'
      ) {
        setPreviewDraftConfig((prev) => ({
          ...(prev ?? {}),
          ...(event.data.draftData as Partial<PublicAppConfig>),
        }));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isPreview]);

  useEffect(() => {
    if (isDemoMode || isPreview || !demoOverrides || typeof setPreviewConfig !== 'function') return;
    if (typeof window !== 'undefined' && window !== window.parent) return;
    setPreviewConfig({
      themePreset: demoOverrides.config.themePreset as ThemePreset,
      colorPrimary: demoOverrides.config.colorPrimary,
      colorSecondary: demoOverrides.config.colorSecondary,
    });
  }, [
    isDemoMode,
    isPreview,
    demoOverrides,
    demoOverrides?.config.themePreset,
    demoOverrides?.config.colorPrimary,
    demoOverrides?.config.colorSecondary,
    setPreviewConfig,
  ]);

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

  const isSetupPersona = isDemoMode
    ? demo?.persona === 'setup'
    : Boolean(demoOverrides?.isSetupMode);
  const isAdmin = isDemoMode
    ? demo?.persona === 'admin'
    : demoOverrides
      ? demoOverrides.isAdminAuthenticated
      : storageIsAdmin;

  const effectiveConfig = useMemo<PublicAppConfig>(() => {
    const seededBase = demoOverrides?.config ?? baseConfig;
    const withPreview =
      isPreview && previewDraftConfig
        ? { ...seededBase, ...previewDraftConfig }
        : seededBase;
    if (isDemoMode && demo) {
      return {
        ...withPreview,
        ...demo.configOverrides,
      };
    }
    return withPreview;
  }, [baseConfig, demo, demoOverrides, isDemoMode, isPreview, previewDraftConfig]);

  const effectiveFaqs = useMemo<ContentNodeDTO[] | undefined>(() => {
    if (isDemoMode && demo) {
      return demo.activeDataset.faqs;
    }
    return demoOverrides?.faqs ?? baseFaqs;
  }, [baseFaqs, demo, demoOverrides, isDemoMode]);

  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const isHomePage = normalizedPathname === '/';
  const isHeartPage = normalizedPathname === '/heart';
  const isSlideshowPage =
    normalizedPathname === '/photos/slideshow' &&
    isFeatureEnabled('gallery', effectiveConfig.modules);
  const isSetupPage =
    normalizedPathname === '/admin/setup' ||
    Boolean(normalizedPathname?.startsWith('/admin/setup/'));
  const isStandalonePage = isHeartPage || isSlideshowPage || isSetupPage;
  const isAdminDashboardPage =
    normalizedPathname === '/admin/dashboard' ||
    Boolean(normalizedPathname?.startsWith('/admin/dashboard/')) ||
    isSetupPage;
  const delegatesMainLandmark = isAdminDashboardPage || isSlideshowPage;

  const previewRegionRef = useRef<HTMLElement>(null);
  const isEmbeddedIframe =
    typeof window !== 'undefined' && window !== window.parent;
  const isInlinePreview = Boolean(
    isPreview && !isPreviewQuery && !isEmbeddedIframe
  );
  const hasVisibleHeader = !isSetupPersona && !isStandalonePage;

  useStickyOffset({
    edge: 'top',
    scope: 'document',
    cssVar: '--header-h',
    combineMode: 'max',
    targetRef: headerRef,
    containerRef: isInlinePreview ? previewRegionRef : undefined,
    enabled: hasVisibleHeader,
    onMeasure: setMainPaddingTop,
  });

  useLayoutEffect(() => {
    if (hasVisibleHeader || isInlinePreview || typeof document === 'undefined') {
      return;
    }
    const rootEl = document.documentElement;
    rootEl.style.setProperty('--header-h', '0px');
    return () => {
      rootEl.style.removeProperty('--header-h');
    };
  }, [hasVisibleHeader, isInlinePreview]);

  const handleLogout = async () => {
    if (isDemoMode && demo) {
      demo.setPersona('guest');
      return;
    }
    try {
      await fetch(withBasePath('/api/admin/logout'), { method: 'POST' });
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

  const bottomToolbarClearance = isDemoMode && !isPreview
    ? demo?.isToolbarCollapsed
      ? 'pb-16'
      : 'pb-28'
    : '';

  return (
    <ActiveInviteSessionContext.Provider value={hasActiveInviteSession}>
      <GuestHelpProvider config={helpConfig} pathname={pathname}>
        <GlobalRadialGlow />
        {isSetupPersona ? (
          <DemoSetupSlot
            className={bottomToolbarClearance}
            resetCounter={demo?.resetCounter ?? 0}
            onDemoComplete={() => router.push('/admin/dashboard')}
          />
        ) : (
          <>
            {!isStandalonePage && (
              <Navbar
                headerRef={headerRef}
                isAdmin={isAdmin}
                handleLogout={handleLogout}
                config={effectiveConfig}
                hasVisibleFaqs={effectiveFaqs ? effectiveFaqs.length > 0 : undefined}
                isPreview={isPreview}
                onInviteSessionChange={setHasActiveInviteSession}
              />
            )}
            {delegatesMainLandmark ? (
              <div
                className={bottomToolbarClearance}
                style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}
              >
                {children}
              </div>
            ) : isPreview ? (
              <MainLandmark
                ref={previewRegionRef}
                suppressLandmark
                role="region"
                aria-label="Live Preview"
                data-scroll-region={isInlinePreview ? '' : undefined}
                className={bottomToolbarClearance}
                style={
                  {
                    paddingTop: isStandalonePage ? 0 : mainPaddingTop,
                    ...(mainPaddingTop > 0
                      ? {
                        '--header-h': `${mainPaddingTop}px`,
                        '--local-sticky-top': `${mainPaddingTop}px`,
                      }
                      : {}),
                  } as React.CSSProperties
                }
              >
                {children}
                {isHomePage && (
                  <SiteFooter suppressLandmark>
                    <HomeFooterContent config={effectiveConfig} />
                  </SiteFooter>
                )}
              </MainLandmark>
            ) : (
              <>
                <MainLandmark
                  aria-label="Application Content"
                  className={!isHomePage ? bottomToolbarClearance : undefined}
                  style={{ paddingTop: isStandalonePage ? 0 : mainPaddingTop }}
                >
                  {children}
                </MainLandmark>
                {isHomePage && (
                  <SiteFooter className={bottomToolbarClearance}>
                    <HomeFooterContent config={effectiveConfig} />
                  </SiteFooter>
                )}
              </>
            )}
          </>
        )}
        {!isPreview && (isDemoMode ? <DemoToolbar /> : <StaticDemoMount queryClient={queryClient} />)}
      </GuestHelpProvider>
    </ActiveInviteSessionContext.Provider>
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
  isPreview,
  hasInviteSession,
}: RootLayoutClientProps) {
  if (isStaticExport || process.env.NODE_ENV === 'test') {
    ensureStaticDemoRuntime();
  }
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

  const layoutTree = (
    <DemoProvider enabled={isStaticExport}>
      <RootLayoutInner
        config={config}
        faqs={faqs}
        isPreview={isPreview}
        hasInviteSession={hasInviteSession}
        queryClient={queryClient}
      >
        {children}
      </RootLayoutInner>
    </DemoProvider>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {typeof MotionConfig === 'function' ? (
        <MotionConfig reducedMotion="user">{layoutTree}</MotionConfig>
      ) : (
        layoutTree
      )}
    </QueryClientProvider>
  );
}
