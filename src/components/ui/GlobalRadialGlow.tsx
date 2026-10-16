'use client';

import { useEffect, useState } from 'react';
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
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 motion-safe:animate-pulse-scale"
        style={{
          background:
            'var(--glow-gradient, radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 6%, transparent), transparent))',
        }}
      />
    </div>
  );
}
