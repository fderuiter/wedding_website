'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Label, Textarea, FormGroup } from '@/components/ui/forms';
import { SegmentedTabs, SegmentedTabPanel } from '@/components/ui/SegmentedTabs';
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
import { withBasePath } from '@/lib/basePath';

interface ThankYouContributorItem {
  id: string;
  name: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  message?: string | null;
  amount: number;
  refundedAmount?: number;
  status?: string;
  reminderEmailSentAt?: string | null;
  date: string;
  thankYouStatus: 'Unsent' | 'Sent' | 'Not Needed' | string;
  thankYouSentAt?: string | null;
  thankYouEmailSentAt?: string | null;
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
    email?: string | null;
    householdName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
  } | null;
}

interface InvitationHouseholdOption {
  id: string;
  code: string;
  guestName: string;
  email?: string | null;
  householdName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
}

interface RegistryItemOption {
  id: string;
  name: string;
  category?: string;
}

function resolveDisplayAddress(item: ThankYouContributorItem): {
  summary: string | null;
  source: 'contributor' | 'household' | 'none';
} {
  const contribParts = [
    item.addressLine1?.trim(),
    item.addressLine2?.trim(),
    item.city?.trim(),
    item.state?.trim(),
    item.zipCode?.trim(),
    item.country?.trim(),
  ].filter(Boolean);

  if (contribParts.length > 0) {
    const cityState = [item.city?.trim(), item.state?.trim()].filter(Boolean).join(', ');
    const line = [
      item.addressLine1?.trim(),
      item.addressLine2?.trim(),
      [cityState, item.zipCode?.trim()].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    return { summary: line || contribParts.join(', '), source: 'contributor' };
  }

  const invite = item.invitationCode;
  const inviteParts = [
    invite?.addressLine1?.trim(),
    invite?.addressLine2?.trim(),
    invite?.city?.trim(),
    invite?.state?.trim(),
    invite?.zipCode?.trim(),
    invite?.country?.trim(),
  ].filter(Boolean);

  if (inviteParts.length > 0) {
    const cityState = [invite?.city?.trim(), invite?.state?.trim()].filter(Boolean).join(', ');
    const line = [
      invite?.addressLine1?.trim(),
      invite?.addressLine2?.trim(),
      [cityState, invite?.zipCode?.trim()].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    return { summary: line || inviteParts.join(', '), source: 'household' };
  }

  return { summary: null, source: 'none' };
}

type ThankYouMetrics = ProgressMetrics;

type ThankYouStatusFilter = 'All' | 'Unsent' | 'Sent' | 'Not Needed';

const STATUS_TAB_IDS: Record<ThankYouStatusFilter, string> = {
  All: 'thank-you-status-tab-all',
  Unsent: 'thank-you-status-tab-unsent',
  Sent: 'thank-you-status-tab-sent',
  'Not Needed': 'thank-you-status-tab-not-needed',
};

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

  const res = await fetch(withBasePath(`/api/admin/thank-you-notes?${params.toString()}`));
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
  const [editAddressLine1, setEditAddressLine1] = useState<string>('');
  const [editAddressLine2, setEditAddressLine2] = useState<string>('');
  const [editCity, setEditCity] = useState<string>('');
  const [editState, setEditState] = useState<string>('');
  const [editZipCode, setEditZipCode] = useState<string>('');
  const [editCountry, setEditCountry] = useState<string>('');
  const [editInvitationCodeId, setEditInvitationCodeId] = useState<string | null>(null);
  const [editLinkedHouseholdLabel, setEditLinkedHouseholdLabel] = useState<string>('');
  const [syncAddressToGuest, setSyncAddressToGuest] = useState<boolean>(false);
  const [householdSearchQuery, setHouseholdSearchQuery] = useState<string>('');
  const [householdResults, setHouseholdResults] = useState<InvitationHouseholdOption[]>([]);
  const [isSearchingHouseholds, setIsSearchingHouseholds] = useState<boolean>(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [skipUnaddressedLabels, setSkipUnaddressedLabels] = useState<boolean>(false);

  // Email composer modal state
  const [composerItem, setComposerItem] = useState<ThankYouContributorItem | null>(null);
  const [composerTemplateId, setComposerTemplateId] = useState<string>('');
  const [composerRecipientEmail, setComposerRecipientEmail] = useState<string>('');
  const [composerSubject, setComposerSubject] = useState<string>('');
  const [composerBody, setComposerBody] = useState<string>('');
  const [composerPreview, setComposerPreview] = useState<{
    subject: string;
    textBody: string;
    htmlBody: string;
    to: string | null;
    testRecipient: string | null;
  } | null>(null);
  const [composerSubmittingMode, setComposerSubmittingMode] = useState<
    'preview' | 'test' | 'send' | null
  >(null);

  // Offline gift creation & lookup options state
  const [isOfflineFormOpen, setIsOfflineFormOpen] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [offlineEmail, setOfflineEmail] = useState('');
  const [offlineAmount, setOfflineAmount] = useState('');
  const [offlineRegistryItemId, setOfflineRegistryItemId] = useState('');
  const [offlineInvitationCodeId, setOfflineInvitationCodeId] = useState('');
  const [offlineStatus, setOfflineStatus] = useState<'Unsent' | 'Sent' | 'Not Needed'>('Unsent');
  const [offlineMessage, setOfflineMessage] = useState('');
  const [offlineNote, setOfflineNote] = useState('');
  const [isCreatingOffline, setIsCreatingOffline] = useState(false);

  const [invitationOptions, setInvitationOptions] = useState<InvitationHouseholdOption[]>([]);
  const [registryItemOptions, setRegistryItemOptions] = useState<RegistryItemOption[]>([]);
  const lookupRequestedRef = useRef(false);

  const ensureLookupOptionsLoaded = useCallback(async () => {
    if (lookupRequestedRef.current) return;
    lookupRequestedRef.current = true;

    try {
      const inviteRes = await fetch(
        withBasePath('/api/admin/invitation-codes/catalog?limit=500')
      );
      if (inviteRes.ok) {
        const inviteJson = await inviteRes.json();
        const invitePayload = inviteJson?.data ?? inviteJson;
        const rawInvites = Array.isArray(invitePayload)
          ? invitePayload
          : Array.isArray(invitePayload?.items)
            ? invitePayload.items
            : [];
        setInvitationOptions(rawInvites);
      }
    } catch {
      // Optional lookup in isolated environments
    }

    try {
      const regRes = await fetch(withBasePath('/api/registry/items?limit=500'));
      if (regRes.ok) {
        const regJson = await regRes.json();
        const regPayload = regJson?.data ?? regJson;
        const rawItems = Array.isArray(regPayload)
          ? regPayload
          : Array.isArray(regPayload?.items)
            ? regPayload.items
            : [];
        setRegistryItemOptions(rawItems);
      }
    } catch {
      // Optional lookup in isolated environments
    }
  }, []);

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

  const { overlayRef } = useOverlay(
    isLabelDropdownOpen,
    () => {
      setIsLabelDropdownOpen(false);
      exportTriggerRef.current?.focus();
    },
    { triggerRef: exportTriggerRef }
  );

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
    link.href = withBasePath(url);
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
    if (skipUnaddressedLabels) {
      params.set('skipUnaddressed', 'true');
    }
    const query = params.toString();
    const url = `/api/admin/thank-you-notes/export-labels?${query}`;

    const link = document.createElement('a');
    link.href = withBasePath(url);
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
      const res = await fetch(withBasePath('/api/admin/thank-you-notes/batch'), {
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
    void ensureLookupOptionsLoaded();
    setEditingId(item.id);
    setSelectedTemplate('');
    setEditStatus((item.thankYouStatus as any) || 'Unsent');
    setEditNote(item.thankYouNote || '');
    setEditSentAt(
      item.thankYouSentAt ? new Date(item.thankYouSentAt).toISOString().split('T')[0] : ''
    );
    setEditAddressLine1(item.addressLine1 || '');
    setEditAddressLine2(item.addressLine2 || '');
    setEditCity(item.city || '');
    setEditState(item.state || '');
    setEditZipCode(item.zipCode || '');
    setEditCountry(item.country || '');
    const currentInviteId = item.invitationCodeId ?? item.invitationCode?.id ?? null;
    setEditInvitationCodeId(currentInviteId);
    setEditLinkedHouseholdLabel(
      item.invitationCode?.guestName || item.invitationCode?.householdName
        ? `${item.invitationCode.householdName || item.invitationCode.guestName}${item.invitationCode.code ? ` (${item.invitationCode.code})` : ''}`
        : ''
    );
    setSyncAddressToGuest(false);
    setHouseholdSearchQuery('');
    setHouseholdResults([]);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setSelectedTemplate('');
    setHouseholdSearchQuery('');
    setHouseholdResults([]);
    setSyncAddressToGuest(false);
  };

  const handleHouseholdSearch = async (query: string) => {
    setHouseholdSearchQuery(query);
    const trimmed = query.trim();
    if (!trimmed) {
      setHouseholdResults([]);
      return;
    }

    setIsSearchingHouseholds(true);
    try {
      const params = new URLSearchParams({ search: trimmed, limit: '8' });
      const res = await fetch(`/api/admin/invitation-codes/catalog?${params.toString()}`);
      if (!res.ok) {
        throw new Error('Failed to search guest households.');
      }
      const json = await res.json();
      const payload = json?.data ?? json;
      setHouseholdResults(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      setHouseholdResults([]);
    } finally {
      setIsSearchingHouseholds(false);
    }
  };

  const handleSelectHousehold = (household: InvitationHouseholdOption) => {
    setEditInvitationCodeId(household.id);
    setEditLinkedHouseholdLabel(
      `${household.guestName}${household.code ? ` (${household.code})` : ''}`
    );
    setHouseholdSearchQuery('');
    setHouseholdResults([]);
    if (
      !editAddressLine1.trim() &&
      !editCity.trim() &&
      !editState.trim() &&
      !editZipCode.trim() &&
      household.addressLine1
    ) {
      setEditAddressLine1(household.addressLine1 || '');
      setEditAddressLine2(household.addressLine2 || '');
      setEditCity(household.city || '');
      setEditState(household.state || '');
      setEditZipCode(household.zipCode || '');
      setEditCountry(household.country || '');
    }
  };

  const handleUnlinkHousehold = () => {
    setEditInvitationCodeId(null);
    setEditLinkedHouseholdLabel('');
    setSyncAddressToGuest(false);
  };

  const openEmailComposer = (item: ThankYouContributorItem) => {
    setComposerItem(item);
    setComposerTemplateId('');
    setComposerRecipientEmail(item.email || item.invitationCode?.email || '');
    setComposerSubject('Thank you for your generous gift!');
    const initialBody =
      item.thankYouNote?.trim() ||
      substituteThankYouTemplateTokens(THANK_YOU_TEMPLATES[0].template, {
        guestName: item.name || item.invitationCode?.guestName,
        giftName: item.registryItem?.name || 'wedding gift',
        amount: item.amount,
      });
    setComposerBody(initialBody);
    setComposerPreview(null);
  };

  const closeEmailComposer = () => {
    setComposerItem(null);
    setComposerPreview(null);
    setComposerSubmittingMode(null);
  };

  const handleComposerTemplateChange = (templateId: string) => {
    setComposerTemplateId(templateId);
    if (!templateId || !composerItem) return;
    const tmpl = THANK_YOU_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return;
    const populated = substituteThankYouTemplateTokens(tmpl.template, {
      guestName: composerItem.name || composerItem.invitationCode?.guestName,
      giftName: composerItem.registryItem?.name || 'wedding gift',
      amount: composerItem.amount,
    });
    setComposerBody(populated);
    setComposerPreview(null);
  };

  const handleComposerAction = async (mode: 'preview' | 'test' | 'send') => {
    if (!composerItem) return;
    if (!composerBody.trim()) {
      addToast('Please enter a thank-you message body.', 'error');
      return;
    }

    setComposerSubmittingMode(mode);
    try {
      const res = await fetch(
        `/api/admin/thank-you-notes/${encodeURIComponent(composerItem.id)}/send-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            subject: composerSubject.trim() || undefined,
            body: composerBody,
            recipientEmail: composerRecipientEmail.trim() || undefined,
          }),
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMessage =
          (typeof json?.error === 'string' ? json.error : json?.error?.message) ||
          `Failed to ${mode} thank-you email.`;
        throw new Error(errMessage);
      }
      const data = json?.data ?? json;

      if (mode === 'preview') {
        setComposerPreview({
          subject: data.subject || composerSubject,
          textBody: data.textBody || composerBody,
          htmlBody: data.htmlBody || '',
          to: data.to || null,
          testRecipient: data.testRecipient || null,
        });
      } else if (mode === 'test') {
        setComposerPreview({
          subject: data.subject || composerSubject,
          textBody: data.textBody || composerBody,
          htmlBody: data.htmlBody || '',
          to: data.to || null,
          testRecipient: data.testRecipient || null,
        });
        addToast(`Sent test thank-you email to ${data.to || 'couple inbox'}.`, 'success');
      } else {
        addToast(`Thank-you email sent to ${data.to || composerItem.name}.`, 'success');
        closeEmailComposer();
        await fetchData();
      }
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message ? err.message : 'Failed to process thank-you email.',
        'error'
      );
    } finally {
      setComposerSubmittingMode(null);
    }
  };

  const openOfflineGiftForm = () => {
    void ensureLookupOptionsLoaded();
    setIsOfflineFormOpen(true);
  };

  const resetOfflineGiftForm = () => {
    setOfflineName('');
    setOfflineEmail('');
    setOfflineAmount('');
    setOfflineRegistryItemId('');
    setOfflineInvitationCodeId('');
    setOfflineStatus('Unsent');
    setOfflineMessage('');
    setOfflineNote('');
    setIsOfflineFormOpen(false);
  };

  const handleCreateOfflineGift = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = offlineName.trim();
    const parsedAmount = Number(offlineAmount);

    if (!trimmedName) {
      addToast('Contributor name is required.', 'error');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      addToast('Gift value must be a positive number.', 'error');
      return;
    }

    setIsCreatingOffline(true);
    try {
      const res = await fetch(withBasePath('/api/admin/thank-you-notes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: offlineEmail.trim() || null,
          amount: parsedAmount,
          registryItemId: offlineRegistryItemId || null,
          invitationCodeId: offlineInvitationCodeId || null,
          thankYouStatus: offlineStatus,
          message: offlineMessage.trim() || null,
          thankYouNote: offlineNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to record offline gift.');
      }

      addToast('Offline gift recorded successfully.', 'success');
      resetOfflineGiftForm();
      await fetchData();
    } catch (err: unknown) {
      addToast(
        err instanceof Error && err.message ? err.message : 'Failed to record offline gift.',
        'error'
      );
    } finally {
      setIsCreatingOffline(false);
    }
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
      const payload: Record<string, unknown> = {
        thankYouStatus: editStatus,
        thankYouNote: editNote.trim() || null,
        thankYouSentAt: editSentAt ? new Date(editSentAt).toISOString() : null,
        invitationCodeId: editInvitationCodeId || null,
        addressLine1: editAddressLine1.trim() || null,
        addressLine2: editAddressLine2.trim() || null,
        city: editCity.trim() || null,
        state: editState.trim() || null,
        zipCode: editZipCode.trim() || null,
        country: editCountry.trim() || null,
        ...(syncAddressToGuest && editInvitationCodeId ? { syncAddressToGuest: true } : {}),
      };

      const res = await fetch(withBasePath(`/api/admin/thank-you-notes/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      const res = await fetch(
        withBasePath(`/api/admin/contributors/${encodeURIComponent(item.id)}/action`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );

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
        <div className="flex gap-2 items-center flex-wrap relative">
          <Button variant="primary" onClick={openOfflineGiftForm}>
            Record Offline Gift
          </Button>
          <Button variant="secondary" onClick={handleExportCsv}>
            Export CSV
          </Button>
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipUnaddressedLabels}
              onChange={(e) => setSkipUnaddressedLabels(e.target.checked)}
              className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
            />
            Skip unaddressed labels
          </label>
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
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard/registry')}>
            Back to Registry
          </Button>
        </div>
      </div>

      {isOfflineFormOpen && (
        <section
          aria-labelledby="offline-gift-heading"
          className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 border border-primary/40 dark:border-gray-700 space-y-4"
        >
          <div>
            <h2 id="offline-gift-heading" className="text-lg font-bold text-gray-900 dark:text-white">
              Record Offline Gift
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Log cash, check, or off-registry physical gifts and optionally link them to a household mailing address.
            </p>
          </div>
          <form onSubmit={handleCreateOfflineGift} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup>
              <Label htmlFor="offline-gift-name">Contributor Name</Label>
              <Input
                id="offline-gift-name"
                type="text"
                value={offlineName}
                onChange={(e) => setOfflineName(e.target.value)}
                placeholder="e.g., Aunt Clara & Uncle Bob"
                required
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="offline-gift-amount">Gift Value ($)</Label>
              <Input
                id="offline-gift-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={offlineAmount}
                onChange={(e) => setOfflineAmount(e.target.value)}
                placeholder="e.g., 100.00"
                required
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="offline-gift-email">Contributor Email (Optional)</Label>
              <Input
                id="offline-gift-email"
                type="email"
                value={offlineEmail}
                onChange={(e) => setOfflineEmail(e.target.value)}
                placeholder="clara@example.com"
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="offline-gift-item">Registry Item (Optional)</Label>
              <select
                id="offline-gift-item"
                value={offlineRegistryItemId}
                onChange={(e) => setOfflineRegistryItemId(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              >
                <option value="">Off-Registry / Cash or Check Gift</option>
                {registryItemOptions.map((regItem) => (
                  <option key={regItem.id} value={regItem.id}>
                    {regItem.name}
                    {regItem.category ? ` (${regItem.category})` : ''}
                  </option>
                ))}
              </select>
            </FormGroup>
            <FormGroup>
              <Label htmlFor="offline-gift-household">Household Mailing Address (Optional)</Label>
              <select
                id="offline-gift-household"
                value={offlineInvitationCodeId}
                onChange={(e) => setOfflineInvitationCodeId(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              >
                <option value="">No linked household</option>
                {invitationOptions.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.householdName || inv.guestName} ({inv.code})
                    {inv.addressLine1
                      ? ` — ${inv.addressLine1}${inv.city ? `, ${inv.city}` : ''}`
                      : ' — No address'}
                  </option>
                ))}
              </select>
            </FormGroup>
            <FormGroup>
              <Label htmlFor="offline-gift-status">Thank-You Status</Label>
              <select
                id="offline-gift-status"
                value={offlineStatus}
                onChange={(e) => setOfflineStatus(e.target.value as 'Unsent' | 'Sent' | 'Not Needed')}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              >
                <option value="Unsent">Unsent</option>
                <option value="Sent">Sent</option>
                <option value="Not Needed">Not Needed</option>
              </select>
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <Label htmlFor="offline-gift-message">Gift Description / Card Message (Optional)</Label>
              <Textarea
                id="offline-gift-message"
                rows={2}
                value={offlineMessage}
                onChange={(e) => setOfflineMessage(e.target.value)}
                placeholder="e.g., Crystal vase brought to reception"
              />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <Label htmlFor="offline-gift-note">Thank-You Note Draft (Optional)</Label>
              <Textarea
                id="offline-gift-note"
                rows={2}
                value={offlineNote}
                onChange={(e) => setOfflineNote(e.target.value)}
                placeholder="Draft a thank-you note..."
              />
            </FormGroup>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isCreatingOffline}
                onClick={resetOfflineGiftForm}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isCreatingOffline}>
                {isCreatingOffline ? 'Saving...' : 'Save Offline Gift'}
              </Button>
            </div>
          </form>
        </section>
      )}

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
        <SegmentedTabs
          idPrefix="thank-you-status"
          panelId="thank-you-notes-panel"
          aria-label="Filter contributors by thank-you status"
          size="sm"
          value={statusFilter}
          onChange={handleStatusFilterChange}
          className="self-start md:self-auto max-w-full"
          tabs={[
            { value: 'All', label: 'All', id: STATUS_TAB_IDS.All },
            { value: 'Unsent', label: 'Unsent', id: STATUS_TAB_IDS.Unsent },
            { value: 'Sent', label: 'Sent', id: STATUS_TAB_IDS.Sent },
            { value: 'Not Needed', label: 'Not Needed', id: STATUS_TAB_IDS['Not Needed'] },
          ]}
        />
      </div>

      <SegmentedTabPanel
        id="thank-you-notes-panel"
        tabId={STATUS_TAB_IDS[statusFilter]}
        className="space-y-8"
      >
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
          <div
            role="alert"
            className="py-8 text-center text-red-700 dark:text-red-400 font-medium"
          >
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

                      <TableCell className="font-semibold text-gray-900 dark:text-white align-top">
                        <div>{item.name}</div>
                        {(item.email || item.invitationCode?.email) && (
                          <div className="text-xs text-muted-text font-normal">
                            {item.email || item.invitationCode?.email}
                          </div>
                        )}
                        {(item.invitationCode?.guestName || item.invitationCode?.householdName) && (
                          <div
                            data-testid={`linked-household-${item.id}`}
                            className="mt-1 inline-flex items-center gap-1 rounded bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 text-[11px] font-medium text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800"
                          >
                            Household: {item.invitationCode.guestName || item.invitationCode.householdName}
                            {item.invitationCode.code ? ` (${item.invitationCode.code})` : ''}
                          </div>
                        )}
                        {(() => {
                          const resolved = resolveDisplayAddress(item);
                          if (resolved.summary) {
                            return (
                              <div
                                data-testid={`resolved-address-${item.id}`}
                                className="text-[11px] text-gray-600 dark:text-gray-300 font-normal truncate max-w-xs mt-1"
                                title={resolved.summary}
                              >
                                📍 {resolved.summary}
                              </div>
                            );
                          }
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                                No address on file
                              </span>
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => startEditing(item)}
                                  aria-label={`Link Address for ${item.name}`}
                                  className="text-[11px] font-medium text-primary underline hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary rounded"
                                >
                                  Link Address
                                </button>
                              )}
                            </div>
                          );
                        })()}

                        {isEditing && (
                          <div className="mt-3 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 p-2.5 font-normal text-xs">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <label
                                  htmlFor={`edit-household-${item.id}`}
                                  className="font-semibold text-gray-800 dark:text-gray-200"
                                >
                                  Guest Household Link
                                </label>
                                {editInvitationCodeId && (
                                  <button
                                    type="button"
                                    onClick={handleUnlinkHousehold}
                                    aria-label={`Unlink household for ${item.name}`}
                                    className="text-[11px] font-semibold text-red-700 dark:text-red-400 hover:underline"
                                  >
                                    Unlink
                                  </button>
                                )}
                              </div>
                              <select
                                id={`edit-household-${item.id}`}
                                aria-label={`Household address for ${item.name}`}
                                value={editInvitationCodeId || ''}
                                onChange={(e) => {
                                  const nextId = e.target.value;
                                  if (!nextId) {
                                    handleUnlinkHousehold();
                                    return;
                                  }
                                  const matched = invitationOptions.find((opt) => opt.id === nextId);
                                  if (matched) {
                                    handleSelectHousehold(matched);
                                  } else {
                                    setEditInvitationCodeId(nextId);
                                  }
                                }}
                                className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              >
                                <option value="">No linked household</option>
                                {item.invitationCode?.id &&
                                  !invitationOptions.some((opt) => opt.id === item.invitationCode?.id) && (
                                  <option value={item.invitationCode.id}>
                                    {item.invitationCode.householdName ||
                                      item.invitationCode.guestName ||
                                      item.invitationCode.code}
                                  </option>
                                )}
                                {editInvitationCodeId &&
                                  editInvitationCodeId !== item.invitationCode?.id &&
                                  !invitationOptions.some((opt) => opt.id === editInvitationCodeId) && (
                                  <option value={editInvitationCodeId}>
                                    {editLinkedHouseholdLabel || editInvitationCodeId}
                                  </option>
                                )}
                                {invitationOptions.map((inv) => (
                                  <option key={inv.id} value={inv.id}>
                                    {inv.householdName || inv.guestName} ({inv.code})
                                    {inv.addressLine1
                                      ? ` — ${inv.addressLine1}${inv.city ? `, ${inv.city}` : ''}`
                                      : ' — No address'}
                                  </option>
                                ))}
                              </select>
                              {editInvitationCodeId ? (
                                <div className="text-[11px] text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 rounded border border-indigo-200 dark:border-indigo-800">
                                  Linked: {editLinkedHouseholdLabel || editInvitationCodeId}
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-600 dark:text-gray-400">
                                  Not linked to a guest household
                                </div>
                              )}
                              <input
                                type="text"
                                aria-label={`Search guest household for ${item.name}`}
                                value={householdSearchQuery}
                                onChange={(e) => void handleHouseholdSearch(e.target.value)}
                                placeholder="Search guest name, code, or email..."
                                className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              />
                              {isSearchingHouseholds && (
                                <div className="text-[11px] text-gray-600 dark:text-gray-400">
                                  Searching households...
                                </div>
                              )}
                              {householdResults.length > 0 && (
                                <ul
                                  aria-label={`Household search results for ${item.name}`}
                                  className="max-h-36 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                                >
                                  {householdResults.map((option) => (
                                    <li key={option.id}>
                                      <button
                                        type="button"
                                        onClick={() => handleSelectHousehold(option)}
                                        className="w-full text-left px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs text-gray-800 dark:text-gray-100"
                                      >
                                        <span className="font-semibold">{option.guestName}</span>{' '}
                                        <span className="text-gray-600 dark:text-gray-400">
                                          ({option.code})
                                        </span>
                                        {option.addressLine1 && (
                                          <span className="block text-[10px] text-gray-600 dark:text-gray-400 truncate">
                                            {option.addressLine1}
                                            {option.city ? `, ${option.city}` : ''}
                                          </span>
                                        )}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            <div className="space-y-1.5 pt-1 border-t border-gray-200 dark:border-gray-700">
                              <span className="font-semibold text-gray-800 dark:text-gray-200 block">
                                Contributor Return Address
                              </span>
                              <input
                                type="text"
                                aria-label={`Address Line 1 for ${item.name}`}
                                value={editAddressLine1}
                                onChange={(e) => setEditAddressLine1(e.target.value)}
                                placeholder="Street address"
                                className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              />
                              <input
                                type="text"
                                aria-label={`Address Line 2 for ${item.name}`}
                                value={editAddressLine2}
                                onChange={(e) => setEditAddressLine2(e.target.value)}
                                placeholder="Apt, suite, unit (optional)"
                                className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                              />
                              <div className="grid grid-cols-2 gap-1.5">
                                <input
                                  type="text"
                                  aria-label={`City for ${item.name}`}
                                  value={editCity}
                                  onChange={(e) => setEditCity(e.target.value)}
                                  placeholder="City"
                                  className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                <input
                                  type="text"
                                  aria-label={`State for ${item.name}`}
                                  value={editState}
                                  onChange={(e) => setEditState(e.target.value)}
                                  placeholder="State / Province"
                                  className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <input
                                  type="text"
                                  aria-label={`Zip Code for ${item.name}`}
                                  value={editZipCode}
                                  onChange={(e) => setEditZipCode(e.target.value)}
                                  placeholder="ZIP / Postal"
                                  className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                <input
                                  type="text"
                                  aria-label={`Country for ${item.name}`}
                                  value={editCountry}
                                  onChange={(e) => setEditCountry(e.target.value)}
                                  placeholder="Country"
                                  className="w-full text-xs p-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                              </div>
                              {editInvitationCodeId && (
                                <label className="inline-flex items-center gap-1.5 pt-1 text-[11px] text-gray-700 dark:text-gray-300 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={syncAddressToGuest}
                                    onChange={(e) => setSyncAddressToGuest(e.target.checked)}
                                    className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                                  />
                                  Sync address to linked guest household
                                </label>
                              )}
                            </div>
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="font-medium text-gray-800 dark:text-gray-200">
                          {item.registryItem?.name || 'General Registry'}
                        </div>
                        {item.registryItem?.category && (
                          <div className="text-xs text-muted-text">{item.registryItem.category}</div>
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
                        <div className="text-xs text-muted-text">{formatDate(item.date)}</div>
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
                            className="mt-0.5 text-[10px] font-mono text-status-success-text font-medium truncate max-w-[120px]"
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
                        ) : (
                          <div className="space-y-0.5">
                            <div>
                              {item.thankYouSentAt ? (
                                formatDate(item.thankYouSentAt)
                              ) : (
                                <span className="text-gray-500 dark:text-gray-400">—</span>
                              )}
                            </div>
                            {item.thankYouEmailSentAt && (
                              <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                Emailed {formatDate(item.thankYouEmailSentAt)}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="max-w-xs">
                        {isEditing ? (
                          <div className="space-y-1">
                            {item.message && (
                              <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded border border-amber-200 dark:border-amber-800">
                                <span className="font-semibold block text-[10px] uppercase text-status-warning-text">Guest Message:</span>
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
                                <span className="font-semibold block text-[10px] uppercase text-status-warning-text">Guest Message:</span>
                                <p className="italic whitespace-pre-wrap">{item.message}</p>
                              </div>
                            )}
                            <div className="truncate">
                              {item.thankYouNote ? (
                                <span title={item.thankYouNote}>{item.thankYouNote}</span>
                              ) : (
                                <span className="text-muted-text italic">No note added</span>
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
                              variant="outline"
                              onClick={() => openEmailComposer(item)}
                              srContext={`for ${item.name}`}
                            >
                              Send Email
                            </Button>
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
      </SegmentedTabPanel>

      {/* Thank-You Email Composer Modal */}
      <Dialog
        isOpen={Boolean(composerItem)}
        onClose={closeEmailComposer}
        title={
          composerItem
            ? `Compose Thank-You Email — ${composerItem.name}`
            : 'Compose Thank-You Email'
        }
        description="Select a starter template, customize the subject and message, preview the formatted email, or send a test copy before emailing the contributor."
        className="max-w-2xl"
      >
        {composerItem && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="thank-you-composer-template"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1"
                >
                  Starter Template
                </label>
                <select
                  id="thank-you-composer-template"
                  value={composerTemplateId}
                  onChange={(e) => handleComposerTemplateChange(e.target.value)}
                  className="w-full text-sm p-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="">Keep current draft...</option>
                  {THANK_YOU_TEMPLATES.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="thank-you-composer-recipient"
                  className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1"
                >
                  Recipient Email
                </label>
                <input
                  id="thank-you-composer-recipient"
                  type="email"
                  value={composerRecipientEmail}
                  onChange={(e) => setComposerRecipientEmail(e.target.value)}
                  placeholder="guest@example.com"
                  className="w-full text-sm p-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="thank-you-composer-subject"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1"
              >
                Email Subject
              </label>
              <input
                id="thank-you-composer-subject"
                type="text"
                value={composerSubject}
                onChange={(e) => {
                  setComposerSubject(e.target.value);
                  setComposerPreview(null);
                }}
                placeholder="Thank you so much for your generous gift!"
                className="w-full text-sm p-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="thank-you-composer-body"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1"
              >
                Message Body
              </label>
              <textarea
                id="thank-you-composer-body"
                rows={5}
                value={composerBody}
                onChange={(e) => {
                  setComposerBody(e.target.value);
                  setComposerPreview(null);
                }}
                placeholder="Write a personal thank-you message..."
                className="w-full text-sm p-2.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Supports placeholders: <code>{'{{guestName}}'}</code>, <code>{'{{giftName}}'}</code>,{' '}
                <code>{'{{amount}}'}</code>
              </p>
            </div>

            {composerPreview && (
              <div
                data-testid="thank-you-email-preview"
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 p-3 space-y-2 text-xs"
              >
                <div className="flex flex-wrap justify-between gap-2 border-b border-gray-200 dark:border-gray-700 pb-1.5">
                  <div>
                    <span className="font-semibold text-gray-700 dark:text-gray-200">Subject:</span>{' '}
                    <span className="text-gray-900 dark:text-white">{composerPreview.subject}</span>
                  </div>
                  {composerPreview.to && (
                    <div>
                      <span className="font-semibold text-gray-700 dark:text-gray-200">To:</span>{' '}
                      <span className="text-gray-800 dark:text-gray-200">{composerPreview.to}</span>
                    </div>
                  )}
                </div>
                <div className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                  {composerPreview.textBody}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={composerSubmittingMode !== null}
                  onClick={() => void handleComposerAction('preview')}
                >
                  {composerSubmittingMode === 'preview' ? 'Previewing...' : 'Preview Email'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={composerSubmittingMode !== null}
                  onClick={() => void handleComposerAction('test')}
                >
                  {composerSubmittingMode === 'test' ? 'Sending Test...' : 'Send Test Email'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={composerSubmittingMode !== null}
                  onClick={closeEmailComposer}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={composerSubmittingMode !== null}
                  onClick={() => void handleComposerAction('send')}
                >
                  {composerSubmittingMode === 'send' ? 'Sending...' : 'Send Thank-You Email'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
