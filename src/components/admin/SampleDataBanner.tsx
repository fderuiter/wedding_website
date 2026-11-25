'use client';

import { useState, useEffect, useContext, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClientContext } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { withBasePath } from '@/lib/basePath';
import {
  ADMIN_SAMPLE_DATA_QUERY_KEY,
  invalidateSampleDataCaches,
  subscribeToAdminCacheSync,
} from '@/lib/adminCacheSync';

function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

function usePurgeSampleData(onPurged?: () => void) {
  const router = useOptionalRouter();
  const queryClient = useContext(QueryClientContext);
  const toast = useOptionalToast();
  const [loading, setLoading] = useState<boolean>(false);

  const handlePurge = useCallback(async () => {
    const promptMessage =
      'Are you sure you want to purge all sample data? This will permanently delete demo items while preserving all custom entities.';
    const confirmed = toast
      ? await toast.confirm(promptMessage)
      : typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(promptMessage)
        : true;
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(withBasePath('/api/admin/sample-data'), {
        method: 'DELETE',
      });
      if (res.ok) {
        onPurged?.();
        await invalidateSampleDataCaches(queryClient);
        toast?.addToast('All sample data has been successfully purged.', 'success');
        router?.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast?.addToast(data.error || 'Failed to purge sample data.', 'error');
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message ? err.message : 'Error purging sample data.';
      toast?.addToast(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [onPurged, queryClient, router, toast]);

  return { loading, handlePurge };
}

export function SampleDataBanner() {
  const queryClient = useContext(QueryClientContext);
  const [hasSampleData, setHasSampleData] = useState<boolean>(false);
  const [countsSummary, setCountsSummary] = useState<string>('');

  const handlePurged = useCallback(() => {
    setHasSampleData(false);
    setCountsSummary('');
  }, []);

  const { loading, handlePurge } = usePurgeSampleData(handlePurged);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch(withBasePath('/api/admin/sample-data'));
        if (!res || !res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setHasSampleData(Boolean(data.hasSampleData));
          if (data.counts) {
            const parts = [];
            if (data.counts.registry) parts.push(`${data.counts.registry} registry items`);
            if (data.counts.guests) parts.push(`${data.counts.guests} guests`);
            if (data.counts.seating) parts.push(`${data.counts.seating} tables`);
            if (data.counts.weddingParty) parts.push(`${data.counts.weddingParty} party members`);
            if (data.counts.attractions) parts.push(`${data.counts.attractions} attractions`);
            if (data.counts.faqs) parts.push(`${data.counts.faqs} FAQs`);
            setCountsSummary(parts.join(', '));
          } else {
            setCountsSummary('');
          }
        }
      } catch {
        // Ignore network errors in background polling
      }
    }

    void loadStatus();
    const unsubscribe = subscribeToAdminCacheSync(
      queryClient,
      ['sample-data'],
      [ADMIN_SAMPLE_DATA_QUERY_KEY],
      () => {
        void loadStatus();
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [queryClient]);

  if (!hasSampleData) return null;

  return (
    <div
      data-testid="sample-data-banner"
      role="region"
      aria-label="Sample Data Notification"
      className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 px-4 py-3 shadow-xs"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-3 text-sm">
          <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
          </span>
          <div>
            <span className="font-bold">Sample Data Active:</span>{' '}
            <span>
              Your site currently contains sample records ({countsSummary || 'demo content'}).
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <Button
            variant="danger"
            size="sm"
            onClick={handlePurge}
            disabled={loading}
          >
            {loading ? 'Purging Sample Data...' : 'Purge Sample Data'}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SeatingSampleDataBannerProps {
  hiddenTableCount: number;
  hiddenGuestCount: number;
}

export function SeatingSampleDataBanner({
  hiddenTableCount,
  hiddenGuestCount,
}: SeatingSampleDataBannerProps) {
  const countsKey = `${hiddenTableCount}:${hiddenGuestCount}`;
  const [purgedCountsKey, setPurgedCountsKey] = useState<string | null>(null);

  const handlePurged = useCallback(() => {
    setPurgedCountsKey(countsKey);
  }, [countsKey]);

  const { loading, handlePurge } = usePurgeSampleData(handlePurged);
  const dismissedAfterPurge = purgedCountsKey === countsKey;

  if (dismissedAfterPurge || (hiddenTableCount <= 0 && hiddenGuestCount <= 0)) {
    return null;
  }

  const tableLabel = `${hiddenTableCount} sample table${hiddenTableCount === 1 ? '' : 's'}`;
  const guestLabel = `${hiddenGuestCount} sample guest${hiddenGuestCount === 1 ? '' : 's'}`;
  const hiddenSummary =
    hiddenTableCount > 0 && hiddenGuestCount > 0
      ? `${tableLabel} and ${guestLabel} are`
      : hiddenTableCount > 0
        ? `${tableLabel} ${hiddenTableCount === 1 ? 'is' : 'are'}`
        : `${guestLabel} ${hiddenGuestCount === 1 ? 'is' : 'are'}`;

  return (
    <div
      data-testid="seating-sample-data-banner"
      role="region"
      aria-label="Hidden Sample Seating Records"
      className="bg-amber-50/90 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100 px-4 py-2.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-[13px] shadow-xs print:hidden"
    >
      <div className="flex items-center gap-2.5">
        <svg
          className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          />
        </svg>
        <span>
          <strong className="font-semibold">Sample records hidden:</strong> {hiddenSummary} excluded
          from live seating, auto-assign, and caterer exports.
        </span>
      </div>
      <div className="flex items-center shrink-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePurge}
          disabled={loading}
          className="!h-7 min-h-[28px] !px-2.5 !py-1 !text-xs font-medium !border-amber-400 dark:!border-amber-700 !text-amber-950 dark:!text-amber-100 !bg-amber-100/80 dark:!bg-amber-900/50 hover:!bg-amber-200/80 dark:hover:!bg-amber-800/70"
        >
          {loading ? 'Purging Sample Data...' : 'Purge Sample Data'}
        </Button>
      </div>
    </div>
  );
}
