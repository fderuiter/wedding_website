'use client';

import { Geist } from "next/font/google";
import "./globals.css";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter for navigation
import LoadingScreen from '@/components/LoadingScreen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Head from 'next/head';
import React from 'react';
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
    <html lang="en" className={`dark ${geist.variable}`}>
      <Head>
        <title>Abbigayle &amp; Frederick&apos;s Wedding</title>
        <link rel="icon" href="/assets/favicon.png" type="image/png" />
        <meta
          name="description"
          content="A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens."
        />
        <meta property="og:type" content="website" />
        <meta
          property="og:title"
          content="Abbigayle & Frederick's Wedding"
        />
        <meta
          property="og:description"
          content="A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens."
        />
        <meta
          property="og:image"
          content="https://abbifred.com/assets/favicon.png"
        />
        <meta property="og:url" content="https://abbifred.com/" />
        <meta
          property="og:site_name"
          content="Abbigayle & Frederick's Wedding"
        />
        <meta name="twitter:card" content="summary" />
        <meta
          name="twitter:title"
          content="Abbigayle & Frederick's Wedding"
        />
        <meta
          name="twitter:description"
          content="A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens."
        />
        <meta name="twitter:image" content="https://abbifred.com/assets/favicon.png" />
        <link rel="canonical" href="https://abbifred.com/" />
      </Head>
      {/* Apply base theme colors directly to body */}
      <body
        className={`${geist.variable} bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-800`}
      >
        <QueryClientProvider client={queryClient}>
          {loading && <LoadingScreen />}
          {/* Admin Indicator and Logout Button - Restyled */}
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
          {/* Add padding top if admin bar is visible */}
          <main id="main-content" className={isAdmin ? 'pt-10' : ''}>
            {children}
          </main>
        </QueryClientProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
