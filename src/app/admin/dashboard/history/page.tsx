'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatDate } from '@/utils/intl';
import { apiClient } from '@/features/admin/apiClient';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { Dialog } from '@/components/ui/Dialog';

export default function HistoryTimelinePage() {
  const [activeTab, setActiveTab] = useState<'timeline' | 'broadcasts'>('timeline');
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [paginationMeta, setPaginationMeta] = useState<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null>(null);

  const [selectedBroadcast, setSelectedBroadcast] = useState<any>(null);

  const { addToast, confirm } = useToast();
  const { history: broadcastHistory, loadingHistory, retryBroadcast, retrying, cancelScheduledBroadcast, cancelling } = useAdminBroadcast();

  const fetchVersions = async (currentPage = page, currentLimit = limit) => {
    setLoading(true);
    try {
      const data = await apiClient.get<any>(`/api/admin/versions?page=${currentPage}&limit=${currentLimit}`);
      if (Array.isArray(data)) {
        setVersions(data);
        setPaginationMeta(null);
      } else if (data && Array.isArray(data.items)) {
        setVersions(data.items);
        setPaginationMeta(data.pagination || null);
      } else {
        setVersions([]);
        setPaginationMeta(null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions(page, limit);
  }, [page, limit]);

  const handleRestore = async (versionId: string) => {
    if (!(await confirm('Are you sure you want to restore this version? This will instantly replace the Live content.'))) return;
    try {
      await apiClient.post(`/api/admin/versions/${versionId}/restore`);
      addToast('Restored successfully.', 'success');
      fetchVersions(page, limit);
    } catch (e: any) {
      addToast(e.message || 'Failed to restore.', 'error');
    }
  };

  const handleRetryBroadcast = async (broadcastId: string) => {
    try {
      await retryBroadcast({ broadcastId });
      addToast('Retry initiated for failed recipients.', 'success');
      if (selectedBroadcast) {
        setSelectedBroadcast(null);
      }
    } catch (e: any) {
      addToast(e.message || 'Retry failed.', 'error');
    }
  };

  const handleCancelSchedule = async (broadcastId: string) => {
    if (!(await confirm('Are you sure you want to cancel this scheduled broadcast?'))) return;
    try {
      await cancelScheduledBroadcast(broadcastId);
      addToast('Scheduled broadcast cancelled.', 'success');
      if (selectedBroadcast) {
        setSelectedBroadcast(null);
      }
    } catch (e: any) {
      addToast(e.message || 'Failed to cancel scheduled broadcast.', 'error');
    }
  };

  if (loading && versions.length === 0) return <div className="p-8 text-center">Loading history...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  const totalPages = paginationMeta?.totalPages ?? 1;
  const totalItems = paginationMeta?.total ?? versions.length;

  return (
    <div className="py-10 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-4xl font-extrabold text-primary tracking-tight">System & Activity History</h1>

        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'timeline'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Content Snapshots
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('broadcasts')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'broadcasts'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Broadcast Delivery Logs
          </button>
        </div>
      </div>

      {activeTab === 'timeline' ? (
        <>
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-primary dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entity Type</TableHead>
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
                      <TableCell className="font-semibold">{v.entityType}</TableCell>
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

      {/* Broadcast Details Modal */}
      {selectedBroadcast && (
        <Dialog
          isOpen={Boolean(selectedBroadcast)}
          onClose={() => setSelectedBroadcast(null)}
          title={`Broadcast Log Details (${selectedBroadcast.channel})`}
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 dark:bg-zinc-800 p-3 rounded">
              <div><strong>Created At:</strong> {formatDate(selectedBroadcast.createdAt)}</div>
              <div><strong>Status:</strong> {selectedBroadcast.status}</div>
              {selectedBroadcast.scheduledFor && (
                <div><strong>Scheduled For:</strong> {formatDate(selectedBroadcast.scheduledFor)}</div>
              )}
              <div><strong>Sent Count:</strong> {selectedBroadcast.sentCount} / {selectedBroadcast.totalRecipients}</div>
              <div><strong>Failed Count:</strong> {selectedBroadcast.failedCount}</div>
            </div>

            {selectedBroadcast.subject && (
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase block">Subject:</span>
                <p className="font-semibold text-sm">{selectedBroadcast.subject}</p>
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-gray-500 uppercase block mb-1">Body:</span>
              <div className="p-3 bg-gray-100 dark:bg-zinc-800 text-xs font-mono rounded whitespace-pre-wrap">
                {selectedBroadcast.body}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Recipient Delivery Statuses:</h4>
              <div className="max-h-60 overflow-y-auto border rounded divide-y dark:divide-zinc-700">
                {selectedBroadcast.recipients?.map((r: any) => (
                  <div key={r.id} className="p-2 text-xs flex justify-between items-center">
                    <div>
                      <span className="font-semibold">{r.guestName}</span> ({r.destination})
                      {r.error && <span className="block text-red-500 text-[11px] mt-0.5">{r.error}</span>}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.status === 'SENT' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              {selectedBroadcast.status === 'SCHEDULED' && (
                <Button variant="danger" disabled={cancelling} onClick={() => handleCancelSchedule(selectedBroadcast.id)}>
                  {cancelling ? 'Cancelling...' : 'Cancel Schedule'}
                </Button>
              )}
              {selectedBroadcast.failedCount > 0 && selectedBroadcast.status !== 'CANCELLED' && (
                <Button variant="danger" disabled={retrying} onClick={() => handleRetryBroadcast(selectedBroadcast.id)}>
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
