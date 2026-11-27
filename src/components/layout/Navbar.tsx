'use client';

import { Icon } from '../ui/Icon';
import { Overlay } from '../ui/Overlay';
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useId,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PublicAppConfig } from '@/lib/config';
import { getNavLinks } from '@/lib/routes';
import { useMenuPopup } from '@/hooks/useMenuPopup';
import { useMenuNavigation } from '@/hooks/useMenuNavigation';
import { ThemeSelector } from '../ui/ThemeSelector';
import {
  GuestHelpProvider,
  GuestHelpTrigger,
  resolveHelpCategoryForPath,
  useGuestHelp,
} from '@/components/guest/GuestHelpModal';
import { deriveBrandMonogram } from '@/features/content';
import {
  notifyGuestSessionChanged,
  subscribeGuestSessionChanged,
} from '@/utils/guestSessionEvents';
import { withBasePath } from '@/lib/basePath';
import { MediaImage } from '@/components/MediaImage';

/**
 * @interface NavbarProps
 * @description Defines the props for the Navbar component.
 * @property {boolean} isAdmin - Indicates if the current user is an administrator.
 * @property {() => void} handleLogout - Function to handle user logout.
 * @property {React.RefObject<HTMLElement | null>} headerRef - Ref to the header element for layout calculations.
 * @property {AppConfig} config - The app configuration.
 */
interface NavbarProps {
  isAdmin: boolean;
  handleLogout: () => void;
  headerRef: React.RefObject<HTMLElement | null>;
  config: PublicAppConfig;
  hasVisibleFaqs?: boolean;
  isPreview?: boolean;
}

interface NavLinkItem {
  href: string;
  label: string;
}

interface HomeFeatureSection {
  id?: string;
  type?: string;
  title?: string;
  visible?: boolean;
}

const PRIMARY_GUEST_PATHS = new Set(['/', '/guest', '/registry', '/photos']);

function subscribeToHashChange(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('hashchange', onStoreChange);
  return () => {
    window.removeEventListener('hashchange', onStoreChange);
  };
}

function getHashSnapshot() {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

function getServerHashSnapshot() {
  return '';
}

const DEFAULT_HOME_FEATURES: HomeFeatureSection[] = [
  { id: 'story', type: 'story', title: 'Our Story', visible: true },
  { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
  { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
  { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
  { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
  { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
];

/**
 * @function Navbar
 * @description A responsive navigation bar component for the application.
 * Keeps primary links consistent across all routes, groups secondary event sections
 * and guides into an accessible keyboard-navigable dropdown menu on desktop,
 * deduplicates `/#travel` when `/things-to-do` is active, and supports vertical
 * scrolling on compact mobile viewports.
 * @param {NavbarProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Navbar component.
 */
export default function Navbar({
  isAdmin,
  handleLogout,
  headerRef,
  config,
  hasVisibleFaqs,
  isPreview = false,
}: NavbarProps) {
  const pathname = usePathname();
  const normalizedPathname =
    pathname && pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const { hasProvider } = useGuestHelp();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isGuideMenuOpen, setIsGuideMenuOpen] = useState(false);
  const [hasInviteSession, setHasInviteSession] = useState(false);
  const [isPhotoQrSession, setIsPhotoQrSession] = useState(false);
  const [isSwitchingHousehold, setIsSwitchingHousehold] = useState(false);
  const hasInviteSessionRef = useRef(false);
  const isPhotoQrSessionRef = useRef(false);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  const guideTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingInitialFocusRef = useRef<'first' | 'last' | null>(null);
  const guideTriggerId = useId();

  if (trackedPathname !== pathname) {
    setTrackedPathname(pathname);
    if (isGuideMenuOpen) setIsGuideMenuOpen(false);
    if (isMenuOpen) setIsMenuOpen(false);
  }

  const browserHash = useSyncExternalStore(
    subscribeToHashChange,
    getHashSnapshot,
    getServerHashSnapshot
  );
  const [manualHashOverride, setManualHashOverride] = useState<{ base: string; hash: string } | null>(null);

  const activeHash =
    manualHashOverride && manualHashOverride.base === browserHash
      ? manualHashOverride.hash
      : browserHash;

  const setActiveHash = useCallback((hash: string) => {
    setManualHashOverride({ base: getHashSnapshot(), hash });
  }, []);

  const applyGuestSessionStatus = useCallback((nextStatus: string) => {
    const nextInvite = nextStatus === 'invitation';
    const nextPhotoQr = nextStatus === 'photo_qr';
    if (hasInviteSessionRef.current !== nextInvite) {
      hasInviteSessionRef.current = nextInvite;
      setHasInviteSession(nextInvite);
    }
    if (isPhotoQrSessionRef.current !== nextPhotoQr) {
      isPhotoQrSessionRef.current = nextPhotoQr;
      setIsPhotoQrSession(nextPhotoQr);
    }
  }, []);

  const refreshGuestSession = useCallback(
    async (signal?: AbortSignal) => {
      if (isAdmin || isPreview || typeof fetch !== 'function') {
        applyGuestSessionStatus('none');
        return;
      }
      try {
        const res = await fetch(
          withBasePath('/api/guest/session'),
          signal ? { signal } : undefined
        );
        if (signal?.aborted || !res || !res.ok || typeof res.json !== 'function') return;
        const json = await res.json().catch(() => null);
        if (signal?.aborted) return;
        const payload = json?.data ?? json;
        if (payload && typeof payload === 'object' && 'status' in payload) {
          applyGuestSessionStatus(String(payload.status ?? 'none'));
        }
      } catch {
        // Ignore transient or mocked-out fetch errors in global navigation
      }
    },
    [applyGuestSessionStatus, isAdmin, isPreview]
  );

  useEffect(() => {
    if (isAdmin || isPreview || normalizedPathname?.startsWith('/admin')) return;
    const controller = new AbortController();
    void refreshGuestSession(controller.signal);
    const unsubscribe = subscribeGuestSessionChanged(() => {
      void refreshGuestSession();
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [isAdmin, isPreview, normalizedPathname, refreshGuestSession]);

  const handleSwitchHousehold = useCallback(async () => {
    if (isSwitchingHousehold) return;
    setIsSwitchingHousehold(true);
    try {
      if (typeof fetch === 'function') {
        await fetch(withBasePath('/api/guest/session'), { method: 'DELETE' });
      }
    } catch {
      // Proceed to clear client session state even on network failure
    } finally {
      applyGuestSessionStatus('none');
      setIsSwitchingHousehold(false);
      setIsMenuOpen(false);
      notifyGuestSessionChanged();
    }
  }, [applyGuestSessionStatus, isSwitchingHousehold]);

  const handleCloseGuideMenu = useCallback(() => {
    setIsGuideMenuOpen(false);
  }, []);

  const { menuRef: guideOverlayRef } = useMenuPopup(isGuideMenuOpen, handleCloseGuideMenu, {
    triggerRef: guideTriggerRef,
  });
  const { handleMenuKeyDown } = useMenuNavigation(guideOverlayRef);

  useEffect(() => {
    if (!isGuideMenuOpen || pendingInitialFocusRef.current !== 'last') {
      pendingInitialFocusRef.current = null;
      return;
    }
    pendingInitialFocusRef.current = null;
    const items = guideOverlayRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'
    );
    if (items && items.length > 0) {
      items[items.length - 1]?.focus();
    }
  }, [isGuideMenuOpen, guideOverlayRef]);

  // Safely parse features array
  const features = useMemo<HomeFeatureSection[]>(() => {
    let parsed: HomeFeatureSection[] = [];
    try {
      if (typeof config.features === 'string') {
        const candidate = JSON.parse(config.features);
        if (Array.isArray(candidate)) {
          parsed = candidate;
        }
      } else if (Array.isArray(config.features)) {
        parsed = config.features as HomeFeatureSection[];
      }
    } catch {
      // Ignore malformed JSON and fall back to default sections
    }
    return parsed.length > 0 ? parsed : DEFAULT_HOME_FEATURES;
  }, [config.features]);

  useEffect(() => {
    if (normalizedPathname !== '/' || typeof window === 'undefined') return;

    const sectionIds = features
      .filter((f): f is HomeFeatureSection & { id: string } => Boolean(f.visible && f.id && f.id !== 'hero'))
      .map((f) => f.id);

    if (typeof IntersectionObserver === 'undefined') return;

    const observerCallback: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveHash(`#${entry.target.id}`);
        }
      });
    };

    const observerOptions: IntersectionObserverInit = {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0,
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [normalizedPathname, features, setActiveHash]);

  const isLinkActive = (href: string) => {
    if (href.includes('#')) {
      if (normalizedPathname !== '/') return false;
      const hashPart = href.substring(href.indexOf('#'));
      return activeHash === hashPart;
    }
    if (normalizedPathname === '/') {
      if (href === '/') {
        return !activeHash || activeHash === '#top' || activeHash === '#hero';
      }
      return false;
    }
    return normalizedPathname === href;
  };

  const getLinkAriaCurrent = (href: string): 'location' | 'page' | undefined => {
    if (!isLinkActive(href)) return undefined;
    return href.includes('#') ? 'location' : 'page';
  };
  const role = isAdmin ? 'admin' : 'public';
  const baseLinks = useMemo(() => getNavLinks(role, config.modules), [role, config.modules]);
  const isScopedPhotoQrMode = !isAdmin && !isPreview && isPhotoQrSession;

  const adminLinks = useMemo(
    () => (isScopedPhotoQrMode ? [] : baseLinks.filter((l) => l.href.startsWith('/admin'))),
    [baseLinks, isScopedPhotoQrMode]
  );
  const regularLinks = useMemo(
    () => baseLinks.filter((l) => !l.href.startsWith('/admin')),
    [baseLinks]
  );

  const primaryLinks = useMemo<NavLinkItem[]>(() => {
    if (isScopedPhotoQrMode) {
      return [
        { href: '/photos', label: 'Photos' },
        { href: '/photos/slideshow', label: 'Live Slideshow' },
        { href: '/guest/login', label: 'Enter Invite Code' },
      ];
    }
    return regularLinks.filter((l) => PRIMARY_GUEST_PATHS.has(l.href));
  }, [isScopedPhotoQrMode, regularLinks]);
  const rawGuidePageLinks = useMemo<NavLinkItem[]>(
    () =>
      isScopedPhotoQrMode
        ? []
        : regularLinks.filter((l) => !PRIMARY_GUEST_PATHS.has(l.href)),
    [isScopedPhotoQrMode, regularLinks]
  );
  const hasThingsToDoPage = rawGuidePageLinks.some((l) => l.href === '/things-to-do');

  const { sectionLinks, guidePageLinks, secondaryLinks } = useMemo(() => {
    if (isScopedPhotoQrMode) {
      return {
        sectionLinks: [] as NavLinkItem[],
        guidePageLinks: [] as NavLinkItem[],
        secondaryLinks: [] as NavLinkItem[],
      };
    }
    const seenHrefs = new Set<string>(primaryLinks.map((l) => l.href));
    const dedupedSections: NavLinkItem[] = [];
    const dedupedGuides: NavLinkItem[] = [];

    for (const f of features) {
      if (!f.visible || !f.id || f.id === 'hero' || f.id === 'story') continue;
      if (hasThingsToDoPage && (f.id === 'travel' || f.type === 'travel')) continue;
      if (hasVisibleFaqs === false && !isAdmin && (f.id === 'faq' || f.type === 'faq')) continue;
      const href = `/#${f.id}`;
      if (seenHrefs.has(href)) continue;
      seenHrefs.add(href);
      dedupedSections.push({ href, label: f.title || f.id });
    }

    for (const guide of rawGuidePageLinks) {
      if (seenHrefs.has(guide.href)) continue;
      seenHrefs.add(guide.href);
      dedupedGuides.push(guide);
    }

    return {
      sectionLinks: dedupedSections,
      guidePageLinks: dedupedGuides,
      secondaryLinks: [...dedupedSections, ...dedupedGuides],
    };
  }, [features, hasThingsToDoPage, hasVisibleFaqs, isAdmin, isScopedPhotoQrMode, primaryLinks, rawGuidePageLinks]);

  const mobileLinks = [...primaryLinks, ...secondaryLinks, ...adminLinks];
  const isSecondaryActive = secondaryLinks.some((link) => isLinkActive(link.href));
  const brandHref = isScopedPhotoQrMode ? '/photos' : '/';

  const brandLogoUrl = config.brandLogoUrl;
  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const couplesNames = partner1 && partner2 ? `${partner1} & ${partner2}` : (partner1 || partner2);
  const brandLogoAlt = config.brandLogoAlt || (couplesNames ? `${couplesNames} Logo` : 'Brand Logo');
  const hasBrandIdentity = Boolean(config.brandMonogram?.trim() || partner1 || partner2);
  const monogram = hasBrandIdentity ? deriveBrandMonogram(config) : 'Wedding Website';
  const disablePrefetch = normalizedPathname === '/guest/login';
  const defaultHelpCategory = resolveHelpCategoryForPath(normalizedPathname);

  const handleGuideTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isGuideMenuOpen) {
        pendingInitialFocusRef.current = e.key === 'ArrowUp' ? 'last' : 'first';
        setIsGuideMenuOpen(true);
      } else {
        handleMenuKeyDown(e);
      }
    }
  };

  const renderDesktopLink = (link: NavLinkItem) => {
    const active = isLinkActive(link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        prefetch={disablePrefetch ? false : undefined}
        aria-current={getLinkAriaCurrent(link.href)}
        onClick={() => {
          if (link.href.includes('#')) {
            setActiveHash(link.href.substring(link.href.indexOf('#')));
          }
          setIsGuideMenuOpen(false);
        }}
        className={`px-2.5 lg:px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 ${
          active
            ? 'text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] bg-[var(--btn-primary-bg,var(--color-primary))]'
            : 'text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
        }`}
      >
        {link.label}
      </Link>
    );
  };

  const renderDropdownMenuItem = (link: NavLinkItem) => {
    const active = isLinkActive(link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        role="menuitem"
        prefetch={disablePrefetch ? false : undefined}
        aria-current={getLinkAriaCurrent(link.href)}
        onKeyDown={handleMenuKeyDown}
        onClick={() => {
          if (link.href.includes('#')) {
            setActiveHash(link.href.substring(link.href.indexOf('#')));
          }
          setIsGuideMenuOpen(false);
        }}
        className={`block w-full text-left px-3.5 py-2 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] ${
          active
            ? 'text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] bg-[var(--btn-primary-bg,var(--color-primary))]'
            : 'text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
        }`}
      >
        {link.label}
      </Link>
    );
  };

  const desktopNavChildren = (
    <>
      {primaryLinks.map(renderDesktopLink)}

      {secondaryLinks.length > 0 && (
        <div className="relative inline-block text-left">
          <button
            ref={guideTriggerRef}
            id={guideTriggerId}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isGuideMenuOpen}
            aria-controls={isGuideMenuOpen ? 'desktop-guide-menu' : undefined}
            onClick={() => setIsGuideMenuOpen((prev) => !prev)}
            onKeyDown={handleGuideTriggerKeyDown}
            className={`inline-flex items-center gap-1 px-2.5 lg:px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 ${
              isSecondaryActive || isGuideMenuOpen
                ? 'text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] bg-[var(--btn-primary-bg,var(--color-primary))]'
                : 'text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
            }`}
          >
            <span>Event Guide</span>
            <Icon
              name="ChevronDown"
              className={`h-4 w-4 transition-transform ${isGuideMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {isGuideMenuOpen && (
            <div
              id="desktop-guide-menu"
              ref={guideOverlayRef}
              className="origin-top-left absolute left-0 mt-2 w-64 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-lg shadow-xl bg-[var(--card-bg,#ffffff)] border border-[var(--color-surface-border,#e5e7eb)] text-[var(--color-primary-text)] p-1.5 z-50"
            >
              <div
                role="menu"
                aria-orientation="vertical"
                aria-labelledby={guideTriggerId}
                className="space-y-0.5"
              >
                {sectionLinks.map(renderDropdownMenuItem)}
                {sectionLinks.length > 0 && guidePageLinks.length > 0 && (
                  <div
                    role="separator"
                    className="my-1 border-t border-[var(--color-surface-border,#e5e7eb)]"
                  />
                )}
                {guidePageLinks.map(renderDropdownMenuItem)}
              </div>
            </div>
          )}
        </div>
      )}

      {adminLinks.map(renderDesktopLink)}
    </>
  );

  const headerInnerContent = (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between min-h-16 py-1.5 gap-3">
        <div className="flex-shrink-0 flex items-center min-h-12">
          <Link
            href={brandHref}
            prefetch={disablePrefetch ? false : undefined}
            className="flex items-center min-h-[24px] min-w-[24px] text-2xl font-bold text-[var(--color-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 rounded"
          >
            {brandLogoUrl ? (
              <MediaImage
                src={brandLogoUrl}
                alt={brandLogoAlt}
                className="h-10 max-h-12 w-auto object-contain"
              />
            ) : (
              <span className="min-h-[24px] min-w-[24px] inline-flex items-center justify-center">{monogram}</span>
            )}
          </Link>
        </div>
        <div className="hidden md:block flex-1 min-w-0">
          {isPreview ? (
            <div className="ml-3 lg:ml-6 flex flex-wrap items-center gap-x-1 lg:gap-x-2 gap-y-1">
              {desktopNavChildren}
            </div>
          ) : (
            <nav aria-label="Global Navigation" className="ml-3 lg:ml-6 flex flex-wrap items-center gap-x-1 lg:gap-x-2 gap-y-1">
              {desktopNavChildren}
            </nav>
          )}
        </div>
        <div className="hidden md:flex md:items-center md:gap-3 flex-shrink-0">
          {!isAdmin && !isPreview && hasInviteSession && (
            <button
              type="button"
              onClick={() => void handleSwitchHousehold()}
              disabled={isSwitchingHousehold}
              data-testid="navbar-switch-household-button"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[32px] min-w-[32px] rounded-md text-xs font-semibold border border-[var(--color-surface-border,rgba(0,0,0,0.15))] text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2"
            >
              <span>{isSwitchingHousehold ? 'Switching...' : 'Switch Household'}</span>
            </button>
          )}
          <GuestHelpTrigger
            variant="navbar"
            label="Help"
            defaultCategory={defaultHelpCategory}
            config={config}
          />
          <ThemeSelector />
          {isAdmin && (
            <div className="flex items-center">
              <span className="text-sm font-medium text-[var(--color-primary-text)]">Admin Mode</span>
              <button
                onClick={handleLogout}
                className="ml-4 bg-[var(--btn-primary-bg,var(--color-primary))] hover:bg-[var(--btn-primary-hover-bg,var(--color-primary))] text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] text-xs py-1 px-3 min-h-[24px] min-w-[24px] inline-flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2"
              >
                Logout
              </button>
            </div>
          )}
        </div>
        <div className="-mr-2 flex md:hidden">
          <button
            ref={mobileMenuTriggerRef}
            onClick={() => setIsMenuOpen((prev) => !prev)}
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls={isMenuOpen ? 'mobile-menu' : undefined}
            className="relative inline-flex items-center justify-center p-2 rounded-md text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))]"
          >
            <span className="sr-only">{isMenuOpen ? 'Close main menu' : 'Open main menu'}</span>
            {isMenuOpen ? (
              <Icon name="X" className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Icon name="Menu" className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const mobileNavChildren = (
    <>
      {mobileLinks.map((link) => {
        const active = isLinkActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch={disablePrefetch ? false : undefined}
            onClick={() => {
              if (link.href.includes('#')) {
                setActiveHash(link.href.substring(link.href.indexOf('#')));
              }
              setIsMenuOpen(false);
            }}
            aria-current={getLinkAriaCurrent(link.href)}
            className={`block px-3 py-2 rounded-md text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 ${
              active
                ? 'text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] bg-[var(--btn-primary-bg,var(--color-primary))]'
                : 'text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <GuestHelpTrigger
        variant="mobileNav"
        label="Help"
        defaultCategory={defaultHelpCategory}
        config={config}
        onTrigger={() => setIsMenuOpen(false)}
      />
      {!isAdmin && !isPreview && hasInviteSession && (
        <button
          type="button"
          onClick={() => void handleSwitchHousehold()}
          disabled={isSwitchingHousehold}
          data-testid="mobile-navbar-switch-household-button"
          className="flex w-full items-center gap-2 text-left px-3 py-2 rounded-md text-base font-medium text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2"
        >
          <span>{isSwitchingHousehold ? 'Switching...' : 'Switch Household'}</span>
        </button>
      )}
      <div className="pt-3 pb-2 px-3 border-t border-[var(--color-surface-border,#e5e7eb)] flex justify-between items-center">
        <span className="text-sm font-medium text-[var(--color-primary-text)]">Theme</span>
        <ThemeSelector />
      </div>
      {isAdmin && (
        <div className="pt-4 pb-3 border-t border-[var(--color-surface-border,#e5e7eb)]">
          <div className="flex items-center px-5">
            <div className="ml-3">
              <div className="text-base font-medium leading-none text-[var(--color-primary-text)]">Admin Mode</div>
            </div>
          </div>
          <div className="mt-3 px-2 space-y-1">
            <button
              onClick={() => {
                handleLogout();
                setIsMenuOpen(false);
              }}
              className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </>
  );

  const headerClassName =
    'fixed top-0 left-0 right-0 z-50 bg-[var(--color-background,#ffffff)] backdrop-filter backdrop-blur-lg border-b border-[var(--color-surface-border,rgba(0,0,0,0.1))]';

  const navbarContent = (
    <>
      {isPreview ? (
        <div
          ref={headerRef as React.RefObject<HTMLDivElement | null>}
          inert={isMenuOpen || undefined}
          className={headerClassName}
        >
          {headerInnerContent}
        </div>
      ) : (
        <header
          ref={headerRef}
          aria-label="Site header"
          inert={isMenuOpen || undefined}
          className={headerClassName}
        >
          {headerInnerContent}
        </header>
      )}

      <Overlay
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        triggerRef={mobileMenuTriggerRef}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
        animationType="slide-down"
        layoutClassName="fixed top-16 bottom-0 left-0 right-0 z-40 flex flex-col justify-start"
        className="w-full max-h-full overflow-y-auto overscroll-contain bg-[var(--card-bg,#ffffff)] shadow-xl border-b border-[var(--color-surface-border,#e5e7eb)] text-[var(--color-primary-text)]"
      >
        <div className="flex items-center justify-end px-2 pt-2 sm:px-3">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex items-center justify-center p-2 min-h-[24px] min-w-[24px] rounded-md text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))]"
          >
            <Icon name="X" className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {isPreview ? (
          <div className="px-2 pt-1 pb-4 space-y-1 sm:px-3">
            {mobileNavChildren}
          </div>
        ) : (
          <nav aria-label="Mobile Navigation" className="px-2 pt-1 pb-4 space-y-1 sm:px-3">
            {mobileNavChildren}
          </nav>
        )}
      </Overlay>
    </>
  );

  if (!hasProvider) {
    return (
      <GuestHelpProvider config={config} pathname={pathname}>
        {navbarContent}
      </GuestHelpProvider>
    );
  }

  return navbarContent;
}
