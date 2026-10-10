'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Input, FormGroup } from '@/components/ui/forms';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatCurrency, formatDate } from '@/utils/intl';
import type { ProgressMetrics } from '@/features/registry';

export interface ThankYouContributorItem {
  id: string;
  name: string;
  email?: string | null;
  amount: number;
  date: string;
  thankYouStatus: 'Unsent' | 'Sent' | 'Not Needed' | string;
  thankYouSentAt?: string | null;
  thankYouNote?: string | null;
  registryItemId?: string | null;
  registryItem?: {
    id: string;
    name: string;
    category?: string;
  } | null;
}

export type ThankYouMetrics = ProgressMetrics;

export default function ThankYouNotesPage() {
  const router = useRouter();
  const { addToast, confirm } = useToast();

  const [items, setItems] = useState<ThankYouContributorItem[]>([]);
  const [metrics, setMetrics] = useState<ThankYouMetrics>({
    total: 0,
    sent: 0,
    unsent: 0,
    notNeeded: 0,
    thanked: 0,
    completionPercentage: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'All' | 'Unsent' | 'Sent' | 'Not Needed'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Editing single item state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'Unsent' | 'Sent' | 'Not Needed'>('Unsent');
  const [editNote, setEditNote] = useState<string>('');
  const [editSentAt, setEditSentAt] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') {
        params.set('status', statusFilter);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/admin/thank-you-notes?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to fetch thank-you notes.');
      }
      const data = await res.json();
      setItems(data.items || []);
      setMetrics(
        data.metrics || {
          total: 0,
          sent: 0,
          unsent: 0,
          notNeeded: 0,
          thanked: 0,
          completionPercentage: 0,
        }
      );
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading thank-you notes.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Bulk selection logic
  const isAllSelected = useMemo(() => {
    if (items.length === 0) return false;
    return items.every((item) => selectedIds.includes(item.id));
  }, [items, selectedIds]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((item) => item.id));
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchStatusUpdate = async (newStatus: 'Unsent' | 'Sent' | 'Not Needed') => {
    if (selectedIds.length === 0) {
      addToast('Please select at least one contributor record.', 'info');
      return;
    }

    const isConfirmed = await confirm(
      `Are you sure you want to mark ${selectedIds.length} contributor record(s) as "${newStatus}"?`
    );
    if (!isConfirmed) return;

    try {
      const res = await fetch('/api/admin/thank-you-notes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: selectedIds,
          status: newStatus,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Batch update failed.');
      }

      addToast(`Updated ${selectedIds.length} record(s) to "${newStatus}".`, 'success');
      setSelectedIds([]);
      await fetchData();
    } catch (err: any) {
      addToast(err.message || 'Batch update failed.', 'error');
    }
  };

  const startEditing = (item: ThankYouContributorItem) => {
    setEditingId(item.id);
    setEditStatus((item.thankYouStatus as any) || 'Unsent');
    setEditNote(item.thankYouNote || '');
    setEditSentAt(
      item.thankYouSentAt ? new Date(item.thankYouSentAt).toISOString().split('T')[0] : ''
    );
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveIndividualEdit = async (id: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/thank-you-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thankYouStatus: editStatus,
          thankYouNote: editNote.trim() || null,
          thankYouSentAt: editSentAt ? new Date(editSentAt).toISOString() : null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update thank-you note.');
      }

      addToast('Thank-you note record updated successfully.', 'success');
      setEditingId(null);
      await fetchData();
    } catch (err: any) {
      addToast(err.message || 'Failed to update record.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const st = (status || 'Unsent').trim();
    if (st === 'Sent') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border border-green-300 dark:border-green-700">
          Sent
        </span>
      );
    }
    if (st === 'Not Needed') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
          Not Needed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
        Unsent
      </span>
    );
  };

  return (
    <div className="py-8 max-w-6xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">
            Thank-You Note Manager
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Track, draft, and organize thank-you notes for all your wedding gift contributors.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>
            Back to Registry
          </Button>
        </div>
      </div>

      {/* Progress & Metrics Dashboard */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-gray-200 dark:border-gray-700 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Thank-You Progress Summary
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Overall completion rate for physical and custom gratitude notes
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-primary">
              {metrics.completionPercentage}%
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">Completed</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3.5 overflow-hidden">
          <div
            className="bg-primary h-3.5 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${metrics.completionPercentage}%` }}
            role="progressbar"
            aria-valuenow={metrics.completionPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Thank-you note completion progress"
          />
        </div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700 text-center">
            <span className="block text-2xl font-bold text-gray-900 dark:text-white">
              {metrics.total}
            </span>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Total Contributions
            </span>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200/50 dark:border-amber-800/40 text-center">
            <span className="block text-2xl font-bold text-amber-700 dark:text-amber-400">
              {metrics.unsent}
            </span>
            <span className="text-xs font-medium text-amber-700/80 dark:text-amber-300/80">
              Pending / Unsent
            </span>
          </div>
          <div className="bg-green-50 dark:bg-green-950/20 p-3 rounded-lg border border-green-200/50 dark:border-green-800/40 text-center">
            <span className="block text-2xl font-bold text-green-700 dark:text-green-400">
              {metrics.sent}
            </span>
            <span className="text-xs font-medium text-green-700/80 dark:text-green-300/80">
              Thank-You Sent
            </span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200/50 dark:border-blue-800/40 text-center">
            <span className="block text-2xl font-bold text-blue-700 dark:text-blue-400">
              {metrics.notNeeded}
            </span>
            <span className="text-xs font-medium text-blue-700/80 dark:text-blue-300/80">
              Not Needed
            </span>
          </div>
        </div>
      </div>

      {/* Filter, Search & Bulk Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        {/* Search */}
        <FormGroup className="relative flex-1 max-w-md space-y-0">
          <Input
            type="text"
            placeholder="Search contributor name or gift item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search contributor name or gift item"
            className="w-full"
          />
        </FormGroup>

        {/* Status Filter Tabs */}
        <div
          role="group"
          aria-label="Filter contributors by thank-you status"
          className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700 self-start md:self-auto overflow-x-auto max-w-full"
        >
          {(['All', 'Unsent', 'Sent', 'Not Needed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action Controls */}
      {selectedIds.length > 0 && (
        <div className="bg-primary/10 border border-primary/30 dark:bg-primary/20 dark:border-primary/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <span className="text-sm font-semibold text-primary dark:text-primary-light">
            {selectedIds.length} contributor record(s) selected
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => handleBatchStatusUpdate('Sent')}
            >
              Mark Selected as Sent
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleBatchStatusUpdate('Not Needed')}
            >
              Mark as Not Needed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleBatchStatusUpdate('Unsent')}
            >
              Mark as Unsent
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds([])}
            >
              Deselect All
            </Button>
          </div>
        </div>
      )}

      {/* Main Contributor Table & Editing View */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500 dark:text-gray-400">
          Loading contributor records...
        </div>
      ) : error ? (
        <div className="py-8 text-center text-red-500 font-medium">
          Error: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            No contributor records found matching your current filter criteria.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl shadow bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all contributors"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                  />
                </TableHead>
                <TableHead>Contributor</TableHead>
                <TableHead>Gift Item</TableHead>
                <TableHead>Contribution</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent Date</TableHead>
                <TableHead>Note Draft / Message</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const isEditing = editingId === item.id;
                const isSelected = selectedIds.includes(item.id);

                return (
                  <TableRow
                    key={item.id}
                    className={isSelected ? 'bg-primary/5 dark:bg-primary/10' : undefined}
                  >
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`Select contributor ${item.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelectItem(item.id)}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                      />
                    </TableCell>

                    <TableCell className="font-semibold text-gray-900 dark:text-white">
                      <div>{item.name}</div>
                      {item.email && (
                        <div className="text-xs text-gray-500 font-normal">{item.email}</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="font-medium text-gray-800 dark:text-gray-200">
                        {item.registryItem?.name || 'General Registry'}
                      </div>
                      {item.registryItem?.category && (
                        <div className="text-xs text-gray-500">{item.registryItem.category}</div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="font-semibold">{formatCurrency(item.amount)}</div>
                      <div className="text-xs text-gray-500">{formatDate(item.date)}</div>
                    </TableCell>

                    <TableCell>
                      {isEditing ? (
                        <select
                          aria-label={`Thank-you status for ${item.name}`}
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as any)}
                          className="text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="Unsent">Unsent</option>
                          <option value="Sent">Sent</option>
                          <option value="Not Needed">Not Needed</option>
                        </select>
                      ) : (
                        getStatusBadge(item.thankYouStatus)
                      )}
                    </TableCell>

                    <TableCell className="text-xs text-gray-600 dark:text-gray-300">
                      {isEditing ? (
                        <input
                          type="date"
                          aria-label={`Sent date for ${item.name}`}
                          value={editSentAt}
                          onChange={(e) => setEditSentAt(e.target.value)}
                          className="text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      ) : item.thankYouSentAt ? (
                        formatDate(item.thankYouSentAt)
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </TableCell>

                    <TableCell className="max-w-xs">
                      {isEditing ? (
                        <textarea
                          aria-label={`Thank-you note message for ${item.name}`}
                          rows={2}
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Add custom thank-you note draft..."
                          className="w-full text-xs p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary"
                        />
                      ) : (
                        <div className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-xs">
                          {item.thankYouNote ? (
                            <span title={item.thankYouNote}>{item.thankYouNote}</span>
                          ) : (
                            <span className="text-gray-400 italic">No note added</span>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-right space-x-2">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={isSaving}
                            onClick={() => saveIndividualEdit(item.id)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isSaving}
                            onClick={cancelEditing}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => startEditing(item)}
                          aria-label={`Edit thank-you note for ${item.name}`}
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
