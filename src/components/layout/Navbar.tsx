'use client';

import { Icon } from '../ui/Icon';
import { Overlay } from '../ui/Overlay';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PublicAppConfig } from '@/lib/config';
import { getNavLinks } from '@/lib/routes';
import { ThemeSelector } from '../ui/ThemeSelector';
import { deriveBrandMonogram } from '@/features/content';

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
}

/**
 * @function Navbar
 * @description A responsive navigation bar component for the application.
 * It displays different navigation links based on the current page and user's admin status.
 * It also includes a mobile-friendly menu.
 * @param {NavbarProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Navbar component.
 */
export default function Navbar({ isAdmin, handleLogout, headerRef, config }: NavbarProps) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setActiveHash(window.location.hash);

    const handleHashChange = () => {
      setActiveHash(window.location.hash);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Safely parse features array
  let features: any[] = [];
  try {
    if (typeof config.features === 'string') {
      features = JSON.parse(config.features);
    } else if (Array.isArray(config.features)) {
      features = config.features;
    }
  } catch(e) {}

  if (features.length === 0) {
    features = [
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
      { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
      { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
      { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
      { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
    ];
  }

  useEffect(() => {
    if (pathname !== '/' || typeof window === 'undefined') return;

    const sectionIds = features
      .filter((f) => f.visible && f.id !== 'hero')
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
  }, [pathname, features]);

  const isLinkActive = (href: string) => {
    if (href.includes('#')) {
      if (pathname !== '/') return false;
      const hashPart = href.substring(href.indexOf('#'));
      return activeHash === hashPart;
    }
    if (pathname === '/') {
      if (href === '/') {
        return !activeHash || activeHash === '#top' || activeHash === '#hero';
      }
      return false;
    }
    return pathname === href;
  };

  const homeNavLinks = features
    .filter((f) => f.visible && f.id !== 'hero' && f.id !== 'story')
    .map((f) => ({ href: `/#${f.id}`, label: f.title || f.id }));

  const role = isAdmin ? 'admin' : 'public';
  const baseLinks = getNavLinks(role, (config as any)?.modules);

  const adminLinks = baseLinks.filter(l => l.href.startsWith('/admin'));
  const regularLinks = baseLinks.filter(l => !l.href.startsWith('/admin'));

  const allLinks =
    pathname === '/' 
      ? [...regularLinks, ...homeNavLinks, ...adminLinks] 
      : [...baseLinks];

  const brandLogoUrl = config.brandLogoUrl;
  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const couplesNames = partner1 && partner2 ? `${partner1} & ${partner2}` : (partner1 || partner2);
  const brandLogoAlt = config.brandLogoAlt || (couplesNames ? `${couplesNames} Logo` : 'Brand Logo');
  const monogram = deriveBrandMonogram(config);

  return (
    <>
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 bg-transparent backdrop-filter backdrop-blur-lg border-b border-[var(--color-surface-border,rgba(0,0,0,0.1))]"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex-shrink-0 flex items-center h-16">
              <Link
                href="/"
                className="flex items-center text-2xl font-bold text-[var(--color-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 rounded"
              >
                {brandLogoUrl ? (
                  <img
                    src={brandLogoUrl}
                    alt={brandLogoAlt}
                    className="h-10 max-h-12 w-auto object-contain"
                  />
                ) : (
                  <span>{monogram}</span>
                )}
              </Link>
            </div>
            <div className="hidden md:block">
              <nav aria-label="Global Navigation" className="ml-10 flex items-baseline space-x-4">
                {allLinks.map((link) => {
                  const active = isLinkActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        if (link.href.includes('#')) {
                          setActiveHash(link.href.substring(link.href.indexOf('#')));
                        }
                      }}
                      className={`px-3 py-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2 ${
                        active
                          ? 'text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] bg-[var(--btn-primary-bg,var(--color-primary))]'
                          : 'text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="hidden md:flex md:items-center md:gap-4">
              <ThemeSelector />
              {isAdmin && (
                <div className="flex items-center">
                  <span className="text-sm font-medium text-[var(--color-primary-text)]">Admin Mode</span>
                  <button
                    onClick={handleLogout}
                    className="ml-4 bg-[var(--btn-primary-bg,var(--color-primary))] hover:bg-[var(--btn-primary-hover-bg,var(--color-primary))] text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))] text-xs py-1 px-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))] focus-visible:ring-offset-2"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
            <div className="-mr-2 flex md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                type="button"
                aria-expanded={isMenuOpen}
                aria-controls="mobile-menu"
                className="inline-flex items-center justify-center p-2 rounded-md text-[var(--color-primary-text)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary))]"
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
      </header>

      <Overlay 
        isOpen={isMenuOpen} 
        onClose={() => setIsMenuOpen(false)} 
        id="mobile-menu" 
        animationType="slide-down"
        layoutClassName="fixed top-16 bottom-0 left-0 right-0 z-40 flex flex-col justify-start"
        className="w-full bg-[var(--card-bg,#ffffff)] shadow-xl border-b border-[var(--color-surface-border,#e5e7eb)] text-[var(--color-primary-text)]"
      >
        <nav aria-label="Mobile Navigation" className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
          {allLinks.map((link) => {
            const active = isLinkActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => {
                  if (link.href.includes('#')) {
                    setActiveHash(link.href.substring(link.href.indexOf('#')));
                  }
                  setIsMenuOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
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
        </nav>
      </Overlay>
    </>
  );
}
