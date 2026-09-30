'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ backgroundColor: 'var(--color-background, #111827)', color: 'var(--color-foreground, #F9FAFB)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, fontFamily: 'var(--font-sans, sans-serif)' }}>
        <div style={{ padding: '2rem', maxWidth: '400px', width: '100%', textAlign: 'center', backgroundColor: 'color-mix(in srgb, var(--color-foreground, #F9FAFB) 5%, var(--color-background, #111827))', borderRadius: '0.75rem', border: '1px solid var(--color-border, #4B5563)' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', color: 'var(--color-primary, #B91C1C)' }}>Critical Application Error</h1>
          <p style={{ color: 'var(--color-foreground, #F9FAFB)', opacity: 0.8, marginBottom: '1.5rem' }}>
            A critical error occurred while rendering the application shell.
          </p>
          <button
            onClick={() => reset()}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, backgroundColor: 'var(--color-primary, #B91C1C)', color: 'var(--color-text-on-primary, #FFFFFF)', height: '2.5rem', padding: '0 1rem', width: '100%', border: 'none', cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
