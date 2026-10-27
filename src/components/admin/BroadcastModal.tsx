'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import {
  BroadcastChannel,
  BroadcastTargetFilters,
  AVAILABLE_TEMPLATE_PLACEHOLDERS,
} from '@/features/broadcast';

export interface BroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialChannel?: BroadcastChannel;
  targetFilters?: BroadcastTargetFilters;
  selectedCount?: number;
  subEvents?: any[];
}

export const BroadcastModal: React.FC<BroadcastModalProps> = ({
  isOpen,
  onClose,
  initialChannel = 'EMAIL',
  targetFilters,
  selectedCount,
  subEvents = [],
}) => {
  const { addToast } = useToast();
  const { sendBroadcast, previewBroadcast, sending, previewing } = useAdminBroadcast();

  const [channel, setChannel] = useState<BroadcastChannel>(initialChannel);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [activeTab, setActiveTab] = useState<'compose' | 'preview'>('compose');
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setChannel(initialChannel);
      setSubject('');
      setBody('');
      setActiveTab('compose');
      setPreviewResult(null);
      setIsScheduled(false);
      setScheduledFor('');
    }
  }, [isOpen, initialChannel]);

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
      const res = await previewBroadcast({
        channel,
        subject: channel === 'EMAIL' ? subject : undefined,
        body,
        targetFilters,
      });
      setPreviewResult(res);
      setActiveTab('preview');
    } catch (err: any) {
      addToast(err.message || 'Failed to generate preview', 'error');
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
    if (selectedCount !== undefined && selectedCount > 0) {
      parts.push(`${selectedCount} selected guest(s)`);
    } else {
      parts.push('All matching guests');
    }

    if (targetFilters?.partyTags && targetFilters.partyTags.length > 0) {
      parts.push(`Tags: [${targetFilters.partyTags.join(', ')}]`);
    }
    if (targetFilters?.householdName) {
      parts.push(`Household: "${targetFilters.householdName}"`);
    }
    if (targetFilters?.attendanceStatus && targetFilters.attendanceStatus !== 'all') {
      parts.push(`Status: ${targetFilters.attendanceStatus}`);
    }
    if (targetFilters?.subEventId) {
      const foundSub = subEvents.find((s) => s.id === targetFilters.subEventId);
      parts.push(`Sub-Event: "${foundSub?.title || targetFilters.subEventId}"`);
    }

    return parts.join(' • ');
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Compose Multi-Channel Broadcast"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setActiveTab('compose')}
            className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'compose'
                ? 'border-red-700 text-red-700 dark:text-red-400 dark:border-red-400 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400'
            }`}
          >
            Compose Message
          </button>
          <button
            type="button"
            onClick={handleGeneratePreview}
            disabled={previewing}
            className={`py-2 px-4 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'preview'
                ? 'border-red-700 text-red-700 dark:text-red-400 dark:border-red-400 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-zinc-400'
            }`}
          >
            {previewing ? 'Rendering...' : 'Live Preview'}
          </button>
        </div>

        {/* Target Summary Banner */}
        <div className="p-3 bg-red-50 dark:bg-zinc-800/80 rounded-md border border-red-100 dark:border-zinc-700 text-xs text-red-900 dark:text-zinc-200">
          <span className="font-semibold">Target Audience:</span> {getTargetSummary()}
        </div>

        {activeTab === 'compose' ? (
          <div className="space-y-4">
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

            {/* Schedule for Later Option */}
            <div className="p-3 bg-gray-50 dark:bg-zinc-800/60 rounded-md border border-gray-200 dark:border-zinc-700 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  id="broadcast-schedule-toggle"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="rounded text-red-600 focus:ring-red-500 h-4 w-4"
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
          <div className="space-y-4">
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
        <div className="flex justify-end space-x-3 pt-3 border-t border-gray-200 dark:border-zinc-800">
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          {activeTab === 'compose' && (
            <Button variant="secondary" onClick={handleGeneratePreview} disabled={previewing || !body.trim()}>
              {previewing ? 'Previewing...' : 'Preview'}
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={sending || !body.trim() || (channel === 'EMAIL' && !subject.trim())}
          >
            {sending
              ? (isScheduled ? 'Scheduling Broadcast...' : 'Sending Broadcast...')
              : (isScheduled ? 'Schedule Broadcast' : `Send ${channel === 'EMAIL' ? 'Email' : 'SMS'}`)
            }
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
