'use client';

import React, { useState, useRef, useMemo } from 'react';
import Link from 'next/link';
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
  AVAILABLE_TEMPLATE_PLACEHOLDERS,
  summarizeBroadcastAudience,
} from '@/features/broadcast';

export interface BroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialChannel?: BroadcastChannel;
  targetFilters?: BroadcastTargetFilters;
  selectedCount?: number;
  guests?: Array<Record<string, any>>;
  subEvents?: any[];
  adminEmail?: string;
  adminPhone?: string;
  onViewDeliveryLogs?: () => void;
}

const BroadcastModalForm: React.FC<BroadcastModalProps> = ({
  onClose,
  initialChannel = 'EMAIL',
  targetFilters,
  selectedCount,
  guests,
  subEvents = [],
  adminEmail,
  adminPhone,
  onViewDeliveryLogs,
}) => {
  const { addToast } = useToast();
  const { contactEmail } = useTheme();
  const defaultAdminEmail = adminEmail || contactEmail || '';
  const {
    sendBroadcast,
    previewBroadcast,
    sendTestBroadcast,
    sending,
    previewing,
    sendingTest,
  } = useAdminBroadcast();

  const [channel, setChannel] = useState<BroadcastChannel>(initialChannel);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testDestination, setTestDestination] = useState('');
  const [activeTab, setActiveTab] = useState<'compose' | 'preview'>('compose');
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [lastPreviewSignature, setLastPreviewSignature] = useState<string | null>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentPreviewSignature = useMemo(
    () =>
      JSON.stringify({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters,
      }),
    [channel, subject, body, targetFilters]
  );

  const audienceStats = useMemo(() => {
    if (Array.isArray(guests)) {
      return summarizeBroadcastAudience(guests, targetFilters, channel);
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
    return null;
  }, [guests, targetFilters, channel, previewResult]);

  const navigateToDeliveryLogs = () => {
    if (onViewDeliveryLogs) {
      onViewDeliveryLogs();
    } else if (typeof window !== 'undefined') {
      window.location.assign('/admin/dashboard/history?tab=broadcasts');
    }
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
      targetFilters,
    });
    try {
      const res = await previewBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters,
      });
      setPreviewResult(res);
      setLastPreviewSignature(requestSignature);
      if (options?.switchToPreview) {
        setActiveTab('preview');
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to generate preview', 'error');
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
      const result: any = await sendTestBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        destination: testDestination.trim() || undefined,
      });

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
        targetFilters,
        scheduledFor: scheduledIso,
      });

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
      onClose();
    } catch (err: any) {
      addToast(err.message || 'Failed to dispatch broadcast', 'error');
    }
  };

  const getTargetSummary = () => {
    const parts: string[] = [];
    const resolvedSelectedCount =
      selectedCount !== undefined && selectedCount > 0
        ? selectedCount
        : targetFilters?.selectedIds?.length || 0;

    if (resolvedSelectedCount > 0) {
      parts.push(`${resolvedSelectedCount} selected guest(s)`);
    } else {
      parts.push('All matching guests');
    }

    if (targetFilters?.searchQuery) {
      parts.push(`Search: "${targetFilters.searchQuery}"`);
    }
    if (targetFilters?.status && targetFilters.status !== 'all') {
      parts.push(`Redemption: ${targetFilters.status}`);
    }
    if (targetFilters?.addressStatus && targetFilters.addressStatus !== 'all') {
      parts.push(`Address: ${targetFilters.addressStatus}`);
    }
    if (targetFilters?.attendanceStatus && targetFilters.attendanceStatus !== 'all') {
      parts.push(`Status: ${targetFilters.attendanceStatus}`);
    }
    if (targetFilters?.dietaryCategory && targetFilters.dietaryCategory !== 'all') {
      parts.push(`Dietary: ${targetFilters.dietaryCategory}`);
    }
    if (targetFilters?.partyGroup && targetFilters.partyGroup !== 'all') {
      parts.push(`Group: ${targetFilters.partyGroup}`);
    }
    if (targetFilters?.partyTags && targetFilters.partyTags.length > 0) {
      parts.push(`Tags: [${targetFilters.partyTags.join(', ')}]`);
    }
    if (targetFilters?.householdName) {
      parts.push(`Household: "${targetFilters.householdName}"`);
    }
    if (targetFilters?.subEventId) {
      const foundSub = subEvents.find((s) => s.id === targetFilters.subEventId);
      parts.push(`Sub-Event: "${foundSub?.title || targetFilters.subEventId}"`);
    }

    return parts.join(' • ');
  };

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

      {/* Target Summary Banner */}
      <div
        data-testid="broadcast-audience-banner"
        className="p-3 bg-primary/10 rounded-md border border-primary/20 text-xs text-gray-900 dark:text-zinc-100 space-y-1.5"
      >
        <div>
          <span className="font-semibold text-primary dark:text-zinc-100">Target Audience:</span>{' '}
          <span>{getTargetSummary()}</span>
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
      </div>

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
              onChange={(e) => setChannel(e.target.value as BroadcastChannel)}
              className="w-full"
            >
              <option value="EMAIL">Email Broadcast</option>
              <option value="SMS">SMS Alert / Text Message</option>
            </Select>
          </FormGroup>

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
      <div className="flex justify-end space-x-3 pt-3 border-t border-gray-200 dark:border-zinc-800">
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
          disabled={sending || sendingTest || !body.trim() || (channel === 'EMAIL' && !subject.trim())}
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
  const { isOpen, onClose, initialChannel = 'EMAIL' } = props;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Compose Multi-Channel Broadcast"
      className="max-w-2xl"
    >
      <BroadcastModalForm
        key={`${isOpen ? 'open' : 'closed'}-${initialChannel}`}
        {...props}
        initialChannel={initialChannel}
      />
    </Dialog>
  );
};
