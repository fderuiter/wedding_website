'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function WeddingPartyError({
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
      title="Wedding Party Error"
      message="An unexpected error occurred while loading the wedding party profiles. Please try again or return home."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
