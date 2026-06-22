'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PublicAppConfig } from '@/lib/config';
import { Button } from '@/components/ui/Button';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/photos', label: 'Photos' },
  { href: '/archive', label: 'Archive' },
];

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

  const homeNavLinks = features
    .filter((f) => f.visible && f.id !== 'hero' && f.id !== 'story')
    .map((f) => ({ href: `/#${f.id}`, label: f.title || f.id }));

  const allLinks =
    pathname === '/' ? [...navLinks, ...homeNavLinks] : navLinks;

  if (isAdmin) {
    allLinks.push({ href: '/admin/dashboard', label: 'Dashboard' });
  }

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 bg-transparent backdrop-filter backdrop-blur-lg border-b border-gray-200 dark:border-gray-700"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[var(--header-h)]">
          <div className="flex-shrink-0">
            <Link href="/" className="text-2xl font-bold text-gray-800 dark:text-white">
              A & F
            </Link>
          </div>
          <div className="hidden md:block">
            <nav className="ml-10 flex items-baseline space-x-4">
              {allLinks.map((link) => (
                <Button
                  key={link.href}
                  href={link.href}
                  variant={pathname === link.href ? 'primary' : 'ghost'}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className="px-3 py-2 text-sm"
                >
                  {link.label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="hidden md:block">
            {isAdmin && (
              <div className="ml-4 flex items-center md:ml-6">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Admin Mode</span>
                <Button
                  onClick={handleLogout}
                  variant="primary"
                  className="ml-4 text-xs px-3 py-1"
                >
                  Logout
                </Button>
              </div>
            )}
          </div>
          <div className="-mr-2 flex md:hidden">
            <Button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              type="button"
              variant="ghost"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-menu"
              className="p-2 text-gray-400"
            >
              <span className="sr-only">{isMenuOpen ? 'Close main menu' : 'Open main menu'}</span>
              {isMenuOpen ? (
                <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </Button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden" id="mobile-menu">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 flex flex-col">
            {allLinks.map((link) => (
              <Button
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                variant={pathname === link.href ? 'primary' : 'ghost'}
                aria-current={pathname === link.href ? "page" : undefined}
                className="w-full justify-start text-base px-3 py-2"
              >
                {link.label}
              </Button>
            ))}
            {isAdmin && (
              <div className="pt-4 pb-3 border-t border-gray-700">
                <div className="flex items-center px-5">
                  <div className="ml-3">
                    <div className="text-base font-medium leading-none text-white">Admin Mode</div>
                  </div>
                </div>
                <div className="mt-3 px-2 space-y-1 flex flex-col">
                  <Button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    variant="ghost"
                    className="w-full justify-start text-base px-3 py-2 text-gray-400 hover:text-white"
                  >
                    Logout
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
