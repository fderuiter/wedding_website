'use client';

import { Geist } from "next/font/google";
import "./globals.css";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter for navigation
import LoadingScreen from '@/components/LoadingScreen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const queryClient = new QueryClient();

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
      {/* Apply base theme colors directly to body */}
      <body className={`${geist.variable} bg-[#fffdfc] text-[#374151] selection:bg-rose-100 selection:text-rose-900`}>
        <QueryClientProvider client={queryClient}>
          {loading && <LoadingScreen />}
          {/* Admin Indicator and Logout Button - Restyled */}
          {isAdmin && (
            <div className="bg-gray-100 text-gray-700 p-2 text-center text-sm flex justify-between items-center fixed top-0 w-full z-50 border-b border-gray-200">
              <span>Admin Mode Active</span>
              <button
                onClick={handleLogout}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs py-1 px-3 rounded-md"
              >
                Logout
              </button>
            </div>
          )}
          {/* Add padding top if admin bar is visible */}
          <div className={isAdmin ? 'pt-10' : ''}>
            {children}
          </div>
        </QueryClientProvider>
      </body>
    </html>
  );
}
