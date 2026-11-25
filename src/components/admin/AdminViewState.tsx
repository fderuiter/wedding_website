'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';
import { cn } from '@/utils/cn';
import { withBasePath } from '@/lib/basePath';

export interface AdminViewStateProps {
  /**
   * Whether the view is actively loading initial or invalidating data.
   */
  isLoading?: boolean;
  /**
   * The error object or error message encountered during query execution.
   */
  error?: Error | string | { message?: string } | null;
  /**
   * Callback invoked when the user triggers the retry action.
   */
  onRetry?: () => unknown;
  /**
   * External override to indicate if a retry re-fetch is currently pending.
   */
  isRetrying?: boolean;
  /**
   * Custom skeleton loader component. Defaults to a structured layout using `Skeleton`.
   */
  loadingSkeleton?: React.ReactNode;
  /**
   * Accessible text announced by polite live regions during loading.
   * Defaults to 'Loading...'.
   */
  loadingMessage?: string;
  /**
   * Heading title for the error state. Defaults to 'Something went wrong'.
   */
  errorTitle?: string;
  /**
   * Semantic heading level rendered when AdminViewState displays an error or loading state.
   * Defaults to 'h1' since AdminViewState wraps full admin views whose page h1 is inside children.
   */
  headingLevel?: HeadingLevel;
  /**
   * Explicit error message override. If not supplied, extracted from `error`.
   */
  errorMessage?: string;
  /**
   * Route destination for dashboard escape button. Defaults to '/admin/dashboard'.
   */
  dashboardHref?: string;
  /**
   * Accessible button text for dashboard navigation. Defaults to 'Back to Dashboard'.
   */
  dashboardLabel?: string;
  /**
   * Callback override for dashboard navigation instead of router push.
   */
  onNavigateDashboard?: () => void;
  /**
   * Whether to wrap children inside an ErrorBoundary to catch unhandled rendering exceptions.
   * Defaults to true.
   */
  enableErrorBoundary?: boolean;
  /**
   * Optional wrapper container class name.
   */
  className?: string;
  /**
   * Child content rendered when state is ready (not loading and no error).
   */
  children?: React.ReactNode;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

function DefaultAdminSkeleton() {
  return (
    <div className="py-8 px-4 sm:px-6 max-w-5xl mx-auto space-y-6" aria-hidden="true">
      <div className="flex flex-wrap justify-between items-center gap-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="space-y-2 min-w-0 flex-1 basis-64 max-w-full">
          <Skeleton className="h-8 w-full max-w-64" role="presentation" aria-hidden="true" />
          <Skeleton className="h-4 w-full max-w-96" role="presentation" aria-hidden="true" />
        </div>
        <div className="flex flex-wrap gap-2 max-w-full">
          <Skeleton className="h-10 w-24 max-w-full" role="presentation" aria-hidden="true" />
          <Skeleton className="h-10 w-32 max-w-full" role="presentation" aria-hidden="true" />
        </div>
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 flex flex-wrap justify-between items-center gap-3"
          >
            <div className="space-y-2 w-1/2 min-w-36">
              <Skeleton className="h-5 w-3/4" role="presentation" aria-hidden="true" />
              <Skeleton className="h-3 w-1/2" role="presentation" aria-hidden="true" />
            </div>
            <Skeleton className="h-8 w-20" role="presentation" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

interface AdminErrorCardProps {
  title?: string;
  headingLevel?: HeadingLevel;
  message: string;
  onRetry?: () => unknown;
  isRetrying: boolean;
  dashboardHref: string;
  dashboardLabel: string;
  onNavigateDashboard?: () => void;
  className?: string;
}

function AdminErrorCard({
  title = 'Something went wrong',
  headingLevel = 'h1',
  message,
  onRetry,
  isRetrying,
  dashboardHref,
  dashboardLabel,
  onNavigateDashboard,
  className,
}: AdminErrorCardProps) {
  const router = useSafeRouter();

  const handleDashboardClick = () => {
    if (onNavigateDashboard) {
      onNavigateDashboard();
      return;
    }
    if (router?.push) {
      router.push(dashboardHref);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = withBasePath(dashboardHref);
    }
  };

  const formattedMessage = message.startsWith('Error:') ? message : `Error: ${message}`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'p-6 md:p-8 rounded-2xl bg-white/10 dark:bg-gray-800/80 backdrop-blur-md border border-red-500/30 text-center shadow-lg my-8 max-w-xl mx-auto flex flex-col items-center justify-center space-y-4 text-[var(--color-foreground)]',
        className
      )}
    >
      <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
        <Icon name="AlertTriangle" className="w-8 h-8" />
      </div>
      <div>
        <Heading
          as={headingLevel}
          variant="none"
          unstyledColor
          className="text-xl font-bold mb-1 text-red-600 dark:text-red-400"
        >
          {title}
        </Heading>
        <p className="text-sm opacity-90 mb-4">{formattedMessage}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <Button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            variant="primary"
            size="md"
          >
            {isRetrying ? 'Retrying...' : 'Retry'}
          </Button>
        )}
        <Button
          type="button"
          onClick={handleDashboardClick}
          variant="secondary"
          size="md"
        >
          {dashboardLabel}
        </Button>
      </div>
    </div>
  );
}

export function AdminViewState({
  isLoading = false,
  error = null,
  onRetry,
  isRetrying,
  loadingSkeleton,
  loadingMessage = 'Loading...',
  errorTitle,
  headingLevel = 'h1',
  errorMessage,
  dashboardHref = '/admin/dashboard',
  dashboardLabel = 'Back to Dashboard',
  onNavigateDashboard,
  enableErrorBoundary = true,
  className,
  children,
}: AdminViewStateProps) {
  const [internalRetrying, setInternalRetrying] = useState(false);
  const activeRetrying = isRetrying ?? internalRetrying;

  const handleRetry = async () => {
    if (!onRetry || activeRetrying) return;
    try {
      setInternalRetrying(true);
      await onRetry();
    } finally {
      setInternalRetrying(false);
    }
  };

  if (error) {
    const rawMessage = errorMessage || extractErrorMessage(error) || 'Failed to load administrative data.';
    return (
      <AdminErrorCard
        title={errorTitle}
        headingLevel={headingLevel}
        message={rawMessage}
        onRetry={onRetry ? handleRetry : undefined}
        isRetrying={activeRetrying}
        dashboardHref={dashboardHref}
        dashboardLabel={dashboardLabel}
        onNavigateDashboard={onNavigateDashboard}
        className={className}
      />
    );
  }

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className={cn('w-full', className)}>
        <Heading as={headingLevel} variant="none" unstyledColor className="sr-only">
          {loadingMessage}
        </Heading>
        {loadingSkeleton || <DefaultAdminSkeleton />}
      </div>
    );
  }

  if (enableErrorBoundary) {
    return (
      <ErrorBoundary
        onReset={onRetry ? handleRetry : undefined}
        fallback={(err, reset) => (
          <AdminErrorCard
            title={errorTitle}
            headingLevel={headingLevel}
            message={extractErrorMessage(err) || 'An unhandled error occurred while rendering this view.'}
            onRetry={reset}
            isRetrying={activeRetrying}
            dashboardHref={dashboardHref}
            dashboardLabel={dashboardLabel}
            onNavigateDashboard={onNavigateDashboard}
            className={className}
          />
        )}
      >
        {children}
      </ErrorBoundary>
    );
  }

  return <>{children}</>;
}
