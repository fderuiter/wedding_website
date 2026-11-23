'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { SegmentedTabs, SegmentedTabPanel } from '@/components/ui/SegmentedTabs';
import { FormGroup, Label, Input, Textarea, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { useTheme } from '@/components/ThemeProvider';
import {
  BroadcastChannel,
  BroadcastTargetFilters,
  BroadcastStarterTemplate,
  AVAILABLE_TEMPLATE_PLACEHOLDERS,
  BROADCAST_STARTER_TEMPLATES,
  summarizeBroadcastAudience,
} from '@/features/broadcast';

interface BroadcastSubEventOption {
  id: string;
  title: string;
  isPrivate?: boolean;
}

interface BroadcastPreviewData {
  subject?: string;
  body?: string;
  sampleGuestName?: string;
  destination?: string;
  recipientCount?: number;
  matchedCount?: number;
  missingContactCount?: number;
  baseUrlWarning?: string;
}

interface BroadcastTestSendResult {
  destination?: string;
  baseUrlWarning?: string;
}

interface BroadcastSendResult {
  status?: string;
  scheduledFor?: string;
  sentCount?: number;
  failedCount?: number;
  baseUrlWarning?: string;
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function getBroadcastErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return fallback;
}

export interface BroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialChannel?: BroadcastChannel;
  targetFilters?: BroadcastTargetFilters;
  selectedCount?: number;
  initialRecipientCount?: number;
  guests?: Array<Record<string, unknown>>;
  subEvents?: BroadcastSubEventOption[];
  adminEmail?: string;
  adminPhone?: string;
  onViewDeliveryLogs?: () => void;
}

function buildEffectiveTargetFilters(
  filters?: BroadcastTargetFilters
): BroadcastTargetFilters | undefined {
  if (!filters) return undefined;
  const normalized: BroadcastTargetFilters = {};

  if (filters.selectedIds && filters.selectedIds.length > 0) {
    normalized.selectedIds = filters.selectedIds;
  }
  if (filters.partyTags && filters.partyTags.length > 0) {
    normalized.partyTags = filters.partyTags;
  }
  if (filters.partyGroup && filters.partyGroup !== 'all') {
    normalized.partyGroup = filters.partyGroup;
  }
  if (filters.householdName && filters.householdName.trim()) {
    normalized.householdName = filters.householdName.trim();
  }
  if (filters.status && filters.status !== 'all') {
    normalized.status = filters.status;
  }
  const effectiveAddressStatus = filters.addressStatus ?? filters.addressFilter;
  if (effectiveAddressStatus && effectiveAddressStatus !== 'all') {
    normalized.addressStatus = effectiveAddressStatus;
  }
  const effectiveDietary = filters.dietaryCategory ?? filters.dietaryFilter;
  if (effectiveDietary && effectiveDietary !== 'all') {
    normalized.dietaryCategory = effectiveDietary;
  }
  if (filters.attendanceStatus && filters.attendanceStatus !== 'all') {
    normalized.attendanceStatus = filters.attendanceStatus;
  }
  if (filters.subEventId && filters.subEventId.trim()) {
    normalized.subEventId = filters.subEventId.trim();
    if (filters.subEventRsvpStatus && filters.subEventRsvpStatus !== 'all') {
      normalized.subEventRsvpStatus = filters.subEventRsvpStatus;
    }
  }
  if (filters.searchQuery && filters.searchQuery.trim()) {
    normalized.searchQuery = filters.searchQuery.trim();
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

const BroadcastModalForm: React.FC<BroadcastModalProps> = ({
  onClose,
  initialChannel = 'EMAIL',
  targetFilters,
  selectedCount,
  initialRecipientCount,
  guests,
  subEvents = [],
  adminEmail,
  adminPhone,
  onViewDeliveryLogs,
}) => {
  const router = useSafeRouter();
  const { addToast } = useToast();
  const { contactEmail } = useTheme();
  const defaultAdminEmail = adminEmail || contactEmail || '';
  const {
    sendBroadcast,
    previewBroadcast,
    sendTestBroadcast,
    countRecipients,
    sending,
    previewing,
    sendingTest,
  } = useAdminBroadcast();

  const isManualSelection = Boolean(
    (selectedCount !== undefined && selectedCount > 0) ||
      (targetFilters?.selectedIds && targetFilters.selectedIds.length > 0)
  );
  const manualSelectionCount =
    selectedCount !== undefined && selectedCount > 0
      ? selectedCount
      : targetFilters?.selectedIds?.length;

  const [channel, setChannel] = useState<BroadcastChannel>(initialChannel);
  const [localFilters, setLocalFilters] = useState<BroadcastTargetFilters>(
    () => targetFilters ?? {}
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testDestination, setTestDestination] = useState('');
  const [activeTab, setActiveTab] = useState<'compose' | 'preview'>('compose');
  const [previewResult, setPreviewResult] = useState<BroadcastPreviewData | null>(null);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(
    manualSelectionCount ?? initialRecipientCount ?? null
  );
  const [serverAudienceCounts, setServerAudienceCounts] = useState<{
    matchedCount: number;
    missingContactCount: number;
  } | null>(null);
  const [resolvedCountKey, setResolvedCountKey] = useState<string | null>(null);
  const [hasCheckedBaseUrl, setHasCheckedBaseUrl] = useState(false);
  const [baseUrlWarning, setBaseUrlWarning] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const effectiveTargetFilters = useMemo(
    () => buildEffectiveTargetFilters(localFilters),
    [localFilters]
  );

  const filtersKey = useMemo(
    () => JSON.stringify(effectiveTargetFilters ?? null),
    [effectiveTargetFilters]
  );

  const usesRsvpUrl = body.includes('{{rsvpUrl}}') || subject.includes('{{rsvpUrl}}');
  const requiresServerCount =
    !Array.isArray(guests) || Boolean(effectiveTargetFilters?.subEventId);
  const shouldFetchCount =
    typeof countRecipients === 'function' &&
    (requiresServerCount || (usesRsvpUrl && !hasCheckedBaseUrl));

  const countingRecipients =
    typeof countRecipients === 'function' &&
    requiresServerCount &&
    resolvedCountKey !== filtersKey;

  useEffect(() => {
    if (!shouldFetchCount || typeof countRecipients !== 'function') {
      return;
    }

    let cancelled = false;

    countRecipients(effectiveTargetFilters)
      .then((res) => {
        if (cancelled) return;
        if (typeof res?.recipientCount === 'number') {
          setRecipientCount(res.recipientCount);
        }
        if (
          typeof res?.matchedCount === 'number' &&
          typeof res?.missingContactCount === 'number'
        ) {
          setServerAudienceCounts({
            matchedCount: res.matchedCount,
            missingContactCount: res.missingContactCount,
          });
        }
        setBaseUrlWarning(res?.baseUrlWarning ?? null);
        setHasCheckedBaseUrl(true);
      })
      .catch(() => {
        // Preserve existing fallback count if live count request fails
      })
      .finally(() => {
        if (!cancelled) {
          setResolvedCountKey(filtersKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldFetchCount, countRecipients, filtersKey, effectiveTargetFilters]);

  const currentPreviewSignature = useMemo(
    () =>
      JSON.stringify({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters: effectiveTargetFilters,
      }),
    [channel, subject, body, effectiveTargetFilters]
  );

  const audienceStats = useMemo(() => {
    if (Array.isArray(guests) && !effectiveTargetFilters?.subEventId) {
      return summarizeBroadcastAudience(guests, effectiveTargetFilters, channel);
    }
    if (
      previewResult &&
      typeof previewResult.matchedCount === 'number' &&
      typeof previewResult.missingContactCount === 'number'
    ) {
      return {
        matchedCount: previewResult.matchedCount,
        missingContactCount: previewResult.missingContactCount,
        reachableCount: previewResult.matchedCount - previewResult.missingContactCount,
      };
    }
    if (serverAudienceCounts && channel === 'EMAIL') {
      return {
        matchedCount: serverAudienceCounts.matchedCount,
        missingContactCount: serverAudienceCounts.missingContactCount,
        reachableCount:
          serverAudienceCounts.matchedCount - serverAudienceCounts.missingContactCount,
      };
    }
    return null;
  }, [guests, effectiveTargetFilters, channel, previewResult, serverAudienceCounts]);

  const effectiveRecipientCount = useMemo(() => {
    if (isManualSelection) {
      return manualSelectionCount ?? audienceStats?.matchedCount ?? null;
    }
    if (effectiveTargetFilters?.subEventId) {
      return recipientCount;
    }
    if (Array.isArray(guests) && audienceStats !== null) {
      return audienceStats.matchedCount;
    }
    return recipientCount;
  }, [
    isManualSelection,
    manualSelectionCount,
    effectiveTargetFilters?.subEventId,
    guests,
    audienceStats,
    recipientCount,
  ]);

  const navigateToDeliveryLogs = () => {
    if (onViewDeliveryLogs) {
      onViewDeliveryLogs();
      return;
    }
    if (router?.push) {
      router.push('/admin/dashboard/history?tab=broadcasts');
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign(
        new URL('/admin/dashboard/history?tab=broadcasts', window.location.origin).href
      );
    }
  };

  const handleChannelChange = (nextChannel: BroadcastChannel) => {
    if (selectedTemplateId) {
      const matchedTemplate = BROADCAST_STARTER_TEMPLATES.find(
        (t) => t.id === selectedTemplateId
      );
      if (matchedTemplate) {
        const currentChannelBody =
          channel === 'EMAIL' ? matchedTemplate.emailBody : matchedTemplate.smsBody;
        if (body === currentChannelBody) {
          setBody(
            nextChannel === 'EMAIL' ? matchedTemplate.emailBody : matchedTemplate.smsBody
          );
        }
      }
    }
    setChannel(nextChannel);
  };

  const handleApplyStarterTemplate = (template: BroadcastStarterTemplate) => {
    setSelectedTemplateId(template.id);
    setSubject(template.subject);
    setBody(channel === 'EMAIL' ? template.emailBody : template.smsBody);
    setPreviewResult(null);
    setLastPreviewSignature(null);
  };

  const insertPlaceholder = (ph: string) => {
    if (!textareaRef.current) {
      setBody((prev) => prev + ph);
      return;
    }
    const start = textareaRef.current.selectionStart || 0;
    const end = textareaRef.current.selectionEnd || 0;
    const textBefore = body.substring(0, start);
    const textAfter = body.substring(end);
    const newBody = textBefore + ph + textAfter;
    setBody(newBody);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start + ph.length, start + ph.length);
      }
    }, 0);
  };

  const runPreviewRequest = async (options?: {
    silentEmpty?: boolean;
    switchToPreview?: boolean;
  }) => {
    if (!body.trim()) {
      if (!options?.silentEmpty) {
        addToast('Please enter a message body before previewing.', 'error');
      }
      return;
    }
    const requestSignature = JSON.stringify({
      channel,
      subject: channel === 'EMAIL' ? subject : undefined,
      body,
      targetFilters: effectiveTargetFilters,
    });
    try {
      const res = (await previewBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters: effectiveTargetFilters,
      })) as BroadcastPreviewData | null;
      setPreviewResult(res);
      if (typeof res?.recipientCount === 'number') {
        setRecipientCount(res.recipientCount);
      } else if (typeof res?.matchedCount === 'number') {
        setRecipientCount(res.matchedCount);
      }
      if (res?.baseUrlWarning) {
        setBaseUrlWarning(res.baseUrlWarning);
      }
      setHasCheckedBaseUrl(true);
      setLastPreviewSignature(requestSignature);
      if (options?.switchToPreview) {
        setActiveTab('preview');
      }
    } catch (err: unknown) {
      addToast(getBroadcastErrorMessage(err, 'Failed to generate preview'), 'error');
    }
  };

  const handleGeneratePreview = async () => {
    await runPreviewRequest({ switchToPreview: true });
  };

  const handleRefreshPreview = async () => {
    await runPreviewRequest({ switchToPreview: false });
  };

  const handleTabChange = (nextTab: 'compose' | 'preview') => {
    setActiveTab(nextTab);
    if (
      nextTab === 'preview' &&
      body.trim() &&
      lastPreviewSignature !== currentPreviewSignature
    ) {
      void runPreviewRequest({ silentEmpty: true });
    }
  };

  const handleSendTest = async () => {
    if (!body.trim()) {
      addToast('Message body is required for test send.', 'error');
      return;
    }
    if (channel === 'EMAIL' && !subject.trim()) {
      addToast('Subject is required for email broadcasts.', 'error');
      return;
    }

    try {
      const result = (await sendTestBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        destination: testDestination.trim() || undefined,
      })) as BroadcastTestSendResult | null;

      if (result?.baseUrlWarning) {
        setBaseUrlWarning(result.baseUrlWarning);
      }

      const recipient = result?.destination || testDestination.trim() || 'configured administrator contact';
      addToast(
        `Test ${channel === 'EMAIL' ? 'email' : 'SMS'} sent to ${recipient}!`,
        'success'
      );
    } catch (err: unknown) {
      addToast(getBroadcastErrorMessage(err, 'Failed to dispatch test broadcast'), 'error');
    }
  };

  const handleSend = async () => {
    if (!body.trim()) {
      addToast('Message body is required.', 'error');
      return;
    }
    if (channel === 'EMAIL' && !subject.trim()) {
      addToast('Subject is required for email broadcasts.', 'error');
      return;
    }
    if (isScheduled) {
      if (!scheduledFor) {
        addToast('Please select a scheduled date and time.', 'error');
        return;
      }
      if (new Date(scheduledFor) <= new Date()) {
        addToast('Scheduled time must be in the future.', 'error');
        return;
      }
    }

    try {
      const scheduledIso = isScheduled && scheduledFor ? new Date(scheduledFor).toISOString() : undefined;
      const result = (await sendBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters: effectiveTargetFilters,
        scheduledFor: scheduledIso,
      })) as BroadcastSendResult;

      const deliveryLogsAction = {
        label: 'View Delivery Logs',
        onClick: navigateToDeliveryLogs,
      };

      if (result.status === 'SCHEDULED') {
        addToast(
          `Broadcast scheduled for ${new Date(result.scheduledFor || scheduledFor).toLocaleString()}!`,
          'success',
          undefined,
          undefined,
          deliveryLogsAction
        );
      } else {
        addToast(
          `Broadcast dispatched! Sent: ${result.sentCount || 0}, Failed: ${result.failedCount || 0}`,
          (result.failedCount || 0) === 0 ? 'success' : 'info',
          undefined,
          undefined,
          deliveryLogsAction
        );
      }

      if (result?.baseUrlWarning && usesRsvpUrl) {
        addToast(result.baseUrlWarning, 'info');
      }
      onClose();
    } catch (err: unknown) {
      addToast(getBroadcastErrorMessage(err, 'Failed to dispatch broadcast'), 'error');
    }
  };

  const getTargetSummary = () => {
    const parts: string[] = [];
    if (isManualSelection) {
      parts.push(`${manualSelectionCount ?? 0} selected guest(s)`);
    } else {
      parts.push('All matching guests');
    }

    if (effectiveTargetFilters?.searchQuery) {
      parts.push(`Search: "${effectiveTargetFilters.searchQuery}"`);
    }
    if (effectiveTargetFilters?.status) {
      parts.push(`Redemption: ${effectiveTargetFilters.status}`);
    }
    if (effectiveTargetFilters?.addressStatus) {
      parts.push(`Address: ${effectiveTargetFilters.addressStatus}`);
    }
    if (effectiveTargetFilters?.attendanceStatus) {
      parts.push(`Status: ${effectiveTargetFilters.attendanceStatus}`);
    }
    if (effectiveTargetFilters?.dietaryCategory) {
      parts.push(`Dietary: ${effectiveTargetFilters.dietaryCategory}`);
    }
    if (effectiveTargetFilters?.partyGroup) {
      parts.push(`Group: ${effectiveTargetFilters.partyGroup}`);
    }
    if (effectiveTargetFilters?.partyTags && effectiveTargetFilters.partyTags.length > 0) {
      parts.push(`Tags: [${effectiveTargetFilters.partyTags.join(', ')}]`);
    }
    if (effectiveTargetFilters?.householdName) {
      parts.push(`Household: "${effectiveTargetFilters.householdName}"`);
    }
    if (effectiveTargetFilters?.subEventId) {
      const foundSub = subEvents.find((s) => s.id === effectiveTargetFilters.subEventId);
      const subLabel = foundSub?.title || effectiveTargetFilters.subEventId;
      const subStatus = effectiveTargetFilters.subEventRsvpStatus || 'all';
      parts.push(
        subStatus !== 'all'
          ? `Sub-Event: "${subLabel}" (${subStatus})`
          : `Sub-Event: "${subLabel}"`
      );
    }

    return parts.join(' • ');
  };

  const activeWarning = previewResult?.baseUrlWarning || baseUrlWarning;
  const showBaseUrlWarning = Boolean(activeWarning && (usesRsvpUrl || activeTab === 'preview'));
  const missingContactLabel = channel === 'EMAIL' ? 'email' : 'phone';

  return (
    <div className="space-y-4">
      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          aria-label="Broadcast navigation tabs"
          value={activeTab}
          onChange={handleTabChange}
          tabs={[
            {
              value: 'compose',
              label: 'Compose Message',
              id: 'broadcast-tab-compose',
              panelId: 'broadcast-tabpanel-compose',
            },
            {
              value: 'preview',
              label: 'Live Preview',
              id: 'broadcast-tab-preview',
              panelId: 'broadcast-tabpanel-preview',
            },
          ]}
        />
        <Link
          href="/admin/dashboard/history?tab=broadcasts"
          prefetch={false}
          className="text-xs font-semibold text-primary dark:text-zinc-200 underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1 py-0.5"
        >
          Delivery Logs
        </Link>
      </div>

      {/* Target Summary & Live Recipient Count Banner */}
      <div
        data-testid="broadcast-audience-banner"
        className="p-3 bg-primary/10 rounded-md border border-primary/20 text-xs text-gray-900 dark:text-zinc-100 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-primary dark:text-zinc-100">Target Audience:</span>{' '}
            <span>{getTargetSummary()}</span>
          </div>
          <div className="flex items-center gap-2">
            {(countingRecipients || effectiveRecipientCount !== null) && (
              <span
                data-testid="broadcast-recipient-count"
                aria-live="polite"
                className="inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold bg-white dark:bg-zinc-900 border border-primary/30 text-primary dark:text-zinc-100"
              >
                {countingRecipients
                  ? 'Counting recipients...'
                  : `${effectiveRecipientCount} matching ${effectiveRecipientCount === 1 ? 'recipient' : 'recipients'}`}
              </span>
            )}
            {!isManualSelection && effectiveTargetFilters && (
              <button
                type="button"
                onClick={() => {
                  setLocalFilters({});
                  setPreviewResult(null);
                  setLastPreviewSignature(null);
                }}
                className="underline font-medium text-primary dark:text-zinc-200 hover:opacity-80"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {audienceStats !== null && (
          <div
            data-testid="broadcast-audience-counts"
            className="flex flex-wrap items-center gap-2 pt-0.5"
          >
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 font-semibold text-gray-800 dark:text-zinc-100">
              {audienceStats.matchedCount} matched {audienceStats.matchedCount === 1 ? 'guest' : 'guests'}
            </span>
            <span
              className={
                audienceStats.missingContactCount > 0
                  ? 'inline-flex items-center px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-400 dark:border-amber-700 font-semibold text-amber-900 dark:text-amber-200'
                  : 'inline-flex items-center px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 font-semibold text-emerald-900 dark:text-emerald-200'
              }
            >
              {audienceStats.missingContactCount} missing {missingContactLabel}
            </span>
          </div>
        )}

        {!isManualSelection && activeTab === 'compose' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-primary/15 text-gray-800 dark:text-zinc-200">
            <FormGroup>
              <Label htmlFor="broadcast-filter-rsvp">RSVP Status</Label>
              <Select
                id="broadcast-filter-rsvp"
                value={localFilters.attendanceStatus || 'all'}
                onChange={(e) => {
                  const val = e.target.value as BroadcastTargetFilters['attendanceStatus'];
                  setLocalFilters((prev) => ({
                    ...prev,
                    attendanceStatus: val === 'all' ? undefined : val,
                  }));
                  setPreviewResult(null);
                }}
                className="w-full"
              >
                <option value="all">All RSVP Statuses</option>
                <option value="pending">Pending</option>
                <option value="attending">Attending</option>
                <option value="declined">Declined</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="broadcast-filter-address">Address Completion</Label>
              <Select
                id="broadcast-filter-address"
                value={localFilters.addressStatus ?? localFilters.addressFilter ?? 'all'}
                onChange={(e) => {
                  const val = e.target.value as BroadcastTargetFilters['addressStatus'];
                  setLocalFilters((prev) => ({
                    ...prev,
                    addressStatus: val === 'all' ? undefined : val,
                    addressFilter: undefined,
                  }));
                  setPreviewResult(null);
                }}
                className="w-full"
              >
                <option value="all">All Addresses</option>
                <option value="missing">Missing Address</option>
                <option value="complete">Complete Address</option>
              </Select>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="broadcast-filter-subevent">Sub-Event</Label>
              <Select
                id="broadcast-filter-subevent"
                value={localFilters.subEventId || ''}
                onChange={(e) => {
                  const nextSubId = e.target.value;
                  setLocalFilters((prev) => ({
                    ...prev,
                    subEventId: nextSubId || undefined,
                    subEventRsvpStatus: nextSubId ? prev.subEventRsvpStatus : undefined,
                  }));
                  setPreviewResult(null);
                }}
                className="w-full"
              >
                <option value="">All Invited Guests</option>
                {subEvents.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {evt.title} {evt.isPrivate ? '(Private)' : '(Public)'}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="broadcast-filter-subevent-status">Sub-Event RSVP Status</Label>
              <Select
                id="broadcast-filter-subevent-status"
                value={localFilters.subEventRsvpStatus || 'all'}
                disabled={!localFilters.subEventId}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalFilters((prev) => ({
                    ...prev,
                    subEventRsvpStatus: val === 'all' ? undefined : val,
                  }));
                  setPreviewResult(null);
                }}
                className="w-full disabled:opacity-50"
              >
                <option value="all">All Sub-Event Invitees</option>
                <option value="pending">Pending (No Response Yet)</option>
                <option value="attending">Attending Sub-Event</option>
                <option value="declined">Declined Sub-Event</option>
              </Select>
            </FormGroup>
          </div>
        )}
      </div>

      {showBaseUrlWarning && (
        <div
          role="status"
          data-testid="broadcast-baseurl-warning"
          className="p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200"
        >
          <span className="font-semibold">Admin Warning:</span> {activeWarning}
        </div>
      )}

      {activeTab === 'compose' ? (
        <SegmentedTabPanel
          id="broadcast-tabpanel-compose"
          tabId="broadcast-tab-compose"
          className="space-y-4"
        >
          <FormGroup>
            <Label htmlFor="broadcast-channel">Channel</Label>
            <Select
              id="broadcast-channel"
              value={channel}
              onChange={(e) => handleChannelChange(e.target.value as BroadcastChannel)}
              className="w-full"
            >
              <option value="EMAIL">Email Broadcast</option>
              <option value="SMS">SMS Alert / Text Message</option>
            </Select>
          </FormGroup>

          {/* Starter Templates */}
          <div>
            <span className="text-xs font-semibold text-gray-600 dark:text-zinc-300 mb-1.5 block">
              Starter Templates:
            </span>
            <div
              role="group"
              aria-label="Starter templates"
              className="flex flex-wrap gap-1.5"
            >
              {BROADCAST_STARTER_TEMPLATES.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    aria-pressed={isSelected}
                    title={tpl.description}
                    onClick={() => handleApplyStarterTemplate(tpl)}
                    className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                      isSelected
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white hover:bg-gray-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 border-gray-300 dark:border-zinc-600'
                    }`}
                  >
                    {tpl.label}
                  </button>
                );
              })}
            </div>
          </div>

          {channel === 'EMAIL' && (
            <FormGroup>
              <Label htmlFor="broadcast-subject">Subject</Label>
              <Input
                id="broadcast-subject"
                type="text"
                placeholder="e.g. Important Schedule Update regarding Wedding Rehearsal"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full"
              />
            </FormGroup>
          )}

          {/* Template Variables Quick Insert Toolbar */}
          <div>
            <span className="text-xs font-semibold text-gray-600 dark:text-zinc-300 mb-1.5 block">
              Insert Dynamic Placeholders:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TEMPLATE_PLACEHOLDERS.map((item) => (
                <button
                  key={item.placeholder}
                  type="button"
                  onClick={() => insertPlaceholder(item.placeholder)}
                  title={item.description}
                  className="inline-flex items-center px-2 py-1 text-xs font-mono bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 rounded border border-gray-300 dark:border-zinc-600 transition-colors"
                >
                  + {item.placeholder}
                </button>
              ))}
            </div>
          </div>

          <FormGroup>
            <Label htmlFor="broadcast-body">Message Body</Label>
            <Textarea
              ref={textareaRef}
              id="broadcast-body"
              rows={6}
              placeholder={
                channel === 'EMAIL'
                  ? 'Hi {{guestName}},\n\nPlease note that the location for the rehearsal dinner has changed...'
                  : 'Wedding Update: Hi {{guestName}}, due to morning rain, our ceremony is moving indoors to the main hall!'
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full font-sans"
            />
          </FormGroup>

          {/* Test Destination Override Option */}
          <FormGroup>
            <Label htmlFor="broadcast-test-destination">Test Destination (Optional)</Label>
            <Input
              id="broadcast-test-destination"
              type={channel === 'EMAIL' ? 'email' : 'tel'}
              placeholder={
                channel === 'EMAIL'
                  ? (defaultAdminEmail || 'e.g. host@example.com')
                  : (adminPhone || 'e.g. +15551234567')
              }
              value={testDestination}
              onChange={(e) => setTestDestination(e.target.value)}
              className="w-full"
            />
            <span className="text-xs text-gray-600 dark:text-zinc-300 mt-1 block">
              Leave blank to deliver to configured host {channel === 'EMAIL' ? 'contact email' : 'phone number'}.
            </span>
          </FormGroup>

          {/* Schedule for Later Option */}
          <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-md border border-gray-200 dark:border-zinc-700 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-800 dark:text-zinc-200">
              <input
                type="checkbox"
                id="broadcast-schedule-toggle"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="rounded text-primary focus:ring-primary h-4 w-4"
              />
              Schedule message for future automated delivery
            </label>

            {isScheduled && (
              <FormGroup>
                <Label htmlFor="broadcast-scheduled-for">Dispatch Date & Time</Label>
                <Input
                  id="broadcast-scheduled-for"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="w-full"
                />
                <span className="text-xs text-gray-600 dark:text-zinc-300 mt-1 block">
                  The background cron worker will automatically dispatch this message when the scheduled time arrives.
                </span>
              </FormGroup>
            )}
          </div>
        </SegmentedTabPanel>
      ) : (
        /* Preview Tab Content */
        <SegmentedTabPanel
          id="broadcast-tabpanel-preview"
          tabId="broadcast-tab-preview"
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600 dark:text-zinc-300">
              Personalized sample output ({channel === 'EMAIL' ? 'Email' : 'SMS'})
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRefreshPreview}
              disabled={previewing || !body.trim()}
            >
              {previewing ? 'Refreshing...' : 'Refresh Preview'}
            </Button>
          </div>

          {previewResult ? (
            <div className="border border-gray-200 dark:border-zinc-700 rounded-md p-4 bg-gray-50 dark:bg-zinc-900/50 space-y-3">
              <div className="text-xs text-gray-600 dark:text-zinc-300 flex justify-between border-b pb-2 dark:border-zinc-700">
                <span>Sample Recipient: <strong>{previewResult.sampleGuestName}</strong></span>
                <span>Destination: <strong>{previewResult.destination}</strong></span>
              </div>

              {previewResult.subject && (
                <div>
                  <span className="text-xs text-gray-600 dark:text-zinc-300 uppercase tracking-wider block font-semibold">Subject:</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{previewResult.subject}</h3>
                </div>
              )}

              <div>
                <span className="text-xs text-gray-600 dark:text-zinc-300 uppercase tracking-wider block font-semibold mb-1">Body Preview:</span>
                <div className="bg-white dark:bg-zinc-800 p-3 rounded border border-gray-200 dark:border-zinc-700 whitespace-pre-wrap text-sm text-gray-800 dark:text-zinc-200">
                  {previewResult.body}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-gray-600 dark:text-zinc-300">
              {previewing
                ? 'Rendering dynamic variables...'
                : 'Enter a message body in Compose Message or click Refresh Preview to render dynamic variables.'}
            </div>
          )}
        </SegmentedTabPanel>
      )}

      {/* Modal Actions */}
      <div className="sticky bottom-0 bg-white dark:bg-zinc-900 flex justify-end space-x-3 pt-3 pb-1 border-t border-gray-200 dark:border-zinc-800">
        <Button variant="secondary" onClick={onClose} disabled={sending || sendingTest}>
          Cancel
        </Button>
        {activeTab === 'compose' && (
          <Button variant="secondary" onClick={handleGeneratePreview} disabled={previewing || !body.trim()}>
            {previewing ? 'Previewing...' : 'Preview'}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={handleSendTest}
          disabled={sendingTest || sending || !body.trim() || (channel === 'EMAIL' && !subject.trim())}
          aria-label="Send Test to Me"
        >
          {sendingTest ? 'Sending Test...' : (testDestination.trim() ? 'Send Test' : 'Send Test to Me')}
        </Button>
        <Button
          onClick={handleSend}
          disabled={
            sending ||
            sendingTest ||
            !body.trim() ||
            (channel === 'EMAIL' && !subject.trim()) ||
            effectiveRecipientCount === 0
          }
        >
          {sending
            ? (isScheduled ? 'Scheduling Broadcast...' : 'Sending Broadcast...')
            : (isScheduled ? 'Schedule Broadcast' : `Send ${channel === 'EMAIL' ? 'Email' : 'SMS'}`)
          }
        </Button>
      </div>
    </div>
  );
};

export const BroadcastModal: React.FC<BroadcastModalProps> = (props) => {
  const { isOpen, onClose, initialChannel = 'EMAIL', targetFilters } = props;
  const serializedInitialFilters = JSON.stringify(targetFilters ?? null);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Compose Multi-Channel Broadcast"
      className="max-w-2xl"
      contentClassName="px-6 py-4 max-h-[82vh] overflow-y-auto"
    >
      <BroadcastModalForm
        key={`${isOpen ? 'open' : 'closed'}-${initialChannel}-${serializedInitialFilters}`}
        {...props}
        initialChannel={initialChannel}
      />
    </Dialog>
  );
};
