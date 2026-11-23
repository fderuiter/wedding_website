'use client';

import { useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClientContext } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import {
  ADMIN_SAMPLE_DATA_QUERY_KEY,
  invalidateSampleDataCaches,
  subscribeToAdminCacheSync,
} from '@/lib/adminCacheSync';

export function SampleDataBanner() {
  const router = useRouter();
  const queryClient = useContext(QueryClientContext);
  const [hasSampleData, setHasSampleData] = useState<boolean>(false);
  const [countsSummary, setCountsSummary] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const { addToast, confirm } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch('/api/admin/sample-data');
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

  const handlePurge = async () => {
    const confirmed = await confirm(
      'Are you sure you want to purge all sample data? This will permanently delete demo items while preserving all custom entities.'
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/sample-data', {
        method: 'DELETE',
      });
      if (res.ok) {
        setHasSampleData(false);
        setCountsSummary('');
        await invalidateSampleDataCaches(queryClient);
        addToast('All sample data has been successfully purged.', 'success');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(data.error || 'Failed to purge sample data.', 'error');
      }
    } catch (err: any) {
      addToast(err.message || 'Error purging sample data.', 'error');
    } finally {
      setLoading(false);
    }
  };

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
            aria-label="Purge all sample data"
          >
            {loading ? 'Purging Sample Data...' : 'Purge Sample Data'}
          </Button>
        </div>
      </div>
    </div>
  );
}
