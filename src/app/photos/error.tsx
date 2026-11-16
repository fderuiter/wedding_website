'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function PhotosError({
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
      title="Photo Gallery Error"
      message="An unexpected error occurred while loading the photo gallery. Please try again or return home."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
