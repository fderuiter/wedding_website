'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorFallback
      error={error}
      reset={reset}
      title="Something went wrong!"
      message="An unexpected error occurred while loading this page. Please try reloading or clicking below to try again."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
