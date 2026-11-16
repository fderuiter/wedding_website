'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function GuestError({
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
      title="Guest Portal Error"
      message="An unexpected error occurred while loading the guest mailing address portal. Please try again or return home."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
