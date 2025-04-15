'use client';

import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter for navigation
import LoadingScreen from '@/components/LoadingScreen';

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter(); // Initialize router

  useEffect(() => {
    // Check login status on initial mount and whenever localStorage might change
    const checkLoginStatus = () => {
      const loggedIn = localStorage.getItem('isAdminLoggedIn') === 'true';
      setIsAdmin(loggedIn);
    };

    checkLoginStatus();

    // Optional: Listen for storage changes if login/logout might happen in other tabs
    window.addEventListener('storage', checkLoginStatus);

    return () => {
      window.removeEventListener('storage', checkLoginStatus);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('isAdminLoggedIn');
    setIsAdmin(false);
    // Redirect to home or login page after logout
    router.push('/');
    // Optionally force a reload to ensure all components re-evaluate admin status
    // window.location.reload();
  };

  useEffect(() => {
    // Loading screen logic
    const handleLoad = () => setLoading(false);
    if (document.readyState === 'complete') {
      setLoading(false);
    } else {
      window.addEventListener('load', handleLoad);
    }
    return () => window.removeEventListener('load', handleLoad);
  }, []);

  return (
    <html lang="en" className={geist.variable}>
      <body className={geist.variable}>
        {loading && <LoadingScreen />}
        {/* Admin Indicator and Logout Button */}
        {isAdmin && (
          <div className="bg-yellow-200 text-yellow-800 p-2 text-center text-sm flex justify-between items-center fixed top-0 w-full z-50">
            <span>Admin Mode Active</span>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white text-xs py-1 px-2 rounded"
            >
              Logout
            </button>
          </div>
        )}
        <nav className={`fixed w-full bg-white/80 backdrop-blur-sm border-b z-40 ${isAdmin ? 'top-10' : 'top-0'}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <Link href="/" className="flex items-center font-medium">
                  A&F
                </Link>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/registry" className="px-4 py-2 rounded-md text-sm font-medium text-gray-900 hover:bg-gray-100">
                  Registry
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main className={`pt-16 ${isAdmin ? 'mt-10' : ''}`}>
          {children}
        </main>
      </body>
    </html>
  );
}
