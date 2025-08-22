'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const queryClient = new QueryClient();

export default function RootLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

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

  const handleLogout = () => {
    localStorage.removeItem('isAdminLoggedIn');
    setIsAdmin(false);
    router.push('/');
  };

  return (
    <QueryClientProvider client={queryClient}>
      {isAdmin && (
        <div className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 p-2 text-center text-sm flex justify-between items-center fixed top-0 w-full z-50 border-b border-gray-200 dark:border-gray-700">
          <span>Admin Mode Active</span>
          <button
            onClick={handleLogout}
            className="bg-rose-600 hover:bg-rose-700 text-white text-xs py-1 px-3 rounded-md"
          >
            Logout
          </button>
        </div>
      )}
      <main id="main-content" className={isAdmin ? 'pt-10' : ''}>
        {children}
      </main>
      <SpeedInsights />
      <Analytics />
    </QueryClientProvider>
  );
}
