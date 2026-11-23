'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { useAdminSubEvents } from '@/hooks/admin/useAdminSubEvents';
import { FormGroup, Label, Input, Select } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { SegmentedTabs, SegmentedTabPanel } from '@/components/ui/SegmentedTabs';
import { useToast } from '@/components/ui/ToastProvider';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { CsvImportWizardModal } from '@/components/admin/CsvImportWizardModal';
import { BroadcastModal } from '@/components/admin/BroadcastModal';
import { InvitationQRPreviewModal, InvitationQRPreviewGuest } from '@/components/admin/InvitationQRPreviewModal';
import { InvitationQRPrintLabelsModal, PrintableInvitationCode } from '@/components/admin/InvitationQRPrintLabelsModal';
import { GuestEditorForm, GuestEditorModal } from '@/components/admin/GuestEditorModal';
import {
  SubEventEditorModal,
  SubEventDeleteConfirmModal,
  type EditableSubEvent,
} from '@/components/admin/SubEventEditorModal';
import { AdminViewState } from '@/components/admin/AdminViewState';
import {
  extractDietaryTags,
  matchDietaryCategory,
  getAttendanceStatus,
  formatGuestPlusOneNames,
  formatGuestMealSelections,
  formatGuestCustomAnswers,
  isAddressComplete,
  type InvitationCodeDTO,
} from '@/features/registry';
import type { RsvpSummaryResponse, SubEventDTO } from '@/features/sub-events';
import { computeMergedInvitationPreview } from '@/utils/invitationValidation';
import { INVITATION_DEFAULT_PAGE_SIZE } from '@/utils/invitationPagination';
import { withBasePath } from '@/lib/basePath';

const EMPTY_SUB_EVENT_IDS: string[] = [];
const RSVP_SUMMARY_QUERY_KEY = ['admin-rsvp-summary'] as const;

interface GuestEventRsvpPill {
  key: string;
  title: string;
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
}

function getGuestAttendingPlusOneCount(item: InvitationCodeDTO): number {
  if (getAttendanceStatus(item) !== 'attending') return 0;

  if (Array.isArray(item.subEventRsvps)) {
    const attendingRows = item.subEventRsvps.filter((r) => r.status === 'attending');
    if (attendingRows.length > 0) {
      return Math.max(0, ...attendingRows.map((r) => r.plusOneCount ?? 0));
    }
  }

  const extra =
    item.extraFields && typeof item.extraFields === 'object' && !Array.isArray(item.extraFields)
      ? (item.extraFields as Record<string, unknown>)
      : null;

  if (extra) {
    if (typeof extra.plusOneCount === 'number' && Number.isFinite(extra.plusOneCount)) {
      return Math.max(0, Math.trunc(extra.plusOneCount));
    }
    if (typeof extra.attendingPlusOneCount === 'number' && Number.isFinite(extra.attendingPlusOneCount)) {
      return Math.max(0, Math.trunc(extra.attendingPlusOneCount));
    }
    if (Array.isArray(extra.plusOneNames)) {
      const namedCount = extra.plusOneNames.filter(
        (v): v is string => typeof v === 'string' && Boolean(v.trim())
      ).length;
      if (namedCount > 0) return namedCount;
    }
  }

  if (item.plusOneFirstName?.trim() || item.plusOneLastName?.trim()) {
    return 1;
  }

  return 0;
}

function getGuestEventRsvpPills(
  item: InvitationCodeDTO,
  subEvents: EditableSubEvent[]
): GuestEventRsvpPill[] {
  const titleById = new Map<string, string>();
  subEvents.forEach((evt) => {
    titleById.set(evt.id, evt.title);
  });

  const extra =
    item.extraFields && typeof item.extraFields === 'object' && !Array.isArray(item.extraFields)
      ? (item.extraFields as Record<string, unknown>)
      : null;

  if (extra && Array.isArray(extra.eventRsvps)) {
    extra.eventRsvps.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const obj = entry as Record<string, unknown>;
      if (typeof obj.subEventId === 'string' && typeof obj.subEventTitle === 'string' && obj.subEventTitle.trim()) {
        if (!titleById.has(obj.subEventId)) {
          titleById.set(obj.subEventId, obj.subEventTitle.trim());
        }
      }
    });
  }

  if (Array.isArray(item.subEventRsvps) && item.subEventRsvps.length > 0) {
    return item.subEventRsvps.map((rsvp) => ({
      key: rsvp.id || rsvp.subEventId,
      title: titleById.get(rsvp.subEventId) || 'Sub-Event',
      status: rsvp.status,
      plusOneCount: rsvp.status === 'attending' ? Math.max(0, rsvp.plusOneCount ?? 0) : 0,
    }));
  }

  if (extra && Array.isArray(extra.eventRsvps)) {
    const pills: GuestEventRsvpPill[] = [];
    extra.eventRsvps.forEach((entry, idx) => {
      if (!entry || typeof entry !== 'object') return;
      const obj = entry as Record<string, unknown>;
      const rawStatus = typeof obj.status === 'string' ? obj.status : '';
      if (rawStatus !== 'attending' && rawStatus !== 'declined' && rawStatus !== 'pending') return;
      const subEventId = typeof obj.subEventId === 'string' ? obj.subEventId : `evt-${idx}`;
      const title =
        (typeof obj.subEventTitle === 'string' && obj.subEventTitle.trim()) ||
        titleById.get(subEventId) ||
        'Sub-Event';
      const plusOneCount =
        rawStatus === 'attending' && typeof obj.plusOneCount === 'number'
          ? Math.max(0, Math.trunc(obj.plusOneCount))
          : 0;
      pills.push({
        key: subEventId,
        title,
        status: rawStatus,
        plusOneCount,
      });
    });
    return pills;
  }

  return [];
}

interface InvitationCodeRowInfoProps {
  item: InvitationCodeDTO;
  subEvents: EditableSubEvent[];
  allowedSubEventIds: string[];
  onPreviewQr: (_item: InvitationCodeDTO) => void;
  onToggleSubEventAccess: (_invitationCodeId: string, _subEventId: string, _isAllowed: boolean) => void;
}

const InvitationCodeRowInfo = React.memo<InvitationCodeRowInfoProps>(
  function InvitationCodeRowInfo({
    item,
    subEvents,
    allowedSubEventIds,
    onPreviewQr,
    onToggleSubEventAccess,
  }) {
    const hasAddress = isAddressComplete(item);
    const attendanceStatus = getAttendanceStatus(item);
    const plusOneNamesDisplay = formatGuestPlusOneNames(item);
    const attendingPlusOneCount = getGuestAttendingPlusOneCount(item);
    const mealSelectionsDisplay = formatGuestMealSelections(item);
    const customAnswersDisplay = formatGuestCustomAnswers(item);
    const eventRsvpPills = getGuestEventRsvpPills(item, subEvents);

    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-lg text-gray-900 dark:text-white">{item.guestName}</span>
          {item.isSample && (
            <span
              className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-semibold border border-amber-300 dark:border-amber-700"
              data-testid="sample-guest-badge"
            >
              Sample
            </span>
          )}
          {item.householdName && (
            <span
              className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200 font-semibold border border-purple-200 dark:border-purple-800"
              data-testid="household-badge"
            >
              🏠 {item.householdName}
            </span>
          )}
          {item.partyGroup && (
            <span
              className="px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 font-semibold border border-indigo-200 dark:border-indigo-800"
              data-testid="party-group-badge"
            >
              👥 {item.partyGroup}
            </span>
          )}
          {attendingPlusOneCount > 0 && (
            <span
              className="px-2 py-0.5 rounded text-xs bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 font-semibold border border-emerald-200 dark:border-emerald-800"
              data-testid="attending-plus-one-badge"
            >
              +{attendingPlusOneCount} Plus-{attendingPlusOneCount === 1 ? 'One' : 'Ones'} Attending
            </span>
          )}
        </div>
        {plusOneNamesDisplay && (
          <div className="text-sm text-gray-600 dark:text-gray-300" data-testid="plus-one-names">
            Plus-One: {plusOneNamesDisplay}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
            Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-600 dark:text-red-400">{item.code}</code>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="text-xs py-0.5 px-2 h-auto"
            onClick={() => onPreviewQr(item)}
            aria-label={`View QR code for ${item.guestName}`}
          >
            View QR
          </Button>
        </div>

        {/* Party Tags Display */}
        {item.partyTags && item.partyTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.partyTags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-[11px] bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-medium"
                data-testid="party-tag-pill"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Mailing Address Display */}
        <div className="text-xs text-gray-600 dark:text-gray-300 pt-1">
          <span className="font-bold">Mailing Address: </span>
          {hasAddress ? (
            <span className="inline-block bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded text-xs">
              {[item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country].filter(Boolean).join(', ')}
            </span>
          ) : item.addressLine1 ? (
            <span className="inline-block bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded text-xs">
              Incomplete: {[item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country].filter(Boolean).join(', ')}
            </span>
          ) : (
            <span className="text-gray-400 dark:text-gray-500 italic">No address provided</span>
          )}
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 pt-1">
          <span>Status: <span className={item.used ? 'text-red-500 font-semibold' : 'text-green-500 font-semibold'}>{item.used ? 'Redeemed/Used' : 'Active/Unused'}</span></span>
          <span>
            RSVP:{' '}
            <span
              className={
                attendanceStatus === 'attending'
                  ? 'text-green-600 font-semibold'
                  : attendanceStatus === 'declined'
                    ? 'text-red-600 font-semibold'
                    : 'text-amber-600 font-semibold'
              }
            >
              {attendanceStatus.charAt(0).toUpperCase() + attendanceStatus.slice(1)}
            </span>
          </span>
        </div>
        {item.dietaryNotes && item.dietaryNotes.trim() && (
          <div className="mt-2 inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700/50 text-xs px-2.5 py-1 rounded-full font-medium" data-testid="dietary-badge">
            <span className="font-semibold">Dietary:</span> {item.dietaryNotes.trim()}
          </div>
        )}

        {eventRsvpPills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2" data-testid="guest-event-rsvp-pills">
            {eventRsvpPills.map((pill) => {
              const pillClasses =
                pill.status === 'attending'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                  : pill.status === 'declined'
                    ? 'bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200 border-red-200 dark:border-red-800'
                    : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800';
              const statusLabel = pill.status.charAt(0).toUpperCase() + pill.status.slice(1);
              return (
                <span
                  key={pill.key}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${pillClasses}`}
                  data-testid="event-rsvp-pill"
                >
                  {pill.title}: {statusLabel}
                  {pill.plusOneCount > 0 ? ` (+${pill.plusOneCount})` : ''}
                </span>
              );
            })}
          </div>
        )}

        {mealSelectionsDisplay && (
          <div
            className="mt-2 text-xs text-indigo-900 dark:text-indigo-200 bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1 rounded-lg"
            data-testid="guest-meal-selections"
          >
            <span className="font-semibold">Meals:</span> {mealSelectionsDisplay}
          </div>
        )}

        {customAnswersDisplay && (
          <div
            className="mt-1.5 text-xs text-sky-900 dark:text-sky-200 bg-sky-50/70 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 px-2.5 py-1 rounded-lg"
            data-testid="guest-custom-answers"
          >
            <span className="font-semibold">Responses:</span> {customAnswersDisplay}
          </div>
        )}

        {/* Private Sub-Event Access Matrix Toggles */}
        <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700/60" data-testid={`sub-event-access-${item.id}`}>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1">
            Private Sub-Event Permissions:
          </span>
          <div className="flex flex-wrap gap-2">
            {subEvents.length === 0 ? (
              <span className="text-xs text-gray-400 italic">No sub-events created yet</span>
            ) : (
              subEvents.map((evt) => {
                const isAllowed = allowedSubEventIds.includes(evt.id);
                return (
                  <label
                    key={evt.id}
                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
                      isAllowed
                        ? 'bg-red-50 dark:bg-red-950/40 text-primary dark:text-red-300 border-red-200 dark:border-red-800'
                        : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAllowed}
                      aria-label={`Toggle access for ${evt.title} on ${item.guestName}`}
                      onChange={(e) => onToggleSubEventAccess(item.id, evt.id, e.target.checked)}
                      className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>
                      {evt.title} {evt.isPrivate ? '(Private)' : '(Public)'}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }
);

interface InvitationCodeRowActionsProps {
  item: InvitationCodeDTO;
  onEdit: (_item: InvitationCodeDTO) => void;
  onDelete: (_id: string, _e: React.MouseEvent<HTMLButtonElement>) => void;
}

const InvitationCodeRowActions = React.memo<InvitationCodeRowActionsProps>(
  function InvitationCodeRowActions({ item, onEdit, onDelete }) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Edit guest ${item.guestName}`}
          onClick={() => onEdit(item)}
        >
          Edit
        </Button>
        <Button
          variant="danger"
          size="sm"
          aria-label={`Delete code for ${item.guestName}`}
          onClick={(e) => onDelete(item.id, e)}
        >
          Delete
        </Button>
      </div>
    );
  }
);

interface InvitationCodeRowProps extends InvitationCodeRowInfoProps, InvitationCodeRowActionsProps {
  isSelected: boolean;
  onToggleSelect: (_id: string) => void;
}

const InvitationCodeRow = React.memo<InvitationCodeRowProps>(function InvitationCodeRow({
  item,
  isSelected,
  subEvents,
  allowedSubEventIds,
  onToggleSelect,
  onPreviewQr,
  onToggleSubEventAccess,
  onEdit,
  onDelete,
}) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div className="flex items-center gap-4 space-y-1">
        <input
          type="checkbox"
          aria-label={`Select invitation code for ${item.guestName}`}
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          className="rounded border-gray-300 text-primary focus:ring-primary h-5 w-5 cursor-pointer"
        />
        <InvitationCodeRowInfo
          item={item}
          subEvents={subEvents}
          allowedSubEventIds={allowedSubEventIds}
          onPreviewQr={onPreviewQr}
          onToggleSubEventAccess={onToggleSubEventAccess}
        />
      </div>
      <InvitationCodeRowActions item={item} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
});

export default function InvitationCodesDashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, addToast } = useToast();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();

  const {
    data: codes = [],
    isLoading,
    error,
    create,
    update,
    remove,
    removeBatch,
    updateBatch,
    batchUpdateTags,
    batchUpdateAttendance,
    mergeDuplicates,
    fetchAll,
  } = useAdminInvitationCodes();

  const { data: rsvpSummary } = useQuery<RsvpSummaryResponse | null>({
    queryKey: RSVP_SUMMARY_QUERY_KEY,
    queryFn: async () => {
      if (typeof fetch !== 'function') return null;
      try {
        const res = await fetch(withBasePath('/api/admin/sub-events/rsvp-summary'));
        if (!res || !res.ok) return null;
        const json = await res.json();
        return (json?.data ?? json ?? null) as RsvpSummaryResponse | null;
      } catch {
        return null;
      }
    },
    staleTime: 15_000,
  });

  const {
    create: createSubEvent,
    update: updateSubEvent,
    remove: removeSubEvent,
  } = useAdminSubEvents({ enabled: false });

  const [isCreating, setIsCreating] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [isCreateFormDirty, setIsCreateFormDirty] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [bulkHouseholdModalOpen, setBulkHouseholdModalOpen] = useState(false);
  const [bulkHouseholdInput, setBulkHouseholdInput] = useState('');
  const [bulkTagModalOpen, setBulkTagModalOpen] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkTagAction, setBulkTagAction] = useState<'add' | 'remove'>('add');
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [primaryMergeId, setPrimaryMergeId] = useState<string>('');
  const [isMerging, setIsMerging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unused'>('all');
  const [addressFilter, setAddressFilter] = useState<'all' | 'complete' | 'missing'>('all');
  const [dietaryFilter, setDietaryFilter] = useState<string>('all');
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'attending' | 'declined' | 'pending'>('all');
  const [partyGroupFilter, setPartyGroupFilter] = useState<string>('all');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [subEvents, setSubEvents] = useState<EditableSubEvent[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<Record<string, string[]>>({});
  const [editingGuest, setEditingGuest] = useState<InvitationCodeDTO | null>(null);
  const [isSubEventModalOpen, setIsSubEventModalOpen] = useState(false);
  const [editingSubEvent, setEditingSubEvent] = useState<EditableSubEvent | null>(null);
  const [deletingSubEvent, setDeletingSubEvent] = useState<EditableSubEvent | null>(null);
  const [bulkSubEventModalOpen, setBulkSubEventModalOpen] = useState(false);
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [broadcastModalFilters, setBroadcastModalFilters] = useState<any>(undefined);
  const [qrPreviewGuest, setQrPreviewGuest] = useState<InvitationQRPreviewGuest | null>(null);
  const [isPrintLabelsModalOpen, setIsPrintLabelsModalOpen] = useState(false);
  const [printLabelsList, setPrintLabelsList] = useState<PrintableInvitationCode[]>([]);
  const [bulkSubEventAction, setBulkSubEventAction] = useState<'grant' | 'revoke' | 'set'>('grant');
  const [bulkSelectedSubEventIds, setBulkSelectedSubEventIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(INVITATION_DEFAULT_PAGE_SIZE);

  const handleBatchSubEventAccess = async () => {
    if (selectedIds.length === 0) return;
    if (bulkSelectedSubEventIds.length === 0) {
      addToast('Please select at least one sub-event.', 'error');
      return;
    }

    try {
      const res = await fetch(withBasePath('/api/admin/sub-events/access/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeIds: selectedIds,
          subEventIds: bulkSelectedSubEventIds,
          action: bulkSubEventAction,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to batch update sub-event access');
      }

      addToast(`Sub-event access batch updated for ${selectedIds.length} codes.`, 'success');
      setBulkSubEventModalOpen(false);
      setBulkSelectedSubEventIds([]);
      fetchSubEventsAndMatrix();
    } catch (e: any) {
      addToast(e.message || 'Failed to batch update sub-event access.', 'error');
    }
  };

  const fetchSubEventsAndMatrix = async () => {
    try {
      const res = await fetch(withBasePath('/api/admin/sub-events/access'));
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        const map: Record<string, Set<string>> = {};

        if (Array.isArray(data.subEvents)) {
          setSubEvents(data.subEvents);
          data.subEvents.forEach(
            (evt: { id: string; allowedInvitationCodeIds?: string[] }) => {
              if (Array.isArray(evt.allowedInvitationCodeIds)) {
                evt.allowedInvitationCodeIds.forEach((invId: string) => {
                  if (!map[invId]) map[invId] = new Set<string>();
                  map[invId].add(evt.id);
                });
              }
            }
          );
        }

        if (Array.isArray(data.invitationCodes)) {
          data.invitationCodes.forEach(
            (c: { id: string; allowedSubEventIds?: string[] }) => {
              if (Array.isArray(c.allowedSubEventIds)) {
                if (!map[c.id]) map[c.id] = new Set<string>();
                c.allowedSubEventIds.forEach((seId: string) => map[c.id].add(seId));
              }
            }
          );
        }

        const resolvedMatrix: Record<string, string[]> = {};
        Object.entries(map).forEach(([invId, set]) => {
          resolvedMatrix[invId] = Array.from(set);
        });
        setAccessMatrix(resolvedMatrix);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchSubEventsAndMatrix();
  }, []);

  const accessMatrixRef = useRef(accessMatrix);
  useEffect(() => {
    accessMatrixRef.current = accessMatrix;
  }, [accessMatrix]);

  const handleToggleSubEventAccess = useCallback(async (invitationCodeId: string, subEventId: string, isAllowed: boolean) => {
    const previousAllowed = accessMatrixRef.current[invitationCodeId] || [];
    const updated = isAllowed
      ? Array.from(new Set([...previousAllowed, subEventId]))
      : previousAllowed.filter((id) => id !== subEventId);

    setAccessMatrix((prev) => ({ ...prev, [invitationCodeId]: updated }));

    try {
      const res = await fetch(withBasePath('/api/admin/sub-events/access/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeIds: [invitationCodeId],
          subEventIds: [subEventId],
          action: isAllowed ? 'grant' : 'revoke',
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update event permissions');
      }
      addToast('Sub-event permissions updated.', 'success');
    } catch (e: unknown) {
      setAccessMatrix((prev) => ({ ...prev, [invitationCodeId]: previousAllowed }));
      addToast(
        e instanceof Error && e.message ? e.message : 'Failed to update sub-event permissions.',
        'error'
      );
      fetchSubEventsAndMatrix();
    }
  }, [addToast]);

  const handleSaveGuest = async (id: string, payload: Partial<InvitationCodeDTO>) => {
    try {
      await update(id, payload);
      addToast('Guest details updated successfully.', 'success');
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message ? e.message : 'Failed to update guest details.',
        'error'
      );
      throw e;
    }
  };

  const handleSaveSubEvent = async (payload: Partial<SubEventDTO>, editingId?: string) => {
    try {
      if (editingId) {
        const updated = await updateSubEvent(editingId, payload);
        setSubEvents((prev) =>
          prev.map((evt) => (evt.id === editingId ? { ...evt, ...payload, ...(updated || {}) } : evt))
        );
        setEditingSubEvent(null);
        addToast('Sub-event updated successfully.', 'success');
      } else {
        const created = await createSubEvent(payload);
        if (created && created.id) {
          setSubEvents((prev) => [...prev, created as EditableSubEvent]);
        }
        addToast('Sub-event created successfully.', 'success');
      }
      fetchSubEventsAndMatrix();
      void queryClient.invalidateQueries({ queryKey: RSVP_SUMMARY_QUERY_KEY });
      void fetchAll?.();
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message
          ? e.message
          : editingId
            ? 'Failed to update sub-event.'
            : 'Failed to create sub-event.',
        'error'
      );
      throw e;
    }
  };

  const handleConfirmDeleteSubEvent = async (target: EditableSubEvent) => {
    try {
      await removeSubEvent(target.id);
      setSubEvents((prev) => prev.filter((evt) => evt.id !== target.id));
      setAccessMatrix((prev) => {
        const next: Record<string, string[]> = {};
        Object.entries(prev).forEach(([invId, ids]) => {
          next[invId] = ids.filter((id) => id !== target.id);
        });
        return next;
      });
      if (editingSubEvent?.id === target.id) {
        setEditingSubEvent(null);
      }
      addToast('Sub-event deleted successfully.', 'success');
      fetchSubEventsAndMatrix();
      void queryClient.invalidateQueries({ queryKey: RSVP_SUMMARY_QUERY_KEY });
      void fetchAll?.();
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message ? e.message : 'Failed to delete sub-event.',
        'error'
      );
      throw e;
    }
  };

  const selectAllRef = useRef<HTMLInputElement>(null);

  const allUniqueTags = useMemo(() => {
    const set = new Set<string>();
    codes.forEach((c) => {
      (c.partyTags || []).forEach((t) => {
        if (t.trim()) set.add(t.trim());
      });
    });
    return Array.from(set).sort();
  }, [codes]);

  const allUniquePartyGroups = useMemo(() => {
    const set = new Set<string>();
    codes.forEach((c) => {
      if (c.partyGroup?.trim()) set.add(c.partyGroup.trim());
    });
    return Array.from(set).sort();
  }, [codes]);

  const counts = useMemo(() => {
    const complete = codes.filter((c) => isAddressComplete(c)).length;
    return {
      all: codes.length,
      redeemed: codes.filter((c) => c.used).length,
      unused: codes.filter((c) => !c.used).length,
      addressComplete: complete,
      addressMissing: codes.length - complete,
    };
  }, [codes]);

  const attendanceCounts = useMemo(() => {
    const nonSampleCodes = codes.filter((c) => !c.isSample);
    let attending = 0;
    let declined = 0;
    let pending = 0;
    let attendingPlusOnes = 0;

    for (const c of nonSampleCodes) {
      const status = getAttendanceStatus(c);
      if (status === 'attending') {
        attending++;
        attendingPlusOnes += getGuestAttendingPlusOneCount(c);
      } else if (status === 'declined') {
        declined++;
      } else {
        pending++;
      }
    }

    const useServerGlobal =
      Boolean(rsvpSummary?.global) &&
      rsvpSummary!.global.totalInvitations === nonSampleCodes.length;

    return {
      all: nonSampleCodes.length,
      attending,
      declined,
      pending,
      attendingHeadcount: useServerGlobal
        ? rsvpSummary!.global.attendingHeadcount
        : attending + attendingPlusOnes,
      attendingPlusOnes: useServerGlobal
        ? rsvpSummary!.global.attendingPlusOnes
        : attendingPlusOnes,
    };
  }, [codes, rsvpSummary]);

  const cateringSummary = useMemo(() => {
    const nonSampleCodes = codes.filter((c) => !c.isSample);
    let totalWithRestrictions = 0;
    let glutenFree = 0;
    let vegetarian = 0;
    let vegan = 0;
    let dairyFree = 0;
    let nutFree = 0;
    let kids = 0;
    let other = 0;
    const clientMealMap = new Map<string, { optionId: string; label: string; count: number }>();

    for (const item of nonSampleCodes) {
      const attendanceStatus = getAttendanceStatus(item);
      if (attendanceStatus === 'declined') continue;

      const hasNotes = Boolean(item.dietaryNotes && item.dietaryNotes.trim());
      const notes = hasNotes ? item.dietaryNotes!.trim() : '';
      const allTags = extractDietaryTags(item.extraFields);
      const restrictionTags = allTags.filter((t) => t !== 'kids');

      let itemStructuredKidsPlates = 0;
      const extra =
        item.extraFields && typeof item.extraFields === 'object' && !Array.isArray(item.extraFields)
          ? (item.extraFields as Record<string, unknown>)
          : null;
      if (attendanceStatus === 'attending' && extra && Array.isArray(extra.mealSelections)) {
        for (const entry of extra.mealSelections) {
          if (!entry || typeof entry !== 'object') continue;
          const entryObj = entry as Record<string, unknown>;
          const selections = Array.isArray(entryObj.selections)
            ? entryObj.selections
            : typeof entryObj.label === 'string'
              ? [entryObj]
              : [];
          for (const sel of selections) {
            if (!sel || typeof sel !== 'object') continue;
            const s = sel as Record<string, unknown>;
            const label = typeof s.label === 'string' ? s.label.trim() : '';
            const optionId = typeof s.optionId === 'string' && s.optionId.trim() ? s.optionId.trim() : label;
            const selTags = Array.isArray(s.dietaryTags)
              ? s.dietaryTags
                .filter((t): t is string => typeof t === 'string')
                .map((t) => t.trim().toLowerCase())
              : [];
            if (selTags.includes('kids')) {
              itemStructuredKidsPlates += 1;
            }
            if (!label) continue;
            const existing = clientMealMap.get(label);
            if (existing) {
              existing.count += 1;
            } else {
              clientMealMap.set(label, { optionId, label, count: 1 });
            }
          }
        }
      }

      const hasKidsPartyTag = Boolean(
        item.partyTags?.some((t) => /^(kid|kids|child|children|kids[- ]meal)$/i.test(t.trim()))
      );
      if (itemStructuredKidsPlates > 0) {
        kids += itemStructuredKidsPlates;
      } else if (matchDietaryCategory(notes, 'kids', allTags) || hasKidsPartyTag) {
        kids += 1;
      }

      if (!hasNotes && restrictionTags.length === 0) continue;
      totalWithRestrictions++;

      const gf = matchDietaryCategory(notes, 'gluten-free', restrictionTags);
      const veg = matchDietaryCategory(notes, 'vegetarian', restrictionTags);
      const vgn = matchDietaryCategory(notes, 'vegan', restrictionTags);
      const df = matchDietaryCategory(notes, 'dairy-free', restrictionTags);
      const nut = matchDietaryCategory(notes, 'nut-free', restrictionTags);
      const oth = matchDietaryCategory(notes, 'other', restrictionTags);

      if (gf) glutenFree++;
      if (veg) vegetarian++;
      if (vgn) vegan++;
      if (df) dairyFree++;
      if (nut) nutFree++;
      if (oth) other++;
    }

    const useServerSummary =
      Boolean(rsvpSummary?.global) &&
      rsvpSummary!.global.totalInvitations === nonSampleCodes.length;

    const mealTotals =
      useServerSummary && Array.isArray(rsvpSummary!.global.mealTotals)
        ? rsvpSummary!.global.mealTotals
        : Array.from(clientMealMap.values());

    return {
      totalWithRestrictions: useServerSummary
        ? rsvpSummary!.global.dietary.totalWithRestrictions
        : totalWithRestrictions,
      glutenFree: useServerSummary ? rsvpSummary!.global.dietary.glutenFree : glutenFree,
      vegetarian: useServerSummary ? rsvpSummary!.global.dietary.vegetarian : vegetarian,
      vegan: useServerSummary ? rsvpSummary!.global.dietary.vegan : vegan,
      dairyFree: useServerSummary ? rsvpSummary!.global.dietary.dairyFree : dairyFree,
      nutFree: useServerSummary ? rsvpSummary!.global.dietary.nutFree : nutFree,
      kids: useServerSummary ? rsvpSummary!.global.dietary.kids : kids,
      other: useServerSummary ? rsvpSummary!.global.dietary.other : other,
      mealTotals,
    };
  }, [codes, rsvpSummary]);

  const filteredCodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return codes.filter((item) => {
      if (statusFilter === 'redeemed' && !item.used) return false;
      if (statusFilter === 'unused' && item.used) return false;

      const hasAddress = isAddressComplete(item);
      if (addressFilter === 'complete' && !hasAddress) return false;
      if (addressFilter === 'missing' && hasAddress) return false;

      if (attendanceFilter !== 'all') {
        const attendanceStatus = getAttendanceStatus(item);
        if (attendanceFilter !== attendanceStatus) return false;
      }

      if (dietaryFilter !== 'all') {
        if (!matchDietaryCategory(item.dietaryNotes, dietaryFilter, item.extraFields)) {
          return false;
        }
      }

      if (partyGroupFilter !== 'all') {
        if ((item.partyGroup || '') !== partyGroupFilter) return false;
      }

      if (selectedTagFilter) {
        if (!item.partyTags || !item.partyTags.includes(selectedTagFilter)) return false;
      }

      if (!query) return true;

      const matchesName = item.guestName ? item.guestName.toLowerCase().includes(query) : false;
      const matchesCode = item.code ? item.code.toLowerCase().includes(query) : false;
      const matchesEmail = item.email ? item.email.toLowerCase().includes(query) : false;
      const matchesPlusOneFirstName = item.plusOneFirstName ? item.plusOneFirstName.toLowerCase().includes(query) : false;
      const matchesPlusOneLastName = item.plusOneLastName ? item.plusOneLastName.toLowerCase().includes(query) : false;
      const matchesPlusOneNames = formatGuestPlusOneNames(item).toLowerCase().includes(query);
      const matchesMeals = formatGuestMealSelections(item).toLowerCase().includes(query);
      const matchesCustomAnswers = formatGuestCustomAnswers(item).toLowerCase().includes(query);
      const matchesAddress = [item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode, item.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
      const matchesDietary = item.dietaryNotes ? item.dietaryNotes.toLowerCase().includes(query) : false;
      const matchesHousehold = item.householdName ? item.householdName.toLowerCase().includes(query) : false;
      const matchesPartyGroup = item.partyGroup ? item.partyGroup.toLowerCase().includes(query) : false;
      const matchesTags = item.partyTags ? item.partyTags.some((t) => t.toLowerCase().includes(query)) : false;

      return (
        matchesName ||
        matchesCode ||
        matchesEmail ||
        matchesPlusOneFirstName ||
        matchesPlusOneLastName ||
        matchesPlusOneNames ||
        matchesMeals ||
        matchesCustomAnswers ||
        matchesAddress ||
        matchesDietary ||
        matchesHousehold ||
        matchesPartyGroup ||
        matchesTags
      );
    });
  }, [codes, searchQuery, statusFilter, addressFilter, attendanceFilter, dietaryFilter, partyGroupFilter, selectedTagFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCodes.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedCodes = useMemo(() => {
    const startIdx = (safeCurrentPage - 1) * pageSize;
    return filteredCodes.slice(startIdx, startIdx + pageSize);
  }, [filteredCodes, safeCurrentPage, pageSize]);

  const allFilteredSelected = useMemo(() => {
    if (filteredCodes.length === 0) return false;
    return filteredCodes.every((item) => selectedIdsSet.has(item.id));
  }, [filteredCodes, selectedIdsSet]);

  const isIndeterminate = useMemo(() => {
    const selectedFilteredCount = filteredCodes.filter((item) => selectedIdsSet.has(item.id)).length;
    return selectedFilteredCount > 0 && !allFilteredSelected;
  }, [filteredCodes, selectedIdsSet, allFilteredSelected]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredIdSet = new Set(filteredCodes.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
    } else {
      const filteredIds = filteredCodes.map((c) => c.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const handleToggleSelectRow = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleBatchMarkRedeemed = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { used: true });
      addToast(`Marked ${selectedIds.length} invitation code(s) as redeemed.`, 'success');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update invitation codes.', 'error');
    }
  };

  const handleBatchMarkUnused = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { used: false });
      addToast(`Marked ${selectedIds.length} invitation code(s) as unused.`, 'success');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update invitation codes.', 'error');
    }
  };

  const handleBatchAttendance = async (status: 'attending' | 'declined' | 'clear') => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    try {
      if (typeof batchUpdateAttendance === 'function') {
        await batchUpdateAttendance(selectedIds, status);
      } else {
        const res = await fetch(withBasePath('/api/admin/invitation-codes/rsvps'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitationCodeIds: selectedIds,
            status,
          }),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || 'Failed to update RSVP attendance.');
        }
        await fetchAll?.();
      }
      void queryClient.invalidateQueries({ queryKey: RSVP_SUMMARY_QUERY_KEY });
      const msg =
        status === 'clear'
          ? `Cleared RSVPs for ${count} guest(s).`
          : `Marked ${count} guest(s) as ${status}.`;
      addToast(msg, 'success');
      setSelectedIds([]);
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message ? e.message : 'Failed to update RSVP attendance.',
        'error'
      );
    }
  };

  const handleExportSelectedCsv = () => {
    if (selectedIds.length === 0) {
      addToast('No invitation codes selected for export.', 'info');
      return;
    }

    const params = new URLSearchParams();
    params.set('ids', selectedIds.join(','));

    const link = document.createElement('a');
    link.href = withBasePath(`/api/admin/invitation-codes/export?${params.toString()}`);
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast(`Exported ${selectedIds.length} selected invitation code(s) to CSV.`, 'success');
  };

  const handlePrintSelectedLabels = () => {
    if (selectedIds.length === 0) {
      addToast('No invitation codes selected for printing.', 'info');
      return;
    }
    const targetCodes = codes.filter((c) => selectedIdsSet.has(c.id));
    setPrintLabelsList(targetCodes);
    setIsPrintLabelsModalOpen(true);
  };

  const handlePrintGlobalLabels = () => {
    const targetCodes = selectedIds.length > 0
      ? codes.filter((c) => selectedIdsSet.has(c.id))
      : filteredCodes.length > 0
        ? filteredCodes
        : codes;
    if (targetCodes.length === 0) {
      addToast('No invitation codes available to print.', 'info');
      return;
    }
    setPrintLabelsList(targetCodes);
    setIsPrintLabelsModalOpen(true);
  };

  const handleConfirmBatchDelete = async () => {
    const count = selectedIds.length;
    try {
      await removeBatch(selectedIds);
      addToast(`Successfully deleted ${count} invitation code(s).`, 'success');
      setSelectedIds([]);
      setIsBatchDeleteModalOpen(false);
    } catch (e: any) {
      addToast(e.message || 'Failed to delete selected invitation codes.', 'error');
    }
  };

  const handleBulkSetHousehold = async () => {
    if (selectedIds.length === 0) return;
    try {
      await updateBatch(selectedIds, { householdName: bulkHouseholdInput.trim() || null } as any);
      addToast(`Updated household name for ${selectedIds.length} code(s).`, 'success');
      setBulkHouseholdModalOpen(false);
      setBulkHouseholdInput('');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update household name.', 'error');
    }
  };

  const handleBulkUpdateTags = async () => {
    if (selectedIds.length === 0 || !bulkTagInput.trim()) return;
    const tagToProcess = bulkTagInput.trim();
    try {
      await batchUpdateTags(selectedIds, [tagToProcess], bulkTagAction);
      addToast(`Updated tags for ${selectedIds.length} code(s).`, 'success');
      setBulkTagModalOpen(false);
      setBulkTagInput('');
      setSelectedIds([]);
    } catch (e: any) {
      addToast(e.message || 'Failed to update tags.', 'error');
    }
  };

  const selectedGuests = useMemo(
    () => codes.filter((c) => selectedIdsSet.has(c.id)),
    [codes, selectedIdsSet]
  );

  const resolvedPrimaryMergeId = useMemo(() => {
    if (selectedGuests.some((g) => g.id === primaryMergeId)) {
      return primaryMergeId;
    }
    return selectedGuests[0]?.id ?? '';
  }, [selectedGuests, primaryMergeId]);

  const mergePreview = useMemo(() => {
    if (selectedGuests.length < 2 || !resolvedPrimaryMergeId) return null;
    const primary = selectedGuests.find((g) => g.id === resolvedPrimaryMergeId);
    if (!primary) return null;
    const secondaries = selectedGuests.filter((g) => g.id !== resolvedPrimaryMergeId);
    return computeMergedInvitationPreview(primary, secondaries);
  }, [selectedGuests, resolvedPrimaryMergeId]);

  const handleConfirmMerge = async () => {
    if (!resolvedPrimaryMergeId || selectedGuests.length < 2) return;
    const secondaryIds = selectedGuests
      .map((g) => g.id)
      .filter((id) => id !== resolvedPrimaryMergeId);
    if (secondaryIds.length === 0) return;

    setIsMerging(true);
    try {
      const result = await mergeDuplicates(resolvedPrimaryMergeId, secondaryIds);
      const mergedName = result?.record?.guestName || mergePreview?.guestName || 'primary guest';
      addToast(
        `Merged ${secondaryIds.length + 1} guest records into ${mergedName}.`,
        'success'
      );
      setIsMergeModalOpen(false);
      setPrimaryMergeId('');
      setSelectedIds([]);
      fetchSubEventsAndMatrix();
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message
          ? e.message
          : 'Failed to merge duplicate guest records.',
        'error'
      );
    } finally {
      setIsMerging(false);
    }
  };

  const openFreshCreateForm = useCallback(() => {
    setCreateFormKey((prev) => prev + 1);
    setIsCreateFormDirty(false);
    setIsCreating(true);
  }, []);

  const handleOpenCreateForm = useDirtyConfirmClose(
    isCreating && isCreateFormDirty,
    openFreshCreateForm
  );

  const handleCreateGuest = async (payload: Partial<InvitationCodeDTO>) => {
    try {
      await create(payload);
      addToast('Invitation code created successfully.', 'success');
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message ? e.message : 'Failed to create invitation code.',
        'error'
      );
      throw e;
    }
  };

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white, .dark\\:bg-gray-800');
    const isConfirmed = await confirm('Are you sure you want to delete this invitation code?');
    if (!isConfirmed) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
      addToast('Invitation code deleted successfully.', 'success');
    } catch {
      addToast('Failed to delete invitation code.', 'error');
    }
  }, [confirm, captureFocusTarget, remove, addToast]);

  const existingCodes = useMemo(
    () =>
      codes
        .map((item) => item.code)
        .filter((c): c is string => typeof c === 'string' && Boolean(c.trim())),
    [codes]
  );

  const nonAddressCollectionFilteredCount = useMemo(
    () =>
      filteredCodes.filter(
        (c) =>
          !Array.isArray(c.partyTags) ||
          !c.partyTags.some(
            (t) => typeof t === 'string' && t.trim().toLowerCase() === 'address-collection'
          )
      ).length,
    [filteredCodes]
  );

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
    if (partyGroupFilter && partyGroupFilter !== 'all') params.set('partyGroup', partyGroupFilter);
    if (selectedTagFilter) params.set('partyTags', selectedTagFilter);
    if (dietaryFilter && dietaryFilter !== 'all') params.set('dietary', dietaryFilter);
    if (attendanceFilter && attendanceFilter !== 'all') params.set('attendance', attendanceFilter);
    if (addressFilter && addressFilter !== 'all') params.set('address', addressFilter);

    const queryString = params.toString();
    const exportUrl = `/api/admin/invitation-codes/export${queryString ? `?${queryString}` : ''}`;

    const link = document.createElement('a');
    link.href = withBasePath(exportUrl);
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('Invitation codes exported successfully.', 'success');
  };

  const handleCopyShareableLink = () => {
    const url = `${window.location.origin}${withBasePath('/guest/collect')}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
    addToast('Shareable address collection link copied to clipboard!', 'success');
  };

  return (
    <AdminViewState
      isLoading={isLoading}
      error={error}
      onRetry={fetchAll}
      loadingMessage="Loading..."
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto relative pb-28">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Pre-Authorized Guest Invitation Codes</h1>
          <div className="flex gap-4 flex-wrap">
            <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
            <Button variant="secondary" onClick={handleCopyShareableLink}>Copy Address Link</Button>
            <Button variant="secondary" onClick={() => {
              setEditingSubEvent(null);
              setIsSubEventModalOpen(true);
            }}>Manage Sub-Events</Button>
            <Button variant="secondary" onClick={() => setIsImporting(true)}>Import CSV</Button>
            <Button variant="secondary" onClick={handleExportCsv}>Export CSV</Button>
            <Button variant="secondary" onClick={handlePrintGlobalLabels}>Print QR Labels</Button>
            <Button variant="secondary" onClick={() => {
              const nextFilters: Record<string, any> = {};
              if (searchQuery.trim()) nextFilters.searchQuery = searchQuery.trim();
              if (statusFilter !== 'all') nextFilters.status = statusFilter;
              if (addressFilter !== 'all') nextFilters.addressStatus = addressFilter;
              if (attendanceFilter !== 'all') nextFilters.attendanceStatus = attendanceFilter;
              if (dietaryFilter !== 'all') nextFilters.dietaryCategory = dietaryFilter;
              if (partyGroupFilter !== 'all') nextFilters.partyGroup = partyGroupFilter;
              if (selectedTagFilter) nextFilters.partyTags = [selectedTagFilter];

              setBroadcastModalFilters(
                Object.keys(nextFilters).length > 0 ? nextFilters : undefined
              );
              setIsBroadcastModalOpen(true);
            }}>Send Broadcast</Button>
            <Link
              href="/admin/dashboard/history?tab=broadcasts"
              prefetch={false}
              className="inline-flex items-center justify-center h-10 py-2 px-4 text-sm font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 bg-[var(--btn-secondary-bg,var(--color-secondary,#B45309))] text-[var(--btn-secondary-text,#ffffff)] hover:bg-[var(--btn-secondary-hover-bg,var(--color-secondary,#B45309))] border border-[var(--btn-secondary-border,transparent)]"
            >
              Broadcast Delivery Logs
            </Link>
            <Button onClick={handleOpenCreateForm}>Generate New Code</Button>
          </div>
        </div>

        <CsvImportWizardModal
          isOpen={isImporting}
          onClose={() => setIsImporting(false)}
          onImportComplete={() => fetchAll()}
          existingCodes={existingCodes}
        />

        {isCreating && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow border border-primary mb-8 max-w-2xl">
            <h2 className="text-xl font-bold mb-4 text-primary">Generate Invitation Code</h2>
            <GuestEditorForm
              key={createFormKey}
              mode="create"
              actionsAlign="start"
              onCreate={handleCreateGuest}
              onClose={() => {
                setIsCreating(false);
                setIsCreateFormDirty(false);
              }}
              onDirtyChange={setIsCreateFormDirty}
            />
          </div>
        )}

        {/* Catering & Dietary Summary Widget */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl shadow border border-gray-200 dark:border-gray-700 mb-8" data-testid="catering-summary-widget">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-gray-100 dark:border-gray-700/60 pb-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span>🍽️</span> Catering & Dietary Summary
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Overview of attending & pending guest headcounts, meal selections, and dietary restrictions (declined excluded)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <div
                className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800/60"
                data-testid="rsvp-headcount-summary"
              >
                Attending: {attendanceCounts.attendingHeadcount}{' '}
                {attendanceCounts.attendingHeadcount === 1 ? 'Guest' : 'Guests'} ({attendanceCounts.attending}{' '}
                {attendanceCounts.attending === 1 ? 'Household' : 'Households'}
                {attendanceCounts.attendingPlusOnes > 0 ? `, +${attendanceCounts.attendingPlusOnes} Plus-Ones` : ''})
              </div>
              <div className="text-sm font-semibold text-primary dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-1 rounded-full border border-red-200 dark:border-red-800/40">
                {cateringSummary.totalWithRestrictions} {cateringSummary.totalWithRestrictions === 1 ? 'Guest' : 'Guests'} with Dietary Notes
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 text-center">
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Gluten-Free</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.glutenFree}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Vegetarian</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.vegetarian}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Vegan</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.vegan}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Dairy-Free</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.dairyFree}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Nut / Allergy</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.nutFree}</div>
            </div>
            <div
              className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700"
              data-testid="catering-kids-tile"
            >
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Kids</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.kids}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Other</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.other}</div>
            </div>
          </div>

          {cateringSummary.mealTotals.length > 0 && (
            <div
              className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60"
              data-testid="catering-meal-totals"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">
                Entrée & Meal Counts
              </div>
              <div className="flex flex-wrap gap-2">
                {cateringSummary.mealTotals.map((meal) => (
                  <span
                    key={`${meal.optionId}-${meal.label}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800"
                    data-testid="catering-meal-pill"
                  >
                    <span>{meal.label}:</span>
                    <span>{meal.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {rsvpSummary?.global?.questionBreakdowns &&
            rsvpSummary.global.questionBreakdowns.length > 0 && (
            <div
              className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60"
              data-testid="catering-question-totals"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">
                Custom RSVP Question Breakdown
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {rsvpSummary.global.questionBreakdowns.map((q) => (
                  <div
                    key={`${q.subEventId}-${q.questionId}`}
                    className="bg-gray-50 dark:bg-gray-700/40 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700"
                  >
                    <div className="font-semibold text-gray-800 dark:text-gray-100">
                      {q.subEventTitle}: {q.prompt}
                    </div>
                    <div className="text-gray-600 dark:text-gray-300 mt-1 flex flex-wrap gap-1.5">
                      {q.type === 'choice'
                        ? q.optionCounts.map(({ option, count }) => (
                          <span
                            key={option}
                            className="px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 border border-sky-200 dark:border-sky-800"
                          >
                            {option}: {count}
                          </span>
                        ))
                        : (
                          <span>{q.totalResponses} text {q.totalResponses === 1 ? 'response' : 'responses'}</span>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
            <FormGroup className="relative flex-1 max-w-md space-y-0">
              <Input
                type="text"
                placeholder="Search by name, code, companion, meal, response, household, tag..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                aria-label="Search invitation codes"
                className="w-full"
              />
            </FormGroup>

            <div className="flex flex-wrap gap-3 items-center">
              <FormGroup className="w-full sm:w-auto space-y-0">
                <Select
                  id="party-group-filter"
                  aria-label="Filter by party side or group"
                  value={partyGroupFilter}
                  onChange={(e) => {
                    setPartyGroupFilter(e.target.value);
                    setSelectedIds([]);
                    setCurrentPage(1);
                  }}
                  className="w-full sm:w-auto"
                >
                  <option value="all">All Party Groups</option>
                  <option value="Bride">Bride</option>
                  <option value="Groom">Groom</option>
                  <option value="Joint">Joint</option>
                  {allUniquePartyGroups
                    .filter((g) => !['Bride', 'Groom', 'Joint'].includes(g))
                    .map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                </Select>
              </FormGroup>

              <FormGroup className="w-full sm:w-auto space-y-0">
                <Select
                  id="dietary-filter"
                  aria-label="Filter by dietary category"
                  value={dietaryFilter}
                  onChange={(e) => {
                    setDietaryFilter(e.target.value);
                    setSelectedIds([]);
                    setCurrentPage(1);
                  }}
                  className="w-full sm:w-auto"
                >
                  <option value="all">All Dietary Categories</option>
                  <option value="has_restriction">Has Dietary Restriction</option>
                  <option value="gluten-free">Gluten-Free</option>
                  <option value="vegetarian">Vegetarian</option>
                  <option value="vegan">Vegan</option>
                  <option value="dairy-free">Dairy-Free</option>
                  <option value="nut-free">Nut-Free / Allergy</option>
                  <option value="kids">Kids Meal</option>
                  <option value="other">Other Dietary Restrictions</option>
                </Select>
              </FormGroup>
            </div>
          </div>

          {/* Interactive Tag Filter Pills Bar */}
          {allUniqueTags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
              <span
                id="party-tags-filter-label"
                className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
              >
                Party Tags:
              </span>
              <ToggleButtonGroup
                mode="group"
                aria-labelledby="party-tags-filter-label"
                value={selectedTagFilter ?? '__all__'}
                onChange={(val) => {
                  setSelectedTagFilter(val === '__all__' || selectedTagFilter === val ? null : val);
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                className="bg-transparent dark:bg-transparent p-0 border-0 rounded-none gap-2"
                options={[
                  {
                    value: '__all__',
                    label: 'All Tags',
                    className: 'px-2.5 py-1 text-xs rounded-full',
                    activeClassName:
                      'bg-primary text-white font-bold border border-primary ring-2 ring-offset-1 ring-primary/40',
                    inactiveClassName:
                      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-transparent hover:bg-gray-200',
                  },
                  ...allUniqueTags.map((tag) => ({
                    value: tag,
                    label: `#${tag}`,
                    className: 'px-2.5 py-1 text-xs rounded-full font-medium',
                    activeClassName:
                      'bg-blue-600 text-white font-bold border border-blue-800 ring-2 ring-blue-300',
                    inactiveClassName:
                      'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800 hover:bg-blue-100',
                  })),
                ]}
              />
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl border border-gray-200 dark:border-gray-700">
            {/* Redemption Status Tab Group */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Redemption:</span>
              <SegmentedTabs
                idPrefix="redemption-status"
                panelId="invitation-codes-results-panel"
                aria-label="Filter invitation codes by status"
                size="sm"
                value={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                tabs={[
                  { value: 'all', label: `All (${counts.all})` },
                  { value: 'redeemed', label: `Redeemed (${counts.redeemed})` },
                  { value: 'unused', label: `Unused (${counts.unused})` },
                ]}
              />
            </div>

            {/* Address Completion Filter */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <span
                id="address-filter-label"
                className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
              >
                Address:
              </span>
              <ToggleButtonGroup
                mode="group"
                aria-labelledby="address-filter-label"
                value={addressFilter}
                onChange={(val) => {
                  setAddressFilter(val);
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                options={[
                  { value: 'all', label: 'All Addresses' },
                  { value: 'complete', label: `Address Complete (${counts.addressComplete})` },
                  { value: 'missing', label: `Address Missing (${counts.addressMissing})` },
                ]}
              />
            </div>

            {/* RSVP Attendance Status Tab Group */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <span
                id="attendance-filter-label"
                className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
              >
                Attendance:
              </span>
              <ToggleButtonGroup
                mode="group"
                aria-labelledby="attendance-filter-label"
                value={attendanceFilter}
                onChange={(val) => {
                  setAttendanceFilter(val);
                  setSelectedIds([]);
                  setCurrentPage(1);
                }}
                options={[
                  {
                    value: 'all',
                    label: `All (${attendanceCounts.all})`,
                    'aria-label': `All attendance (${attendanceCounts.all})`,
                  },
                  { value: 'attending', label: `Attending (${attendanceCounts.attending})` },
                  { value: 'declined', label: `Declined (${attendanceCounts.declined})` },
                  { value: 'pending', label: `Pending (${attendanceCounts.pending})` },
                ]}
              />
            </div>
          </div>
        </div>

        <SegmentedTabPanel
          id="invitation-codes-results-panel"
          tabId={`redemption-status-tab-${statusFilter}`}
        >
          {filteredCodes.length > 0 && (
            <div className="flex items-center gap-3 mb-4 bg-gray-50 dark:bg-gray-800/60 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
              <input
                ref={selectAllRef}
                type="checkbox"
                id="select-all-filtered"
                checked={allFilteredSelected}
                onChange={handleToggleSelectAll}
                aria-label="Select all filtered invitation codes"
                className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
              />
              <label htmlFor="select-all-filtered" className="text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer">
                Select All Filtered ({filteredCodes.length})
              </label>
            </div>
          )}

          <div className="grid gap-4 pb-6" ref={containerRef}>
            {paginatedCodes.map((item) => (
              <InvitationCodeRow
                key={item.id}
                item={item}
                isSelected={selectedIdsSet.has(item.id)}
                subEvents={subEvents}
                allowedSubEventIds={accessMatrix[item.id] ?? EMPTY_SUB_EVENT_IDS}
                onToggleSelect={handleToggleSelectRow}
                onPreviewQr={setQrPreviewGuest}
                onToggleSubEventAccess={handleToggleSubEventAccess}
                onEdit={setEditingGuest}
                onDelete={handleDelete}
              />
            ))}
            {codes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No invitation codes found.</p>}
            {codes.length > 0 && filteredCodes.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No invitation codes match your search or filter criteria.</p>
            )}
          </div>

          {filteredCodes.length > 0 && (
            <nav
              aria-label="Guest invitation pagination"
              data-testid="invitation-pagination-controls"
              className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 mb-6"
            >
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                <span data-testid="invitation-pagination-range">
                  Showing {(safeCurrentPage - 1) * pageSize + 1}–
                  {Math.min(safeCurrentPage * pageSize, filteredCodes.length)} of {filteredCodes.length}
                </span>
                <div className="inline-flex items-center gap-2">
                  <label htmlFor="invitation-page-size" className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Rows per page:
                  </label>
                  <FormGroup className="space-y-0">
                    <Select
                      id="invitation-page-size"
                      aria-label="Rows per page"
                      value={String(pageSize)}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="w-24 py-1 text-xs"
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="250">250</option>
                    </Select>
                  </FormGroup>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="First page"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                >
                  First
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Previous page"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <span
                  className="text-xs font-semibold px-2 text-gray-700 dark:text-gray-200"
                  data-testid="invitation-pagination-page-indicator"
                >
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Next page"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Next
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Last page"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                >
                  Last
                </Button>
              </div>
            </nav>
          )}
        </SegmentedTabPanel>

        {selectedIds.length > 0 && (
          <div
            role="region"
            aria-label="Batch actions toolbar"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-3xl bg-gray-900 text-white dark:bg-gray-800 dark:text-white p-4 rounded-2xl shadow-2xl border border-gray-700 flex flex-wrap items-center justify-between gap-3 text-sm animate-fade-in"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold px-2.5 py-1 bg-primary text-white rounded-lg text-xs tracking-wide uppercase">
                {selectedIds.length} Selected
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => {
                setBroadcastModalFilters({ selectedIds });
                setIsBroadcastModalOpen(true);
              }}>
                Send Broadcast ({selectedIds.length})
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBulkHouseholdModalOpen(true)}>
                Set Household
              </Button>
              {selectedIds.length >= 2 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPrimaryMergeId(selectedIds[0] || '');
                    setIsMergeModalOpen(true);
                  }}
                >
                  Merge Duplicates
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setBulkTagModalOpen(true)}>
                Manage Tags
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setBulkSubEventModalOpen(true)}>
                Sub-Event Access
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void handleBatchAttendance('attending')}>
                Mark Attending
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void handleBatchAttendance('declined')}>
                Mark Declined
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void handleBatchAttendance('clear')}>
                Clear RSVPs
              </Button>
              <Button size="sm" variant="secondary" onClick={handleBatchMarkRedeemed}>
                Mark as Redeemed
              </Button>
              <Button size="sm" variant="secondary" onClick={handleBatchMarkUnused}>
                Mark as Unused
              </Button>
              <Button size="sm" variant="secondary" onClick={handlePrintSelectedLabels}>
                Print QR Labels
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExportSelectedCsv}>
                Export Selected CSV
              </Button>
              <Button size="sm" variant="danger" onClick={() => setIsBatchDeleteModalOpen(true)}>
                Delete Selected
              </Button>
              <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white" onClick={() => setSelectedIds([])}>
                Deselect All
              </Button>
            </div>
          </div>
        )}

        <Dialog
          isOpen={bulkHouseholdModalOpen}
          onClose={() => setBulkHouseholdModalOpen(false)}
          title={`Set Household Name (${selectedIds.length} Selected)`}
          className="max-w-md w-full"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleBulkSetHousehold();
            }}
            className="space-y-4"
          >
            <FormGroup>
              <Label>Household Name</Label>
              <Input
                type="text"
                placeholder="e.g. Smith Household"
                value={bulkHouseholdInput}
                onChange={(e) => setBulkHouseholdInput(e.target.value)}
              />
            </FormGroup>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBulkHouseholdModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Apply Household Name
              </Button>
            </div>
          </form>
        </Dialog>

        <Dialog
          isOpen={bulkTagModalOpen}
          onClose={() => setBulkTagModalOpen(false)}
          title={`Manage Party Tags (${selectedIds.length} Selected)`}
          className="max-w-md w-full"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleBulkUpdateTags();
            }}
            className="space-y-4"
          >
            <div className="flex gap-4" role="radiogroup" aria-label="Party tag action">
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="tagAction"
                  checked={bulkTagAction === 'add'}
                  onChange={() => setBulkTagAction('add')}
                />
                <span>Add Tag</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="tagAction"
                  checked={bulkTagAction === 'remove'}
                  onChange={() => setBulkTagAction('remove')}
                />
                <span>Remove Tag</span>
              </label>
            </div>
            <FormGroup>
              <Label>Tag Name</Label>
              <Input
                type="text"
                placeholder="e.g. VIP"
                value={bulkTagInput}
                onChange={(e) => setBulkTagInput(e.target.value)}
              />
            </FormGroup>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBulkTagModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Apply Tag Changes
              </Button>
            </div>
          </form>
        </Dialog>

        <Dialog
          isOpen={bulkSubEventModalOpen}
          onClose={() => setBulkSubEventModalOpen(false)}
          title={`Batch Sub-Event Access (${selectedIds.length} Guests Selected)`}
          className="max-w-md w-full"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleBatchSubEventAccess();
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="batch-sub-event-action" className="block text-sm font-semibold mb-1">
                Action:
              </label>
              <select
                id="batch-sub-event-action"
                aria-label="Batch sub-event action"
                value={bulkSubEventAction}
                onChange={(e) => setBulkSubEventAction(e.target.value as any)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              >
                <option value="grant">Grant Access</option>
                <option value="revoke">Revoke Access</option>
                <option value="set">Set Access (Replace)</option>
              </select>
            </div>

            <div>
              <span id="batch-sub-events-list-label" className="block text-sm font-semibold mb-2">
                Select Private Sub-Events:
              </span>
              <div
                role="group"
                aria-labelledby="batch-sub-events-list-label"
                className="max-h-48 overflow-y-auto space-y-2 border border-gray-200 dark:border-gray-700 p-3 rounded-lg"
              >
                {subEvents.length === 0 ? (
                  <p className="text-xs text-gray-600 dark:text-gray-300 italic">No sub-events found.</p>
                ) : (
                  subEvents.map((se) => {
                    const isChecked = bulkSelectedSubEventIds.includes(se.id);
                    return (
                      <label key={se.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBulkSelectedSubEventIds([...bulkSelectedSubEventIds, se.id]);
                            } else {
                              setBulkSelectedSubEventIds(
                                bulkSelectedSubEventIds.filter((id) => id !== se.id)
                              );
                            }
                          }}
                          className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>
                          {se.title} {se.isPrivate ? '(Private)' : '(Public)'}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBulkSubEventModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Apply Batch Access
              </Button>
            </div>
          </form>
        </Dialog>

        <Dialog
          isOpen={isBatchDeleteModalOpen}
          onClose={() => setIsBatchDeleteModalOpen(false)}
          role="alertdialog"
          title="Confirm Batch Deletion"
          aria-describedby="batch-delete-modal-desc"
          className="max-w-lg w-full"
        >
          <div className="space-y-4">
            <p id="batch-delete-modal-desc" className="text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to delete <span className="font-bold text-red-700 dark:text-red-400">{selectedIds.length}</span> selected invitation code(s)? This action cannot be undone.
            </p>
            <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                Selected Guests:
              </p>
              <ul className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {selectedGuests.map((c) => (
                  <li key={c.id} className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <span className="font-medium">{c.guestName}</span>
                    <code className="text-xs font-mono text-gray-600 dark:text-gray-300">{c.code}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsBatchDeleteModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmBatchDelete}
              >
                Delete {selectedIds.length} Code(s)
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={isMergeModalOpen}
          onClose={() => {
            if (!isMerging) {
              setIsMergeModalOpen(false);
            }
          }}
          title={`Merge Duplicate Guests (${selectedGuests.length} Selected)`}
          className="max-w-2xl w-full"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleConfirmMerge();
            }}
            className="space-y-4 max-h-[80vh] overflow-y-auto pr-1"
          >
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Choose the primary guest invitation to keep. Linked registry gifts, private sub-event permissions, RSVPs, broadcast delivery logs, and table seat assignments will be transferred automatically before secondary records are deleted.
            </p>

            <div>
              <span
                id="merge-primary-guest-label"
                className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2"
              >
                1. Select Primary Record
              </span>
              <div
                role="radiogroup"
                aria-labelledby="merge-primary-guest-label"
                className="space-y-2 max-h-48 overflow-y-auto"
              >
                {selectedGuests.map((guest) => {
                  const isPrimary = resolvedPrimaryMergeId === guest.id;
                  return (
                    <label
                      key={guest.id}
                      className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isPrimary
                          ? 'border-primary bg-red-50/50 dark:bg-red-950/30'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="primaryMergeGuest"
                          value={guest.id}
                          checked={isPrimary}
                          onChange={() => setPrimaryMergeId(guest.id)}
                          className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
                        />
                        <div>
                          <div className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
                            <span>{guest.guestName}</span>
                            <code className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-red-700 dark:text-red-300">
                              {guest.code}
                            </code>
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {[guest.email, guest.householdName].filter(Boolean).join(' • ') || 'No email or household'}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          isPrimary
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {isPrimary ? 'Primary (Keep Code)' : 'Secondary (Merge & Delete)'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {mergePreview && (
              <div
                data-testid="merge-preview-card"
                className="bg-gray-50 dark:bg-gray-800/80 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-2 text-xs"
              >
                <div className="font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                  2. Combined Profile Preview
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-800 dark:text-gray-200">
                  <div>
                    <span className="font-semibold">Guest Name:</span> {mergePreview.guestName}
                  </div>
                  <div>
                    <span className="font-semibold">Retained Code:</span>{' '}
                    <code className="font-mono font-bold text-red-700 dark:text-red-300">
                      {mergePreview.code}
                    </code>
                  </div>
                  <div>
                    <span className="font-semibold">Email:</span> {mergePreview.email || 'None'}
                  </div>
                  <div>
                    <span className="font-semibold">Phone:</span>{' '}
                    {typeof mergePreview.extraFields?.phone === 'string' &&
                    mergePreview.extraFields.phone.trim()
                      ? mergePreview.extraFields.phone
                      : 'None'}
                  </div>
                  <div>
                    <span className="font-semibold">Household:</span> {mergePreview.householdName || 'None'}
                  </div>
                  <div>
                    <span className="font-semibold">Companion / Plus-Ones:</span>{' '}
                    {[mergePreview.plusOneFirstName, mergePreview.plusOneLastName]
                      .filter(Boolean)
                      .join(' ') || 'Unnamed'}{' '}
                    ({mergePreview.plusOneAllocations} allocation{mergePreview.plusOneAllocations === 1 ? '' : 's'})
                  </div>
                  <div>
                    <span className="font-semibold">Party Group:</span> {mergePreview.partyGroup || 'None'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Address:</span>{' '}
                    {[
                      mergePreview.addressLine1,
                      mergePreview.addressLine2,
                      mergePreview.city,
                      mergePreview.state,
                      mergePreview.zipCode,
                      mergePreview.country,
                    ]
                      .filter(Boolean)
                      .join(', ') || 'No address provided'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Dietary Notes:</span>{' '}
                    {mergePreview.dietaryNotes || 'None'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Party Tags:</span>{' '}
                    {mergePreview.partyTags.length > 0
                      ? mergePreview.partyTags.map((t) => `#${t}`).join(', ')
                      : 'None'}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-semibold">Seating:</span>{' '}
                    {mergePreview.tableId
                      ? `Assigned${mergePreview.seatNumber ? ` (Seat ${mergePreview.seatNumber})` : ''}`
                      : 'Unassigned'}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isMerging}
                onClick={() => setIsMergeModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isMerging || selectedGuests.length < 2}
              >
                {isMerging ? 'Merging Guests...' : `Merge ${selectedGuests.length} Guests`}
              </Button>
            </div>
          </form>
        </Dialog>

        <GuestEditorModal
          isOpen={Boolean(editingGuest)}
          onClose={() => setEditingGuest(null)}
          guest={editingGuest}
          onSave={handleSaveGuest}
          onRsvpUpdated={() => {
            void fetchAll?.();
            void queryClient.invalidateQueries({ queryKey: RSVP_SUMMARY_QUERY_KEY });
          }}
        />

        <SubEventEditorModal
          isOpen={isSubEventModalOpen}
          onClose={() => {
            setIsSubEventModalOpen(false);
            setEditingSubEvent(null);
          }}
          editingEvent={editingSubEvent}
          onSave={handleSaveSubEvent}
          existingSubEvents={subEvents}
          onSelectEdit={(evt) => setEditingSubEvent(evt)}
          onRequestDelete={(evt) => setDeletingSubEvent(evt)}
        />

        <SubEventDeleteConfirmModal
          subEvent={deletingSubEvent}
          onClose={() => setDeletingSubEvent(null)}
          onConfirm={handleConfirmDeleteSubEvent}
        />

        <BroadcastModal
          isOpen={isBroadcastModalOpen}
          onClose={() => setIsBroadcastModalOpen(false)}
          targetFilters={broadcastModalFilters}
          selectedCount={broadcastModalFilters?.selectedIds?.length}
          guests={codes}
          initialRecipientCount={
            broadcastModalFilters?.selectedIds
              ? broadcastModalFilters.selectedIds.length
              : nonAddressCollectionFilteredCount
          }
          subEvents={subEvents}
          onViewDeliveryLogs={() => router.push('/admin/dashboard/history?tab=broadcasts')}
        />

        <InvitationQRPreviewModal
          isOpen={Boolean(qrPreviewGuest)}
          onClose={() => setQrPreviewGuest(null)}
          guest={qrPreviewGuest}
        />

        <InvitationQRPrintLabelsModal
          isOpen={isPrintLabelsModalOpen}
          onClose={() => setIsPrintLabelsModalOpen(false)}
          codes={printLabelsList}
        />
      </div>
    </AdminViewState>
  );
}
