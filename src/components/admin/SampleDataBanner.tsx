'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useOptionalToast } from '@/components/ui/ToastProvider';

export function SampleDataBanner() {
  const [hasSampleData, setHasSampleData] = useState<boolean>(false);
  const [countsSummary, setCountsSummary] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const toast = useOptionalToast();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sample-data');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setHasSampleData(Boolean(data.hasSampleData));
        if (data.counts) {
          const parts = [];
          if (data.counts.registry) parts.push(`${data.counts.registry} registry items`);
          if (data.counts.guests) parts.push(`${data.counts.guests} guests`);
          if (data.counts.seating) parts.push(`${data.counts.seating} tables`);
          if (data.counts.weddingParty) parts.push(`${data.counts.weddingParty} party members`);
          if (data.counts.attractions) parts.push(`${data.counts.attractions} attractions`);
          setCountsSummary(parts.join(', '));
        }
      }
    } catch {
      // Ignore network errors in background polling
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handlePurge = async () => {
    const confirmed = toast?.confirm
      ? await toast.confirm(
        'Are you sure you want to purge all sample data? This will permanently delete demo items while preserving all custom entities.'
      )
      : window.confirm(
        'Are you sure you want to purge all sample data? This will permanently delete demo items while preserving all custom entities.'
      );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/sample-data', {
        method: 'DELETE',
      });
      if (res.ok) {
        if (toast?.addToast) toast.addToast('All sample data has been successfully purged.', 'success');
        setHasSampleData(false);
        // Refresh the page to reload dashboard tables with clean state
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        if (toast?.addToast) toast.addToast(data.error || 'Failed to purge sample data.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error purging sample data.';
      if (toast?.addToast) toast.addToast(msg, 'error');
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
