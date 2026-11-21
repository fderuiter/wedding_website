'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  isAddressComplete,
  type InvitationCodeDTO,
  type SplitInvitationCoupleDTO,
  type SplitInvitationCoupleResult,
} from '@/features/registry';
import type { SubEventDTO } from '@/features/sub-events';
import {
  computeMergedInvitationPreview,
  isCombinedCoupleGuest,
  parseCombinedCoupleGuestNames,
  suggestHouseholdNameForSplit,
} from '@/utils/invitationValidation';

const EMPTY_SUB_EVENT_IDS: string[] = [];

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
        </div>
        {(item.plusOneFirstName || item.plusOneLastName) && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            Plus-One: {[item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ')}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-secondary uppercase tracking-wider">
            Code: <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-red-700 dark:text-red-300">{item.code}</code>
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
            <span className="text-gray-600 dark:text-gray-300 italic">No address provided</span>
          )}
        </div>

        <div className="text-xs text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-4 pt-1">
          <span>Status: <span className={item.used ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-green-700 dark:text-green-300 font-semibold'}>{item.used ? 'Redeemed/Used' : 'Active/Unused'}</span></span>
          <span>
            RSVP:{' '}
            <span
              className={
                attendanceStatus === 'attending'
                  ? 'text-green-700 dark:text-green-300 font-semibold'
                  : attendanceStatus === 'declined'
                    ? 'text-red-700 dark:text-red-300 font-semibold'
                    : 'text-amber-800 dark:text-amber-300 font-semibold'
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

        {/* Private Sub-Event Access Matrix Toggles */}
        <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700/60" data-testid={`sub-event-access-${item.id}`}>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300 block mb-1">
            Private Sub-Event Permissions:
          </span>
          <div className="flex flex-wrap gap-2">
            {subEvents.length === 0 ? (
              <span className="text-xs text-gray-600 dark:text-gray-300 italic">No sub-events created yet</span>
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
  onSplitCouple?: (_item: InvitationCodeDTO) => void;
  onDelete: (_id: string, _e: React.MouseEvent<HTMLButtonElement>) => void;
}

const InvitationCodeRowActions = React.memo<InvitationCodeRowActionsProps>(
  function InvitationCodeRowActions({ item, onEdit, onSplitCouple, onDelete }) {
    const canSplitCouple = Boolean(onSplitCouple && isCombinedCoupleGuest(item));
    return (
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {canSplitCouple && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Split couple ${item.guestName} into household members`}
            onClick={() => onSplitCouple?.(item)}
            data-testid={`split-couple-btn-${item.id}`}
          >
            Split Couple
          </Button>
        )}
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
  onSplitCouple,
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
      <InvitationCodeRowActions
        item={item}
        onEdit={onEdit}
        onSplitCouple={onSplitCouple}
        onDelete={onDelete}
      />
    </div>
  );
});

export default function InvitationCodesDashboardPage() {
  const router = useRouter();
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
    mergeDuplicates,
    splitCouple,
    fetchAll,
  } = useAdminInvitationCodes();

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
  const [splittingGuest, setSplittingGuest] = useState<InvitationCodeDTO | null>(null);
  const [splitHouseholdName, setSplitHouseholdName] = useState('');
  const [splitMembers, setSplitMembers] = useState<
    Array<{ guestName: string; email: string; plusOneAllocations: number }>
  >([]);
  const [isSplitting, setIsSplitting] = useState(false);
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

  const handleBatchSubEventAccess = async () => {
    if (selectedIds.length === 0) return;
    if (bulkSelectedSubEventIds.length === 0) {
      addToast('Please select at least one sub-event.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/admin/sub-events/access/batch', {
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
      const res = await fetch('/api/admin/sub-events/access');
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
      const res = await fetch('/api/admin/sub-events/access/batch', {
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
    return {
      all: codes.length,
      attending: codes.filter((c) => getAttendanceStatus(c) === 'attending').length,
      declined: codes.filter((c) => getAttendanceStatus(c) === 'declined').length,
      pending: codes.filter((c) => getAttendanceStatus(c) === 'pending').length,
    };
  }, [codes]);

  const cateringSummary = useMemo(() => {
    let totalWithRestrictions = 0;
    let glutenFree = 0;
    let vegetarian = 0;
    let vegan = 0;
    let dairyFree = 0;
    let nutFree = 0;
    let other = 0;

    for (const item of codes) {
      const hasNotes = Boolean(item.dietaryNotes && item.dietaryNotes.trim());
      const restrictionTags = extractDietaryTags(item.extraFields).filter((t) => t !== 'kids');
      if (!hasNotes && restrictionTags.length === 0) continue;
      totalWithRestrictions++;
      const notes = hasNotes ? item.dietaryNotes!.trim() : '';

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

    return {
      totalWithRestrictions,
      glutenFree,
      vegetarian,
      vegan,
      dairyFree,
      nutFree,
      other,
    };
  }, [codes]);

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
        matchesAddress ||
        matchesDietary ||
        matchesHousehold ||
        matchesPartyGroup ||
        matchesTags
      );
    });
  }, [codes, searchQuery, statusFilter, addressFilter, attendanceFilter, dietaryFilter, partyGroupFilter, selectedTagFilter]);

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

  const handleExportSelectedCsv = () => {
    if (selectedIds.length === 0) {
      addToast('No invitation codes selected for export.', 'info');
      return;
    }

    const params = new URLSearchParams();
    params.set('ids', selectedIds.join(','));

    const link = document.createElement('a');
    link.href = `/api/admin/invitation-codes/export?${params.toString()}`;
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

  const handleOpenSplitModal = useCallback((guest: InvitationCodeDTO) => {
    const parsedNames = parseCombinedCoupleGuestNames(guest);
    const normalizedNames = parsedNames.length >= 2 ? parsedNames : [guest.guestName || '', ''];
    setSplittingGuest(guest);
    setSplitHouseholdName(suggestHouseholdNameForSplit(guest));
    setSplitMembers(
      normalizedNames.map((name, idx) => ({
        guestName: name,
        email: idx === 0 ? guest.email || '' : '',
        plusOneAllocations: 0,
      }))
    );
  }, []);

  const handleConfirmSplitCouple = async () => {
    if (!splittingGuest) return;
    const cleanHousehold = splitHouseholdName.trim();
    if (!cleanHousehold) {
      addToast('Please enter a shared household name.', 'error');
      return;
    }

    const cleanedMembers = splitMembers.map((m) => ({
      guestName: m.guestName.trim(),
      email: m.email.trim() || null,
      plusOneAllocations: Math.max(0, Math.floor(Number(m.plusOneAllocations) || 0)),
    }));

    if (cleanedMembers.length < 2) {
      addToast('Please list at least two household members.', 'error');
      return;
    }
    if (cleanedMembers.some((m) => !m.guestName)) {
      addToast('Every split household member must have a full name.', 'error');
      return;
    }

    const payload: SplitInvitationCoupleDTO = {
      sourceId: splittingGuest.id,
      householdName: cleanHousehold,
      members: cleanedMembers,
    };

    setIsSplitting(true);
    try {
      let splitResult: SplitInvitationCoupleResult | undefined;
      if (typeof splitCouple === 'function') {
        splitResult = await splitCouple(payload);
      } else {
        const res = await fetch('/api/admin/invitation-codes/split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || 'Failed to split couple into household members.');
        }
        splitResult = (json.data || json) as SplitInvitationCoupleResult;
        fetchAll?.();
      }

      const memberCount = splitResult?.records?.length ?? cleanedMembers.length;
      addToast(
        `Split "${splittingGuest.guestName}" into ${memberCount} individual members under ${cleanHousehold}.`,
        'success'
      );
      setSplittingGuest(null);
      setSelectedIds([]);
      fetchSubEventsAndMatrix();
    } catch (e: unknown) {
      addToast(
        e instanceof Error && e.message
          ? e.message
          : 'Failed to split couple into household members.',
        'error'
      );
    } finally {
      setIsSplitting(false);
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
    link.href = exportUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('Invitation codes exported successfully.', 'success');
  };

  const handleCopyShareableLink = () => {
    const url = `${window.location.origin}/guest/collect`;
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
                Overview of guest dietary requirements and restriction counts
              </p>
            </div>
            <div className="text-sm font-semibold text-primary dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-1 rounded-full self-start sm:self-auto border border-red-200 dark:border-red-800/40">
              {cateringSummary.totalWithRestrictions} {cateringSummary.totalWithRestrictions === 1 ? 'Guest' : 'Guests'} with Dietary Notes
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-center">
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
            <div className="bg-gray-50 dark:bg-gray-700/40 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Other</div>
              <div className="text-xl font-extrabold text-primary dark:text-white mt-0.5">{cateringSummary.other}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
            <FormGroup className="relative flex-1 max-w-md space-y-0">
              <Input
                type="text"
                placeholder="Search by name, code, email, household, tag..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedIds([]);
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

          <div className="grid gap-4 pb-10" ref={containerRef}>
            {filteredCodes.map((item) => (
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
                onSplitCouple={handleOpenSplitModal}
                onDelete={handleDelete}
              />
            ))}
            {codes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No invitation codes found.</p>}
            {codes.length > 0 && filteredCodes.length === 0 && (
              <p className="text-gray-500 dark:text-gray-400">No invitation codes match your search or filter criteria.</p>
            )}
          </div>
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
              {selectedIds.length === 1 && selectedGuests[0] && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleOpenSplitModal(selectedGuests[0])}
                >
                  Split into Household
                </Button>
              )}
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

        <Dialog
          isOpen={Boolean(splittingGuest)}
          onClose={() => {
            if (!isSplitting) {
              setSplittingGuest(null);
            }
          }}
          title="Split Couple into Household Members"
          className="max-w-2xl w-full"
        >
          {splittingGuest && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleConfirmSplitCouple();
              }}
              className="space-y-4 max-h-[80vh] overflow-y-auto pr-1"
              data-testid="split-couple-modal-form"
            >
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Convert <strong>{splittingGuest.guestName}</strong> into individual household member
                rows sharing a single household name. Mailing address, party group, tags, and
                private sub-event permissions are copied to each member so anyone in the household
                can RSVP individually.
              </p>

              <FormGroup>
                <Label htmlFor="split-household-name">Shared Household Name</Label>
                <Input
                  id="split-household-name"
                  type="text"
                  value={splitHouseholdName}
                  onChange={(e) => setSplitHouseholdName(e.target.value)}
                  placeholder="e.g. Smith Household"
                  required
                  disabled={isSplitting}
                />
              </FormGroup>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                    Individual Household Members ({splitMembers.length})
                  </span>
                  {splitMembers.length < 6 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isSplitting}
                      onClick={() =>
                        setSplitMembers((prev) => [
                          ...prev,
                          { guestName: '', email: '', plusOneAllocations: 0 },
                        ])
                      }
                    >
                      + Add Member
                    </Button>
                  )}
                </div>

                {splitMembers.map((member, idx) => (
                  <div
                    key={idx}
                    data-testid={`split-member-row-${idx}`}
                    className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-100">
                        Member {idx + 1}{' '}
                        {idx === 0 ? (
                          <span className="ml-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                            (Keeps code {splittingGuest.code}, gifts &amp; seat)
                          </span>
                        ) : (
                          <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            (Receives new personal code)
                          </span>
                        )}
                      </span>
                      {splitMembers.length > 2 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isSplitting}
                          aria-label={`Remove household member ${idx + 1}`}
                          onClick={() =>
                            setSplitMembers((prev) => prev.filter((_, mIdx) => mIdx !== idx))
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormGroup className="sm:col-span-1 space-y-1">
                        <Label htmlFor={`split-member-name-${idx}`} className="text-xs mb-0">
                          Full Name (First &amp; Last)
                        </Label>
                        <Input
                          id={`split-member-name-${idx}`}
                          type="text"
                          value={member.guestName}
                          onChange={(e) =>
                            setSplitMembers((prev) =>
                              prev.map((m, mIdx) =>
                                mIdx === idx ? { ...m, guestName: e.target.value } : m
                              )
                            )
                          }
                          placeholder="First and last name"
                          required
                          disabled={isSplitting}
                        />
                      </FormGroup>

                      <FormGroup className="sm:col-span-1 space-y-1">
                        <Label htmlFor={`split-member-email-${idx}`} className="text-xs mb-0">
                          Email (Optional)
                        </Label>
                        <Input
                          id={`split-member-email-${idx}`}
                          type="email"
                          value={member.email}
                          onChange={(e) =>
                            setSplitMembers((prev) =>
                              prev.map((m, mIdx) =>
                                mIdx === idx ? { ...m, email: e.target.value } : m
                              )
                            )
                          }
                          placeholder="member@example.com"
                          disabled={isSplitting}
                        />
                      </FormGroup>

                      <FormGroup className="sm:col-span-1 space-y-1">
                        <Label htmlFor={`split-member-plusones-${idx}`} className="text-xs mb-0">
                          Plus-One Allocation
                        </Label>
                        <Input
                          id={`split-member-plusones-${idx}`}
                          type="number"
                          min={0}
                          max={20}
                          value={String(member.plusOneAllocations)}
                          onChange={(e) =>
                            setSplitMembers((prev) =>
                              prev.map((m, mIdx) =>
                                mIdx === idx
                                  ? {
                                    ...m,
                                    plusOneAllocations: Math.max(
                                      0,
                                      parseInt(e.target.value || '0', 10) || 0
                                    ),
                                  }
                                  : m
                              )
                            )
                          }
                          disabled={isSplitting}
                        />
                      </FormGroup>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSplitting}
                  onClick={() => setSplittingGuest(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isSplitting}
                  data-testid="confirm-split-couple-btn"
                >
                  {isSplitting
                    ? 'Splitting Couple...'
                    : `Split into ${splitMembers.length} Household Members`}
                </Button>
              </div>
            </form>
          )}
        </Dialog>

        <GuestEditorModal
          isOpen={Boolean(editingGuest)}
          onClose={() => setEditingGuest(null)}
          guest={editingGuest}
          onSave={handleSaveGuest}
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
