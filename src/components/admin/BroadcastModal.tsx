'use client';

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
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
} from '@/features/broadcast';

export interface BroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialChannel?: BroadcastChannel;
  targetFilters?: BroadcastTargetFilters;
  selectedCount?: number;
  initialRecipientCount?: number;
  subEvents?: any[];
  adminEmail?: string;
  adminPhone?: string;
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
  if (filters.addressFilter && filters.addressFilter !== 'all') {
    normalized.addressFilter = filters.addressFilter;
  }
  if (filters.dietaryFilter && filters.dietaryFilter !== 'all') {
    normalized.dietaryFilter = filters.dietaryFilter;
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
  subEvents = [],
  adminEmail,
  adminPhone,
}) => {
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
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(
    manualSelectionCount ?? initialRecipientCount ?? null
  );
  const [resolvedCountKey, setResolvedCountKey] = useState<string | null>(null);
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

  const countingRecipients =
    typeof countRecipients === 'function' && resolvedCountKey !== filtersKey;

  useEffect(() => {
    if (typeof countRecipients !== 'function') {
      return;
    }

    let cancelled = false;

    countRecipients(effectiveTargetFilters)
      .then((res) => {
        if (cancelled) return;
        if (typeof res?.recipientCount === 'number') {
          setRecipientCount(res.recipientCount);
        }
        setBaseUrlWarning(res?.baseUrlWarning ?? null);
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
  }, [countRecipients, filtersKey, effectiveTargetFilters]);

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

  const handleGeneratePreview = async () => {
    if (!body.trim()) {
      addToast('Please enter a message body before previewing.', 'error');
      return;
    }
    try {
      const res: any = await previewBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters: effectiveTargetFilters,
      });
      setPreviewResult(res);
      if (typeof res?.recipientCount === 'number') {
        setRecipientCount(res.recipientCount);
      }
      if (res?.baseUrlWarning) {
        setBaseUrlWarning(res.baseUrlWarning);
      }
      setActiveTab('preview');
    } catch (err: any) {
      addToast(err.message || 'Failed to generate preview', 'error');
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
      const result: any = await sendTestBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        destination: testDestination.trim() || undefined,
      });

      if (result?.baseUrlWarning) {
        setBaseUrlWarning(result.baseUrlWarning);
      }

      const recipient = result?.destination || testDestination.trim() || 'configured administrator contact';
      addToast(
        `Test ${channel === 'EMAIL' ? 'email' : 'SMS'} sent to ${recipient}!`,
        'success'
      );
    } catch (err: any) {
      addToast(err.message || 'Failed to dispatch test broadcast', 'error');
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
      const result: any = await sendBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters: effectiveTargetFilters,
        scheduledFor: scheduledIso,
      });

      if (result?.baseUrlWarning && (body.includes('{{rsvpUrl}}') || subject.includes('{{rsvpUrl}}'))) {
        addToast(result.baseUrlWarning, 'info');
      }

      if (result.status === 'SCHEDULED') {
        addToast(
          `Broadcast scheduled for ${new Date(result.scheduledFor || scheduledFor).toLocaleString()}!`,
          'success'
        );
      } else {
        addToast(
          `Broadcast dispatched! Sent: ${result.sentCount || 0}, Failed: ${result.failedCount || 0}`,
          (result.failedCount || 0) === 0 ? 'success' : 'info'
        );
      }
      onClose();
    } catch (err: any) {
      addToast(err.message || 'Failed to dispatch broadcast', 'error');
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
    if (effectiveTargetFilters?.partyGroup) {
      parts.push(`Group: "${effectiveTargetFilters.partyGroup}"`);
    }
    if (effectiveTargetFilters?.partyTags && effectiveTargetFilters.partyTags.length > 0) {
      parts.push(`Tags: [${effectiveTargetFilters.partyTags.join(', ')}]`);
    }
    if (effectiveTargetFilters?.householdName) {
      parts.push(`Household: "${effectiveTargetFilters.householdName}"`);
    }
    if (effectiveTargetFilters?.status) {
      parts.push(`Code Status: ${effectiveTargetFilters.status}`);
    }
    if (effectiveTargetFilters?.attendanceStatus) {
      parts.push(`RSVP: ${effectiveTargetFilters.attendanceStatus}`);
    }
    if (effectiveTargetFilters?.addressFilter) {
      parts.push(`Address: ${effectiveTargetFilters.addressFilter}`);
    }
    if (effectiveTargetFilters?.dietaryFilter) {
      parts.push(`Dietary: ${effectiveTargetFilters.dietaryFilter}`);
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
  const usesRsvpUrl = body.includes('{{rsvpUrl}}') || subject.includes('{{rsvpUrl}}');
  const showBaseUrlWarning = Boolean(activeWarning && (usesRsvpUrl || activeTab === 'preview'));

  return (
    <div className="space-y-4">
      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Broadcast navigation tabs"
        className="flex border-b border-gray-200 dark:border-zinc-700"
      >
        <button
          type="button"
          role="tab"
          id="broadcast-tab-compose"
          aria-selected={activeTab === 'compose'}
          aria-controls="broadcast-tabpanel-compose"
          onClick={() => setActiveTab('compose')}
          className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'compose'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400'
          }`}
        >
          Compose Message
        </button>
        <button
          type="button"
          role="tab"
          id="broadcast-tab-preview"
          aria-selected={activeTab === 'preview'}
          aria-controls="broadcast-tabpanel-preview"
          onClick={() => setActiveTab('preview')}
          className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'preview'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400'
          }`}
        >
          Live Preview
        </button>
      </div>

      {/* Target Summary & Live Recipient Count Banner */}
      <div className="p-3 bg-primary/10 rounded-md border border-primary/20 text-xs text-primary space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold">Target Audience:</span> {getTargetSummary()}
          </div>
          <div className="flex items-center gap-2">
            {(countingRecipients || recipientCount !== null) && (
              <span
                data-testid="broadcast-recipient-count"
                aria-live="polite"
                className="inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold bg-white dark:bg-zinc-900 border border-primary/30 text-primary"
              >
                {countingRecipients
                  ? 'Counting recipients...'
                  : `${recipientCount} matching ${recipientCount === 1 ? 'recipient' : 'recipients'}`}
              </span>
            )}
            {!isManualSelection && effectiveTargetFilters && (
              <button
                type="button"
                onClick={() => {
                  setLocalFilters({});
                  setPreviewResult(null);
                }}
                className="underline font-medium hover:opacity-80"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

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
                value={localFilters.addressFilter || 'all'}
                onChange={(e) => {
                  const val = e.target.value as BroadcastTargetFilters['addressFilter'];
                  setLocalFilters((prev) => ({
                    ...prev,
                    addressFilter: val === 'all' ? undefined : val,
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
        <div
          role="tabpanel"
          id="broadcast-tabpanel-compose"
          aria-labelledby="broadcast-tab-compose"
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
            <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1.5 block">
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
            <span className="text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-1.5 block">
              Insert Dynamic Placeholders:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TEMPLATE_PLACEHOLDERS.map((item) => (
                <button
                  key={item.placeholder}
                  type="button"
                  onClick={() => insertPlaceholder(item.placeholder)}
                  title={item.description}
                  className="inline-flex items-center px-2 py-1 text-xs font-mono bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300 rounded border border-gray-300 dark:border-zinc-600 transition-colors"
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
            <span className="text-xs text-gray-500 dark:text-zinc-400 mt-1 block">
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
                <span className="text-xs text-gray-500 dark:text-zinc-400 mt-1 block">
                  The background cron worker will automatically dispatch this message when the scheduled time arrives.
                </span>
              </FormGroup>
            )}
          </div>
        </div>
      ) : (
      /* Preview Tab Content */
        <div
          role="tabpanel"
          id="broadcast-tabpanel-preview"
          aria-labelledby="broadcast-tab-preview"
          className="space-y-4"
        >
          {previewResult ? (
            <div className="border border-gray-200 dark:border-zinc-700 rounded-md p-4 bg-gray-50 dark:bg-zinc-900/50 space-y-3">
              <div className="text-xs text-gray-500 dark:text-zinc-400 flex justify-between border-b pb-2 dark:border-zinc-700">
                <span>Sample Recipient: <strong>{previewResult.sampleGuestName}</strong></span>
                <span>Destination: <strong>{previewResult.destination}</strong></span>
              </div>

              {previewResult.subject && (
                <div>
                  <span className="text-xs text-gray-400 dark:text-zinc-500 uppercase tracking-wider block font-semibold">Subject:</span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{previewResult.subject}</h3>
                </div>
              )}

              <div>
                <span className="text-xs text-gray-400 dark:text-zinc-500 uppercase tracking-wider block font-semibold mb-1">Body Preview:</span>
                <div className="bg-white dark:bg-zinc-800 p-3 rounded border border-gray-200 dark:border-zinc-700 whitespace-pre-wrap text-sm text-gray-800 dark:text-zinc-200">
                  {previewResult.body}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-zinc-400">
              Click "Live Preview" or switch tabs to render dynamic variables.
            </div>
          )}
        </div>
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
            recipientCount === 0
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
