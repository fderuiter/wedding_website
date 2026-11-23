'use client';

import { useState, useEffect, useCallback, useContext, Suspense } from 'react';
import * as NextNavigation from 'next/navigation';
import {
  QueryClient,
  QueryClientProvider,
  QueryClientContext,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { SegmentedTabs, SegmentedTabPanel } from '@/components/ui/SegmentedTabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatDate } from '@/utils/intl';
import { formatEntitySectionLabel } from '@/utils/adminLabels';
import { apiClient } from '@/features/admin';
import type { BroadcastHistoryItem } from '@/features/broadcast';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { Dialog } from '@/components/ui/Dialog';

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface HistoryTimelineContentProps {
  versions: any[];
  loading: boolean;
  page: number;
  limit: number;
  paginationMeta: PaginationMeta | null;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  fetchVersions: (_currentPage?: number, _currentLimit?: number, _options?: { background?: boolean }) => Promise<void>;
}

const useSafeSearchParams: () => { get: (_key: string) => string | null } | null =
  typeof NextNavigation.useSearchParams === 'function'
    ? NextNavigation.useSearchParams
    : () => null;

function resolveInitialHistoryTab(
  searchParams: { get: (_key: string) => string | null } | null
): 'timeline' | 'broadcasts' {
  const paramFromHook = searchParams?.get('tab');
  if (paramFromHook === 'broadcasts' || paramFromHook === 'timeline') {
    return paramFromHook;
  }
  if (typeof window !== 'undefined') {
    const paramFromWindow = new URLSearchParams(window.location.search).get('tab');
    if (paramFromWindow === 'broadcasts' || paramFromWindow === 'timeline') {
      return paramFromWindow;
    }
  }
  return 'timeline';
}

function HistoryTimelineContent({
  versions,
  loading,
  page,
  limit,
  paginationMeta,
  setPage,
  fetchVersions,
}: HistoryTimelineContentProps) {
  const searchParams = useSafeSearchParams();
  const requestedTab = resolveInitialHistoryTab(searchParams);
  const [tabSelection, setTabSelection] = useState<{
    sourceTab: 'timeline' | 'broadcasts';
    value: 'timeline' | 'broadcasts';
  }>(() => ({
    sourceTab: requestedTab,
    value: requestedTab,
  }));
  const activeTab =
    tabSelection.sourceTab === requestedTab ? tabSelection.value : requestedTab;
  const setActiveTab = (nextTab: 'timeline' | 'broadcasts') => {
    setTabSelection({ sourceTab: requestedTab, value: nextTab });
  };
  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastHistoryItem | null>(null);

  const queryClient = useQueryClient();
  const { addToast, confirm } = useToast();
  const {
    history: broadcastHistory,
    loadingHistory,
    retryBroadcast,
    retrying,
    cancelScheduledBroadcast,
    cancelling,
  } = useAdminBroadcast({ fetchHistory: activeTab === 'broadcasts' });

  const selectedBroadcastId = selectedBroadcast?.id ?? null;
  const hasPreloadedRecipients = Array.isArray(selectedBroadcast?.recipients);

  const {
    data: fetchedBroadcastDetail,
    isFetching: loadingBroadcastDetail,
    error: broadcastDetailError,
  } = useQuery<BroadcastHistoryItem | null, Error>({
    queryKey: ['admin-broadcast-detail', selectedBroadcastId],
    queryFn: async () => {
      if (!selectedBroadcastId) return null;
      const detail = await apiClient.get<BroadcastHistoryItem>(
        `/api/admin/broadcast/${encodeURIComponent(selectedBroadcastId)}`
      );
      if (
        detail &&
        !Array.isArray(detail) &&
        typeof detail === 'object' &&
        'id' in detail &&
        detail.id === selectedBroadcastId
      ) {
        return detail;
      }
      return null;
    },
    enabled: Boolean(selectedBroadcastId),
  });

  const resolvedBroadcast = fetchedBroadcastDetail ?? selectedBroadcast;
  const resolvedRecipients = fetchedBroadcastDetail?.recipients ?? selectedBroadcast?.recipients;
  const showDetailLoading = loadingBroadcastDetail && !hasPreloadedRecipients && !fetchedBroadcastDetail;
  const showDetailError =
    Boolean(broadcastDetailError) && !hasPreloadedRecipients && !fetchedBroadcastDetail;

  const handleRestore = async (versionId: string) => {
    if (!(await confirm('Are you sure you want to restore this version? This will instantly replace the Live content.'))) return;
    try {
      await apiClient.post(`/api/admin/versions/${versionId}/restore`);
      addToast('Restored successfully.', 'success');
      fetchVersions(page, limit, { background: true });
    } catch (e: any) {
      addToast(e.message || 'Failed to restore.', 'error');
    }
  };

  const handleRetryBroadcast = async (broadcastId: string) => {
    try {
      await retryBroadcast({ broadcastId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-history'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-detail'] }),
      ]);
      addToast('Retry initiated for failed recipients.', 'success');
    } catch (e: any) {
      addToast(e.message || 'Retry failed.', 'error');
    }
  };

  const handleCancelSchedule = async (broadcastId: string) => {
    if (!(await confirm('Are you sure you want to cancel this scheduled broadcast?'))) return;
    try {
      await cancelScheduledBroadcast(broadcastId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-history'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-broadcast-detail'] }),
      ]);
      addToast('Scheduled broadcast cancelled.', 'success');
    } catch (e: any) {
      addToast(e.message || 'Failed to cancel scheduled broadcast.', 'error');
    }
  };

  const totalPages = paginationMeta?.totalPages ?? 1;
  const totalItems = paginationMeta?.total ?? versions.length;

  return (
    <div className="py-10 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-4xl font-extrabold text-primary tracking-tight">System & Activity History</h1>

        <SegmentedTabs
          idPrefix="history"
          panelId="history-view-panel"
          aria-label="History views"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: 'timeline', label: 'Content Snapshots' },
            { value: 'broadcasts', label: 'Broadcast Delivery Logs' },
          ]}
        />
      </div>

      <SegmentedTabPanel
        id="history-view-panel"
        tabId={`history-tab-${activeTab}`}
      >
        {activeTab === 'timeline' ? (
          <>
            <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-primary dark:border-gray-700">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Restore</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-gray-500 dark:text-gray-400 py-4">No history found.</TableCell>
                    </TableRow>
                  )}
                  {versions.map((v) => {
                    const isDelete = v.data?.deleted === true;
                    return (
                      <TableRow key={v.id}>
                        <TableCell>{formatDate(v.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</TableCell>
                        <TableCell className="font-semibold">{formatEntitySectionLabel(v.entityType)}</TableCell>
                        <TableCell>{v.author || 'System'}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${isDelete ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                            {isDelete ? 'Deleted' : 'Created/Updated'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button 
                            size="sm" 
                            variant="primary" 
                            onClick={() => handleRestore(v.id)}
                          >
                            Restore
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {paginationMeta && totalPages > 1 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Showing <span className="font-semibold">{((page - 1) * limit) + 1}</span> to{' '}
                  <span className="font-semibold">{Math.min(page * limit, totalItems)}</span> of{' '}
                  <span className="font-semibold">{totalItems}</span> entries
                </p>

                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm font-medium px-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
        /* Broadcast History Tab */
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-primary dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date Sent</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Subject / Snippet</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-500 py-4">Loading broadcast logs...</TableCell>
                  </TableRow>
                )}
                {!loadingHistory && broadcastHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-500 dark:text-gray-400 py-6">No broadcast messages sent yet.</TableCell>
                  </TableRow>
                )}
                {broadcastHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      {formatDate(item.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {item.status === 'SCHEDULED' && item.scheduledFor && (
                        <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-0.5">
                          Scheduled: {formatDate(item.scheduledFor, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${item.channel === 'EMAIL' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'}`}>
                        {item.channel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-sm max-w-xs truncate">{item.subject || 'SMS Alert'}</div>
                      <div className="text-xs text-gray-500 max-w-xs truncate">{item.body}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-semibold">{item.sentCount}</span> / {item.totalRecipients} sent
                      {item.failedCount > 0 && <span className="text-red-500 font-bold ml-1">({item.failedCount} failed)</span>}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        item.status === 'SENT'
                          ? 'bg-green-100 text-green-800'
                          : item.status === 'SCHEDULED'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                            : item.status === 'PARTIALLY_SENT'
                              ? 'bg-amber-100 text-amber-800'
                              : item.status === 'CANCELLED'
                                ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                : 'bg-red-100 text-red-800'
                      }`}>
                        {item.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setSelectedBroadcast(item)}>
                          Details
                        </Button>
                        {item.status === 'SCHEDULED' && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={cancelling}
                            onClick={() => handleCancelSchedule(item.id)}
                          >
                            Cancel Schedule
                          </Button>
                        )}
                        {item.failedCount > 0 && item.status !== 'CANCELLED' && (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={retrying}
                            onClick={() => handleRetryBroadcast(item.id)}
                          >
                            Retry Failed
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SegmentedTabPanel>

      {/* Broadcast Details Modal */}
      {selectedBroadcast && resolvedBroadcast && (
        <Dialog
          isOpen={Boolean(selectedBroadcast)}
          onClose={() => setSelectedBroadcast(null)}
          title={`Broadcast Log Details (${resolvedBroadcast.channel})`}
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 dark:bg-zinc-800 p-3 rounded">
              <div><strong>Created At:</strong> {formatDate(resolvedBroadcast.createdAt)}</div>
              <div><strong>Status:</strong> {resolvedBroadcast.status}</div>
              {resolvedBroadcast.scheduledFor && (
                <div><strong>Scheduled For:</strong> {formatDate(resolvedBroadcast.scheduledFor)}</div>
              )}
              <div><strong>Sent Count:</strong> {resolvedBroadcast.sentCount} / {resolvedBroadcast.totalRecipients}</div>
              <div><strong>Failed Count:</strong> {resolvedBroadcast.failedCount}</div>
            </div>

            {resolvedBroadcast.subject && (
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase block">Subject:</span>
                <p className="font-semibold text-sm">{resolvedBroadcast.subject}</p>
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">Body:</span>
              <div className="p-3 bg-gray-100 dark:bg-zinc-800 text-xs font-mono rounded whitespace-pre-wrap">
                {resolvedBroadcast.body}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Recipient Delivery Statuses:</h3>
              <div className="max-h-60 overflow-y-auto border rounded divide-y dark:divide-zinc-700">
                {showDetailLoading && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="p-4 text-xs text-center text-gray-600 dark:text-gray-300"
                  >
                    Loading recipient delivery statuses...
                  </div>
                )}
                {showDetailError && (
                  <div
                    role="alert"
                    className="p-4 text-xs text-center text-red-700 dark:text-red-300"
                  >
                    {broadcastDetailError?.message || 'Failed to load recipient delivery statuses.'}
                  </div>
                )}
                {!showDetailLoading && !showDetailError && (!resolvedRecipients || resolvedRecipients.length === 0) && (
                  <div className="p-4 text-xs text-center text-gray-600 dark:text-gray-300">
                    No recipient delivery logs recorded.
                  </div>
                )}
                {!showDetailLoading && resolvedRecipients?.map((r) => (
                  <div key={r.id} className="p-2 text-xs flex justify-between items-center">
                    <div>
                      <span className="font-semibold">{r.guestName}</span> ({r.destination})
                      {r.error && <span className="block text-red-600 dark:text-red-400 text-[11px] mt-0.5">{r.error}</span>}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.status === 'SENT'
                        ? 'bg-green-100 text-green-800'
                        : r.status === 'PENDING'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              {resolvedBroadcast.status === 'SCHEDULED' && (
                <Button variant="danger" disabled={cancelling} onClick={() => handleCancelSchedule(resolvedBroadcast.id)}>
                  {cancelling ? 'Cancelling...' : 'Cancel Schedule'}
                </Button>
              )}
              {resolvedBroadcast.failedCount > 0 && resolvedBroadcast.status !== 'CANCELLED' && (
                <Button variant="danger" disabled={retrying} onClick={() => handleRetryBroadcast(resolvedBroadcast.id)}>
                  {retrying ? 'Retrying...' : 'Retry Failed Dispatches'}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSelectedBroadcast(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

interface VersionsSnapshot {
  versions: HistoryTimelineContentProps['versions'];
  paginationMeta: PaginationMeta | null;
}

async function requestVersionsSnapshot(
  currentPage: number,
  currentLimit: number
): Promise<VersionsSnapshot> {
  const data = await apiClient.get<unknown>(
    `/api/admin/versions?page=${currentPage}&limit=${currentLimit}`
  );
  if (Array.isArray(data)) {
    return {
      versions: data,
      paginationMeta: null,
    };
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    Array.isArray((data as { items: unknown }).items)
  ) {
    const envelope = data as {
      items: HistoryTimelineContentProps['versions'];
      pagination?: PaginationMeta | null;
    };
    return {
      versions: envelope.items,
      paginationMeta: envelope.pagination || null,
    };
  }
  return {
    versions: [],
    paginationMeta: null,
  };
}

function formatVersionsError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Failed to load version history.';
  return message || 'Failed to load version history.';
}

function HistoryTimelinePageContainer() {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [paginationMeta, setPaginationMeta] = useState<PaginationMeta | null>(null);

  const fetchVersions = useCallback(async (
    currentPage = page,
    currentLimit = limit,
    options?: { background?: boolean }
  ) => {
    if (!options?.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const snapshot = await requestVersionsSnapshot(currentPage, currentLimit);
      setVersions(snapshot.versions);
      setPaginationMeta(snapshot.paginationMeta);
      setError(null);
    } catch (err: unknown) {
      setError(formatVersionsError(err));
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  }, [page, limit]);

  const handleSetPage: React.Dispatch<React.SetStateAction<number>> = useCallback((nextPage) => {
    setLoading(true);
    setError(null);
    setPage(nextPage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void requestVersionsSnapshot(page, limit)
      .then((snapshot) => {
        if (cancelled) return;
        setVersions(snapshot.versions);
        setPaginationMeta(snapshot.paginationMeta);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatVersionsError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, limit]);

  return (
    <AdminViewState
      isLoading={loading}
      error={error}
      onRetry={() => fetchVersions(page, limit)}
      loadingMessage="Loading history..."
    >
      <Suspense fallback={null}>
        <HistoryTimelineContent
          versions={versions}
          loading={loading}
          page={page}
          limit={limit}
          paginationMeta={paginationMeta}
          setPage={handleSetPage}
          fetchVersions={fetchVersions}
        />
      </Suspense>
    </AdminViewState>
  );
}

export default function HistoryTimelinePage() {
  const existingQueryClient = useContext(QueryClientContext);
  const [fallbackQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
  );

  if (existingQueryClient) {
    return <HistoryTimelinePageContainer />;
  }

  return (
    <QueryClientProvider client={fallbackQueryClient}>
      <HistoryTimelinePageContainer />
    </QueryClientProvider>
  );
}
