'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Input, FormGroup } from '@/components/ui/forms';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { formatCurrency, formatDate } from '@/utils/intl';
import type { ProgressMetrics } from '@/features/registry';
import {
  ContributorLifecycleBadge,
  THANK_YOU_TEMPLATES,
  substituteThankYouTemplateTokens,
} from '@/features/registry';
import { useOverlay } from '@/hooks/useOverlay';
import { useMenuNavigation } from '@/hooks/useMenuNavigation';

export interface ThankYouContributorItem {
  id: string;
  name: string;
  email?: string | null;
  message?: string | null;
  amount: number;
  refundedAmount?: number;
  status?: string;
  reminderEmailSentAt?: string | null;
  date: string;
  thankYouStatus: 'Unsent' | 'Sent' | 'Not Needed' | string;
  thankYouSentAt?: string | null;
  thankYouNote?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  transactionTimestamp?: string | null;
  retailerOrderNumber?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  registryItemId?: string | null;
  registryItem?: {
    id: string;
    name: string;
    category?: string;
  } | null;
  invitationCodeId?: string | null;
  invitationCode?: {
    id?: string;
    code?: string;
    guestName?: string;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
  } | null;
}

export type ThankYouMetrics = ProgressMetrics;

type ThankYouStatusFilter = 'All' | 'Unsent' | 'Sent' | 'Not Needed';

interface ThankYouPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface ThankYouNotesQuery {
  statusFilter: ThankYouStatusFilter;
  searchQuery: string;
  page: number;
  pageSize: number;
}

interface ThankYouNotesSnapshot {
  items: ThankYouContributorItem[];
  metrics: ThankYouMetrics;
  pagination: ThankYouPagination | null;
}

interface ThankYouNotesSetters {
  setItems: React.Dispatch<React.SetStateAction<ThankYouContributorItem[]>>;
  setMetrics: React.Dispatch<React.SetStateAction<ThankYouMetrics>>;
  setPagination: React.Dispatch<React.SetStateAction<ThankYouPagination>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

const DEFAULT_THANK_YOU_METRICS: ThankYouMetrics = {
  total: 0,
  sent: 0,
  unsent: 0,
  notNeeded: 0,
  thanked: 0,
  completionPercentage: 0,
};

async function requestThankYouNotes(query: ThankYouNotesQuery): Promise<ThankYouNotesSnapshot> {
  const params = new URLSearchParams();
  if (query.statusFilter !== 'All') {
    params.set('status', query.statusFilter);
  }
  if (query.searchQuery.trim()) {
    params.set('search', query.searchQuery.trim());
  }
  params.set('page', query.page.toString());
  params.set('pageSize', query.pageSize.toString());

  const res = await fetch(`/api/admin/thank-you-notes?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch thank-you notes.');
  }
  const data = await res.json();
  return {
    items: data.items || [],
    metrics: data.metrics || DEFAULT_THANK_YOU_METRICS,
    pagination: data.pagination || null,
  };
}

function applyThankYouNotesSnapshot(
  snapshot: ThankYouNotesSnapshot,
  setters: ThankYouNotesSetters
): void {
  setters.setItems(snapshot.items);
  setters.setMetrics(snapshot.metrics);
  if (snapshot.pagination) {
    setters.setPagination(snapshot.pagination);
  }
  setters.setError(null);
}

function formatThankYouNotesError(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return 'An error occurred while loading thank-you notes.';
}

export default function ThankYouNotesPage() {
  const router = useRouter();
  const { addToast, confirm } = useToast();

  const [items, setItems] = useState<ThankYouContributorItem[]>([]);
  const [metrics, setMetrics] = useState<ThankYouMetrics>(DEFAULT_THANK_YOU_METRICS);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<ThankYouStatusFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const [pagination, setPagination] = useState<ThankYouPagination>({
    page: 1,
    pageSize: 50,
    totalItems: 0,
    totalPages: 1,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Editing single item state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<'Unsent' | 'Sent' | 'Not Needed'>('Unsent');
  const [editNote, setEditNote] = useState<string>('');
  const [editSentAt, setEditSentAt] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const handleStatusFilterChange = (tab: 'All' | 'Unsent' | 'Sent' | 'Not Needed') => {
    setIsLoading(true);
    setError(null);
    setStatusFilter(tab);
    setCurrentPage(1);
  };

  const handleSearchChange = (query: string) => {
    setIsLoading(true);
    setError(null);
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const labelMenuButtonId = useId();

  const { overlayRef } = useOverlay(isLabelDropdownOpen, () => {
    setIsLabelDropdownOpen(false);
    exportTriggerRef.current?.focus();
  });

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isLabelDropdownOpen) {
        setIsLabelDropdownOpen(true);
      }
    }
  };

  const { handleMenuKeyDown } = useMenuNavigation(overlayRef);

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'All') {
      params.set('status', statusFilter);
    }
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }
    const query = params.toString();
    const url = query ? `/api/admin/thank-you-notes/export?${query}` : '/api/admin/thank-you-notes/export';

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportLabels = (template: 'avery_5160' | 'avery_5163') => {
    setIsLabelDropdownOpen(false);
    exportTriggerRef.current?.focus();
    const params = new URLSearchParams();
    params.set('template', template);
    if (statusFilter !== 'All') {
      params.set('status', statusFilter);
    }
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }
    const query = params.toString();
    const url = `/api/admin/thank-you-notes/export-labels?${query}`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const snapshot = await requestThankYouNotes({ statusFilter, searchQuery, page: currentPage, pageSize });
      applyThankYouNotesSnapshot(snapshot, { setItems, setMetrics, setPagination, setError });
    } catch (err: unknown) {
      setError(formatThankYouNotesError(err));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchQuery, currentPage, pageSize]);

  useEffect(() => {
    let cancelled = false;

    void requestThankYouNotes({ statusFilter, searchQuery, page: currentPage, pageSize })
      .then((snapshot) => {
        if (cancelled) return;
        applyThankYouNotesSnapshot(snapshot, { setItems, setMetrics, setPagination, setError });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatThankYouNotesError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, searchQuery, currentPage, pageSize]);

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
    setSelectedTemplate('');
    setEditStatus((item.thankYouStatus as any) || 'Unsent');
    setEditNote(item.thankYouNote || '');
    setEditSentAt(
      item.thankYouSentAt ? new Date(item.thankYouSentAt).toISOString().split('T')[0] : ''
    );
  };

  const cancelEditing = () => {
    setEditingId(null);
    setSelectedTemplate('');
  };

  const handleTemplateSelect = async (
    templateId: string,
    item: ThankYouContributorItem
  ) => {
    if (!templateId) {
      setSelectedTemplate('');
      return;
    }

    const templateObj = THANK_YOU_TEMPLATES.find((t) => t.id === templateId);
    if (!templateObj) return;

    if (editNote.trim().length > 0) {
      const isConfirmed = await confirm(
        'Replacing the note with a template will overwrite your existing text. Are you sure you want to proceed?'
      );

      if (!isConfirmed) {
        setSelectedTemplate('');
        return;
      }
    }

    setSelectedTemplate(templateId);
    const populated = substituteThankYouTemplateTokens(templateObj.template, {
      guestName: item.name || item.invitationCode?.guestName,
      giftName: item.registryItem?.name,
      amount: item.amount,
    });
    setEditNote(populated);
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
      setSelectedTemplate('');
      await fetchData();
    } catch (err: any) {
      addToast(err.message || 'Failed to update record.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLifecycleAction = async (
    item: ThankYouContributorItem,
    action: 'confirm' | 'remind' | 'void'
  ) => {
    if (action === 'void') {
      const isConfirmed = await confirm(
        `Void the contribution from ${item.name}? This preserves contributor history while recalculating the gift item balance.`
      );
      if (!isConfirmed) return;
    }

    setPendingActionId(item.id);
    try {
      const res = await fetch(`/api/admin/contributors/${encodeURIComponent(item.id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to update contributor lifecycle status.');
      }

      const successMessage =
        action === 'confirm'
          ? `Confirmed contribution from ${item.name}.`
          : action === 'remind'
            ? `Sent polite reminder email to ${item.name}.`
            : `Voided contribution from ${item.name}.`;
      addToast(successMessage, 'success');
      await fetchData();
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message
          ? err.message
          : 'Failed to update contributor lifecycle status.',
        'error'
      );
    } finally {
      setPendingActionId(null);
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
        <div className="flex gap-2 flex-wrap relative">
          <Button variant="secondary" onClick={handleExportCsv}>
            Export CSV
          </Button>
          <div className="relative inline-block text-left">
            <Button
              ref={exportTriggerRef}
              id={labelMenuButtonId}
              type="button"
              variant="secondary"
              onClick={() => setIsLabelDropdownOpen((prev) => !prev)}
              onKeyDown={handleTriggerKeyDown}
              aria-expanded={isLabelDropdownOpen}
              aria-haspopup="true"
              aria-controls="export-labels-menu"
            >
              Export Address Labels ▾
            </Button>
            {isLabelDropdownOpen && (
              <div
                id="export-labels-menu"
                ref={overlayRef}
                role="menu"
                aria-labelledby={labelMenuButtonId}
                className="origin-top-right absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-20 border border-gray-200 dark:border-gray-700 py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExportLabels('avery_5160')}
                  onKeyDown={handleMenuKeyDown}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700 flex flex-col"
                >
                  <span className="font-semibold">Avery 5160 PDF</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Standard Address Labels (30/sheet)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleExportLabels('avery_5163')}
                  onKeyDown={handleMenuKeyDown}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700 flex flex-col"
                >
                  <span className="font-semibold">Avery 5163 PDF</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Large Shipping Labels (10/sheet)</span>
                </button>
              </div>
            )}
          </div>
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
            <span className="text-xs font-medium text-[var(--color-muted-text,#4b5563)]">
              Total Contributions
            </span>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200/50 dark:border-amber-800/40 text-center">
            <span className="block text-2xl font-bold text-amber-700 dark:text-amber-400">
              {metrics.unsent}
            </span>
            <span className="text-xs font-medium text-[var(--color-status-warning-text,#92400e)]">
              Pending / Unsent
            </span>
          </div>
          <div className="bg-green-50 dark:bg-green-950/20 p-3 rounded-lg border border-green-200/50 dark:border-green-800/40 text-center">
            <span className="block text-2xl font-bold text-green-700 dark:text-green-400">
              {metrics.sent}
            </span>
            <span className="text-xs font-medium text-[var(--color-status-success-text,#166534)]">
              Thank-You Sent
            </span>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200/50 dark:border-blue-800/40 text-center">
            <span className="block text-2xl font-bold text-blue-700 dark:text-blue-400">
              {metrics.notNeeded}
            </span>
            <span className="text-xs font-medium text-[var(--color-status-info-text,#1e40af)]">
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
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search contributor name or gift item"
            className="w-full"
          />
        </FormGroup>

        {/* Status Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter contributors by thank-you status"
          className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700 self-start md:self-auto overflow-x-auto max-w-full"
        >
          {(['All', 'Unsent', 'Sent', 'Not Needed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab}
              onClick={() => handleStatusFilterChange(tab)}
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
                      {item.invitationCode?.addressLine1 ? (
                        <div
                          className="text-[11px] text-gray-500 font-normal truncate max-w-xs mt-0.5"
                          title={`${item.invitationCode.addressLine1}${item.invitationCode.city ? `, ${item.invitationCode.city}` : ''}`}
                        >
                          📍 {item.invitationCode.addressLine1}{item.invitationCode.city ? `, ${item.invitationCode.city}` : ''}
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-400 font-normal italic mt-0.5">
                          No address on file
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="font-medium text-gray-800 dark:text-gray-200">
                        {item.registryItem?.name || 'General Registry'}
                      </div>
                      {item.registryItem?.category && (
                        <div className="text-xs text-gray-500">{item.registryItem.category}</div>
                      )}
                      {(item.retailerOrderNumber || item.carrier || item.trackingNumber) && (
                        <div
                          data-testid={`order-tracking-summary-${item.id}`}
                          className="mt-1.5 space-y-0.5 rounded border border-sky-200 dark:border-sky-800/60 bg-sky-50/70 dark:bg-sky-950/30 px-2 py-1 text-[11px] text-sky-900 dark:text-sky-200"
                        >
                          {item.retailerOrderNumber && (
                            <div>
                              <span className="font-semibold">Order #:</span>{' '}
                              <span className="font-mono">{item.retailerOrderNumber}</span>
                            </div>
                          )}
                          {(item.carrier || item.trackingNumber) && (
                            <div>
                              <span className="font-semibold">Tracking:</span>{' '}
                              <span>
                                {[item.carrier, item.trackingNumber].filter(Boolean).join(' • ')}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div
                        className={`font-semibold ${
                          (item.status || 'CONFIRMED').toUpperCase() === 'CANCELLED' ||
                          (item.status || 'CONFIRMED').toUpperCase() === 'REFUNDED'
                            ? 'line-through text-gray-500 dark:text-gray-400'
                            : ''
                        }`}
                      >
                        {formatCurrency(item.amount)}
                      </div>
                      <div className="text-xs text-gray-500">{formatDate(item.date)}</div>
                      <div className="mt-1">
                        <ContributorLifecycleBadge
                          status={item.status}
                          amount={item.amount}
                          refundedAmount={item.refundedAmount}
                          contributorId={item.id}
                        />
                      </div>
                      {(item.stripeChargeId || item.stripePaymentIntentId) && (
                        <div
                          className="mt-0.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[120px]"
                          title={`Stripe Ref: ${item.stripeChargeId || item.stripePaymentIntentId}`}
                        >
                          Ref: {item.stripeChargeId || item.stripePaymentIntentId}
                        </div>
                      )}
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
                        <div className="space-y-1">
                          {item.message && (
                            <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded border border-amber-200 dark:border-amber-800">
                              <span className="font-semibold block text-[10px] uppercase text-amber-600 dark:text-amber-400">Guest Message:</span>
                              <p className="italic">{item.message}</p>
                            </div>
                          )}
                          <select
                            aria-label={`Select thank-you note template for ${item.name}`}
                            value={selectedTemplate}
                            onChange={(e) => handleTemplateSelect(e.target.value, item)}
                            className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary"
                          >
                            <option value="">Choose a starter template...</option>
                            {THANK_YOU_TEMPLATES.map((tmpl) => (
                              <option key={tmpl.id} value={tmpl.id}>
                                {tmpl.name}
                              </option>
                            ))}
                          </select>
                          <textarea
                            aria-label={`Thank-you note message for ${item.name}`}
                            rows={2}
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Add custom thank-you note draft..."
                            className="w-full text-xs p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      ) : (
                        <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1 max-w-xs">
                          {item.message && (
                            <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded border border-amber-200 dark:border-amber-800">
                              <span className="font-semibold block text-[10px] uppercase text-amber-600 dark:text-amber-400">Guest Message:</span>
                              <p className="italic whitespace-pre-wrap">{item.message}</p>
                            </div>
                          )}
                          <div className="truncate">
                            {item.thankYouNote ? (
                              <span title={item.thankYouNote}>{item.thankYouNote}</span>
                            ) : (
                              <span className="text-gray-400 italic">No note added</span>
                            )}
                          </div>
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
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {(item.status || 'CONFIRMED').toUpperCase() === 'RESERVED' && (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={pendingActionId === item.id}
                                onClick={() => void handleLifecycleAction(item, 'confirm')}
                                aria-label={`Confirm contribution from ${item.name}`}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingActionId === item.id}
                                onClick={() => void handleLifecycleAction(item, 'remind')}
                                aria-label={`Send polite reminder to ${item.name}`}
                              >
                                Polite Reminder
                              </Button>
                            </>
                          )}
                          {(item.status || 'CONFIRMED').toUpperCase() !== 'CANCELLED' &&
                            (item.status || 'CONFIRMED').toUpperCase() !== 'REFUNDED' && (
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={pendingActionId === item.id}
                              onClick={() => void handleLifecycleAction(item, 'void')}
                              aria-label={`Void contribution from ${item.name}`}
                            >
                              Void
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => startEditing(item)}
                            aria-label={`Edit thank-you note for ${item.name}`}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination Controls */}
      {!isLoading && !error && pagination.totalItems > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 px-2">
          <div className="text-xs text-gray-600 dark:text-gray-400">
            Showing{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {(pagination.page - 1) * pagination.pageSize + 1}
            </span>{' '}
            to{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)}
            </span>{' '}
            of{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              {pagination.totalItems}
            </span>{' '}
            contributor records
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage <= 1 || isLoading}
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  setCurrentPage((p) => Math.max(1, p - 1));
                }}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 px-2">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={currentPage >= pagination.totalPages || isLoading}
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  setCurrentPage((p) => Math.min(pagination.totalPages, p + 1));
                }}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
