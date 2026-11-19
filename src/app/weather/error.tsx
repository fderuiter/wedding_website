'use client';

import { RouteErrorFallback } from '@/components/ui/RouteErrorFallback';

export default function WeatherError({
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
      title="Weather Forecast Error"
      message="An unexpected error occurred while loading the wedding day weather forecast. Please try again or return home."
      resetLabel="Try Again"
      secondaryAction={{
        label: 'Return Home',
        href: '/',
      }}
    />
  );
}
