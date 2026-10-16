'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatDate } from '@/utils/intl';
import { apiClient } from '@/features/admin/apiClient';

export default function HistoryTimelinePage() {
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

  const { addToast, confirm } = useToast();

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

  if (loading && versions.length === 0) return <div className="p-8 text-center">Loading history...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  const totalPages = paginationMeta?.totalPages ?? 1;
  const totalItems = paginationMeta?.total ?? versions.length;

  return (
    <div className="py-10 max-w-6xl mx-auto">
      <h1 className="text-4xl font-extrabold text-primary mb-8 tracking-tight">Timeline History</h1>
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
    </div>
  );
}
