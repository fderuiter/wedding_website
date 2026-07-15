'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatDate } from '@/utils/intl';

export default function HistoryTimelinePage() {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { addToast, confirm } = useToast();

  const fetchVersions = async () => {
    try {
      const res = await fetch('/api/admin/versions');
      if (!res.ok) throw new Error('Failed to fetch versions');
      const data = await res.json();
      setVersions(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  const handleRestore = async (versionId: string) => {
    if (!(await confirm('Are you sure you want to restore this version?'))) return;
    try {
      const res = await fetch(`/api/admin/versions/${versionId}/restore`, { method: 'POST' });
      if (res.ok) {
        addToast('Restored successfully.', 'success');
        fetchVersions();
      } else {
        addToast('Failed to restore.', 'error');
      }
    } catch (e) {
      console.error(e);
      addToast('Error restoring.', 'error');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading history...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

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
                <TableCell colSpan={5} className="text-center text-gray-500 py-4">No history found.</TableCell>
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
    </div>
  );
}
