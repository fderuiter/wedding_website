'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/ToastProvider';

export interface RouteErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  message?: string;
  resetLabel?: string;
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
  toastMessage?: string;
}

/**
 * Hook to safely retrieve toast context even if rendered outside a ToastProvider.
 */
function useSafeToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

/**
 * RouteErrorFallback provides a standardized error fallback for Next.js App Router error boundaries.
 * It displays contextual feedback with brand tokens and accessibility roles,
 * dispatches a toast notification, and provides recovery actions (primary retry and optional secondary navigation).
 */
export function RouteErrorFallback({
  error,
  reset,
  title = 'Something went wrong!',
  message = 'An unexpected error occurred while loading this page. Please try reloading or clicking below to try again.',
  resetLabel = 'Try Again',
  secondaryAction,
  className = '',
  toastMessage,
}: RouteErrorFallbackProps) {
  const toastContext = useSafeToast();
  const notifiedRef = useRef(false);

  useEffect(() => {
    console.error('Route error boundary caught an error:', error);
    if (!notifiedRef.current && toastContext?.addToast) {
      toastContext.addToast(
        toastMessage || message || error?.message || 'An unexpected error occurred',
        'error'
      );
      notifiedRef.current = true;
    }
  }, [error, toastContext, toastMessage, message]);

  return (
    <div className={`flex flex-col items-center justify-center min-h-[50vh] px-4 py-12 text-center w-full ${className}`}>
      <div
        role="alert"
        aria-live="assertive"
        className="bg-[var(--color-background)] p-8 rounded-2xl shadow-lg border border-[var(--color-border)] max-w-lg w-full text-center flex flex-col items-center justify-center space-y-5"
      >
        <div className="p-3.5 rounded-full bg-primary/10 text-primary">
          <Icon name="AlertTriangle" className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-[var(--color-foreground)]">
            {title}
          </h2>
          <p className="text-sm text-[var(--color-foreground)] opacity-80 leading-relaxed max-w-md">
            {message}
          </p>
          {process.env.NODE_ENV !== 'production' && error?.message && (
            <p className="text-xs text-red-500 font-mono mt-3 p-2 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-800 break-words max-w-full text-left">
              {error.message}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full pt-2">
          <Button
            onClick={() => reset()}
            variant="primary"
            size="md"
            className="w-full sm:w-auto min-w-[120px]"
          >
            {resetLabel}
          </Button>

          {secondaryAction && (
            secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                onClick={secondaryAction.onClick}
                className="w-full sm:w-auto inline-flex items-center justify-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 h-10 py-2 px-4 rounded-[var(--btn-radius,0.375rem)] border border-[var(--color-border)] hover:bg-black/5 dark:hover:bg-white/5 text-[var(--color-foreground)] min-w-[120px]"
              >
                {secondaryAction.label}
              </Link>
            ) : secondaryAction.onClick ? (
              <Button
                onClick={secondaryAction.onClick}
                variant="outline"
                size="md"
                className="w-full sm:w-auto min-w-[120px]"
              >
                {secondaryAction.label}
              </Button>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
