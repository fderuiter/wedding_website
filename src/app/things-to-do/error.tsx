'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function ThingsToDoError({
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
      title="Things to Do Error"
      message="An unexpected error occurred while loading local attractions and recommendations. Please try again or return home."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
