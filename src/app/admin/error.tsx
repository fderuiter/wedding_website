'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function AdminError({
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
      title="Admin Portal Error"
      message="An unexpected error occurred while loading this administrative view. You can retry the operation or return to the main dashboard."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Dashboard Overview',
        href: '/admin/dashboard',
      }}
    />
  );
}
