'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function GlobalRadialGlow() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');
  
  const [isVisible, setIsVisible] = useState(true);

  // Minimal CPU cycles when tab is inactive
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Initialize state
    setIsVisible(document.visibilityState === 'visible');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (isAdmin || !isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 -z-50 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_50%,rgba(190,18,60,0.06),transparent)] animate-pulse-scale" />
    </div>
  );
}
