'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/photos', label: 'Photos' },
  { href: '/archive', label: 'Archive' },
];

const homeNavLinks = [
  { href: '#details', label: 'Details' },
  { href: '#travel', label: 'Travel' },
  { href: '#faq', label: 'FAQ' },
];

/**
 * @interface NavbarProps
 * @description Defines the props for the Navbar component.
 * @property {boolean} isAdmin - Indicates if the current user is an administrator.
 * @property {() => void} handleLogout - Function to handle user logout.
 * @property {React.RefObject<HTMLElement | null>} headerRef - Ref to the header element for layout calculations.
 */
interface NavbarProps {
  isAdmin: boolean;
  handleLogout: () => void;
  headerRef: React.RefObject<HTMLElement | null>;
}

/**
 * @function Navbar
 * @description A responsive navigation bar component for the application.
 * It displays different navigation links based on the current page and user's admin status.
 * It also includes a mobile-friendly menu.
 * @param {NavbarProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Navbar component.
 */
export default function Navbar({ isAdmin, handleLogout, headerRef }: NavbarProps) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const allLinks =
    pathname === '/' ? [...navLinks, ...homeNavLinks] : navLinks;

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 bg-transparent backdrop-filter backdrop-blur-lg border-b border-gray-200 dark:border-gray-700"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex-shrink-0">
            <Link href="/" className="text-2xl font-bold text-gray-800 dark:text-white">
              A & F
            </Link>
          </div>
          <div className="hidden md:block">
            <nav className="ml-10 flex items-baseline space-x-4">
              {allLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    pathname === link.href
                      ? 'text-white bg-rose-500'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="hidden md:block">
            {isAdmin && (
              <div className="ml-4 flex items-center md:ml-6">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Admin Mode</span>
                <button
                  onClick={handleLogout}
                  className="ml-4 bg-rose-600 hover:bg-rose-700 text-white text-xs py-1 px-3 rounded-md"
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
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
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
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            {allLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-base font-medium ${
                  pathname === link.href
                    ? 'text-white bg-rose-500'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {link.label}
              </Link>
            ))}
            {isAdmin && (
              <div className="pt-4 pb-3 border-t border-gray-700">
                <div className="flex items-center px-5">
                  <div className="ml-3">
                    <div className="text-base font-medium leading-none text-white">Admin Mode</div>
                  </div>
                </div>
                <div className="mt-3 px-2 space-y-1">
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-400 hover:text-white hover:bg-gray-700"
                  >
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
