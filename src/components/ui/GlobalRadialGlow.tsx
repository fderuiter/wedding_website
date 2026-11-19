'use client';

import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

function subscribeToVisibilityChange(onStoreChange: () => void) {
  if (typeof document === 'undefined') {
    return () => {};
  }
  document.addEventListener('visibilitychange', onStoreChange);
  return () => {
    document.removeEventListener('visibilitychange', onStoreChange);
  };
}

function getVisibilitySnapshot() {
  return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
}

function getServerVisibilitySnapshot() {
  return true;
}

export function GlobalRadialGlow() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  // Minimal CPU cycles when tab is inactive
  const isVisible = useSyncExternalStore(
    subscribeToVisibilityChange,
    getVisibilitySnapshot,
    getServerVisibilitySnapshot
  );

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
