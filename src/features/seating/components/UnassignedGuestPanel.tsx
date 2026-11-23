'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { InvitationCodeDTO } from '@/features/registry';
import { SeatingTableDTO } from '../schemas';
import { resolveSeatAssignments } from '../seatLayout';
import {
  ADDRESS_COLLECTION_TAG,
  getDietaryBadges,
  getGuestAttendanceStatus,
  isGuestEligibleForSeating,
} from '../utils/seatingHelpers';

const POINTER_DRAG_THRESHOLD_PX = 8;

type GuestPointerDragPayload =
  | {
    kind: 'guest';
    guestId: string;
    label: string;
  }
  | {
    kind: 'household';
    memberIds: string[];
    householdName: string;
    label: string;
  };

interface ActiveGuestPointerDrag {
  payload: GuestPointerDragPayload;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  isDragging: boolean;
  captureElement: HTMLElement | null;
}

type RsvpFilterValue = 'all' | 'attending' | 'pending';

interface HouseholdGroupItem {
  kind: 'household';
  key: string;
  householdName: string;
  members: InvitationCodeDTO[];
}

interface SoloGuestItem {
  kind: 'solo';
  key: string;
  guest: InvitationCodeDTO;
}

type PanelDisplayItem = HouseholdGroupItem | SoloGuestItem;

interface UnassignedGuestPanelProps {
  unassignedGuests: InvitationCodeDTO[];
  tables: SeatingTableDTO[];
  onAssignGuestToTable: (guestId: string, tableId: string, seatNumber?: number) => void;
  onAssignGuestsToTable?: (guestIds: string[], tableId: string) => void | Promise<boolean>;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onAutoAssignComplete?: (result: { assignedCount: number; unassignedCount: number; assignedGuests: any[] }) => void;
}

export const UnassignedGuestPanel = React.memo(function UnassignedGuestPanel({
  unassignedGuests,
  tables,
  onAssignGuestToTable,
  onAssignGuestsToTable,
  searchQuery,
  onSearchQueryChange,
  onAutoAssignComplete,
}: UnassignedGuestPanelProps) {
  const toast = useOptionalToast();
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [includePending, setIncludePending] = useState(true);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const [rsvpFilter, setRsvpFilter] = useState<RsvpFilterValue>('all');
  const [partyGroupFilter, setPartyGroupFilter] = useState<string>('all');
  const [partyTagFilter, setPartyTagFilter] = useState<string>('all');

  const [selectedGuestForModal, setSelectedGuestForModal] = useState<InvitationCodeDTO | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>('');
  const [targetSeatNumber, setTargetSeatNumber] = useState<number | undefined>(undefined);

  const [selectedHouseholdForModal, setSelectedHouseholdForModal] = useState<HouseholdGroupItem | null>(null);
  const [targetHouseholdTableId, setTargetHouseholdTableId] = useState<string>('');

  const [activePointerDrag, setActivePointerDrag] = useState<ActiveGuestPointerDrag | null>(null);
  const activePointerDragRef = useRef<ActiveGuestPointerDrag | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const latestPropsRef = useRef({ tables, onAssignGuestToTable, onAssignGuestsToTable, toast });
  latestPropsRef.current = { tables, onAssignGuestToTable, onAssignGuestsToTable, toast };

  const detachDragWindowListeners = useCallback(() => {
    if (dragCleanupRef.current) {
      dragCleanupRef.current();
      dragCleanupRef.current = null;
    }
  }, []);

  const clearPointerDrag = useCallback(() => {
    const drag = activePointerDragRef.current;
    if (drag?.captureElement) {
      try {
        drag.captureElement.releasePointerCapture?.(drag.pointerId);
      } catch {
        // Ignore release errors when pointer was already released
      }
    }
    activePointerDragRef.current = null;
    detachDragWindowListeners();
    setActivePointerDrag(null);
  }, [detachDragWindowListeners]);

  const updatePointerDragPosition = useCallback((pointerId: number | undefined, clientX: number, clientY: number) => {
    const drag = activePointerDragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== undefined && drag.pointerId !== pointerId)) return;

    const distance = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    const shouldDrag = drag.isDragging || distance >= POINTER_DRAG_THRESHOLD_PX;
    if (!shouldDrag) return;

    if (!drag.isDragging && drag.captureElement) {
      try {
        drag.captureElement.setPointerCapture?.(drag.pointerId);
      } catch {
        // Ignore synthetic events in test environments where pointerId isn't active
      }
    }

    const nextDrag: ActiveGuestPointerDrag = {
      ...drag,
      clientX,
      clientY,
      isDragging: true,
    };
    activePointerDragRef.current = nextDrag;
    setActivePointerDrag(nextDrag);
  }, []);

  const finishPointerDrag = useCallback((pointerId: number | undefined, clientX: number, clientY: number) => {
    const drag = activePointerDragRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== undefined && drag.pointerId !== pointerId)) return;

    const wasDragging = drag.isDragging;
    const payload = drag.payload;
    clearPointerDrag();

    if (!wasDragging || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
      return;
    }

    const hitElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!hitElement) return;

    const seatEl = hitElement.closest?.('[data-seat-number][data-table-id]') as HTMLElement | null;
    const tableEl = hitElement.closest?.('[data-table-id]') as HTMLElement | null;
    const resolvedTableId = seatEl?.getAttribute('data-table-id') || tableEl?.getAttribute('data-table-id');
    if (!resolvedTableId) return;

    const {
      tables: currentTables,
      onAssignGuestToTable: assignFn,
      onAssignGuestsToTable: assignBatchFn,
      toast: currentToast,
    } = latestPropsRef.current;
    const targetTable = currentTables.find((t) => t.id === resolvedTableId);

    if (payload.kind === 'household') {
      if (targetTable) {
        const currentSeatedIds = new Set((targetTable.invitationCodes || []).map((g) => g.id));
        const incomingCount = payload.memberIds.filter((id) => !currentSeatedIds.has(id)).length;
        const availableSeats = targetTable.capacity - currentSeatedIds.size;
        if (incomingCount > availableSeats) {
          currentToast?.addToast(
            `Table "${targetTable.name}" only has ${availableSeats} open seat${availableSeats === 1 ? '' : 's'} for ${payload.memberIds.length} household members.`,
            'error'
          );
          return;
        }
      }

      if (assignBatchFn) {
        void assignBatchFn(payload.memberIds, resolvedTableId);
      } else {
        payload.memberIds.forEach((id) => assignFn(id, resolvedTableId));
      }
      return;
    }

    if (targetTable) {
      const isFull = (targetTable.invitationCodes?.length || 0) >= targetTable.capacity;
      const isAlreadyAtTable = targetTable.invitationCodes?.some((g) => g.id === payload.guestId);
      if (isFull && !isAlreadyAtTable) {
        currentToast?.addToast(
          `Table "${targetTable.name}" has reached its maximum capacity of ${targetTable.capacity}.`,
          'error'
        );
        return;
      }
    }

    const rawSeat = seatEl?.getAttribute('data-seat-number');
    const parsedSeat = rawSeat ? parseInt(rawSeat, 10) : NaN;
    if (!Number.isNaN(parsedSeat) && parsedSeat >= 1) {
      assignFn(payload.guestId, resolvedTableId, parsedSeat);
    } else {
      assignFn(payload.guestId, resolvedTableId);
    }
  }, [clearPointerDrag]);

  useEffect(() => {
    return () => {
      detachDragWindowListeners();
    };
  }, [detachDragWindowListeners]);

  const startPayloadPointerDrag = (e: React.PointerEvent, payload: GuestPointerDragPayload) => {
    if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
    const targetNode = e.target as HTMLElement | null;
    if (targetNode?.closest?.('button')) {
      return;
    }

    const captureElement = e.currentTarget as HTMLElement;
    const nextDrag: ActiveGuestPointerDrag = {
      payload,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      isDragging: false,
      captureElement,
    };
    activePointerDragRef.current = nextDrag;
    setActivePointerDrag(nextDrag);

    detachDragWindowListeners();
    const onWinMove = (ev: PointerEvent) => updatePointerDragPosition(ev.pointerId, ev.clientX, ev.clientY);
    const onWinUp = (ev: PointerEvent) => finishPointerDrag(ev.pointerId, ev.clientX, ev.clientY);
    const onWinCancel = (ev: PointerEvent) => {
      const drag = activePointerDragRef.current;
      if (drag && (ev.pointerId === undefined || drag.pointerId === ev.pointerId)) {
        clearPointerDrag();
      }
    };
    const onWinKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && activePointerDragRef.current) {
        clearPointerDrag();
      }
    };

    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinCancel);
    window.addEventListener('keydown', onWinKeyDown);
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinCancel);
      window.removeEventListener('keydown', onWinKeyDown);
    };
  };

  const handleCardPointerDown = (e: React.PointerEvent, guest: InvitationCodeDTO) => {
    startPayloadPointerDrag(e, {
      kind: 'guest',
      guestId: guest.id,
      label: guest.guestName,
    });
  };

  const handleHouseholdPointerDown = (
    e: React.PointerEvent,
    householdName: string,
    memberIds: string[]
  ) => {
    startPayloadPointerDrag(e, {
      kind: 'household',
      memberIds,
      householdName,
      label: `🏠 ${householdName} (${memberIds.length})`,
    });
  };

  const handleCardPointerMove = (e: React.PointerEvent) => {
    updatePointerDragPosition(e.pointerId, e.clientX, e.clientY);
  };

  const handleCardPointerUp = (e: React.PointerEvent) => {
    finishPointerDrag(e.pointerId, e.clientX, e.clientY);
  };

  const handleCardPointerCancel = (e: React.PointerEvent) => {
    const drag = activePointerDragRef.current;
    if (drag && (e.pointerId === undefined || drag.pointerId === e.pointerId)) {
      clearPointerDrag();
    }
  };

  const currentSearchQuery = searchQuery !== undefined ? searchQuery : internalSearchTerm;

  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchTerm(val);
    }
  };

  // Always exclude declined RSVPs and public address-collection rows from the seating pool
  const eligibleGuests = useMemo(
    () => unassignedGuests.filter((guest) => isGuestEligibleForSeating(guest)),
    [unassignedGuests]
  );

  const partyGroupOptions = useMemo(() => {
    const groups = new Set<string>();
    for (const guest of eligibleGuests) {
      const trimmed = guest.partyGroup?.trim();
      if (trimmed) {
        groups.add(trimmed);
      }
    }
    return Array.from(groups).sort((a, b) => a.localeCompare(b));
  }, [eligibleGuests]);

  const partyTagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const guest of eligibleGuests) {
      if (Array.isArray(guest.partyTags)) {
        for (const rawTag of guest.partyTags) {
          const trimmed = rawTag.trim();
          if (trimmed && trimmed.toLowerCase() !== ADDRESS_COLLECTION_TAG) {
            tags.add(trimmed);
          }
        }
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [eligibleGuests]);

  const filteredGuests = useMemo(() => {
    const term = currentSearchQuery.trim().toLowerCase();

    return eligibleGuests.filter((guest) => {
      if (rsvpFilter !== 'all') {
        const status = getGuestAttendanceStatus(guest);
        if (status !== rsvpFilter) return false;
      }

      if (partyGroupFilter !== 'all') {
        if ((guest.partyGroup?.trim() || '') !== partyGroupFilter) return false;
      }

      if (partyTagFilter !== 'all') {
        if (!Array.isArray(guest.partyTags) || !guest.partyTags.some((t) => t.trim() === partyTagFilter)) {
          return false;
        }
      }

      if (!term) return true;

      const matchesName = guest.guestName.toLowerCase().includes(term);
      const matchesCode = guest.code ? guest.code.toLowerCase().includes(term) : false;
      const matchesHousehold = guest.householdName ? guest.householdName.toLowerCase().includes(term) : false;
      const matchesGroup = guest.partyGroup ? guest.partyGroup.toLowerCase().includes(term) : false;
      const matchesTags = guest.partyTags ? guest.partyTags.some((t) => t.toLowerCase().includes(term)) : false;
      const matchesDiet = guest.dietaryNotes ? guest.dietaryNotes.toLowerCase().includes(term) : false;
      return matchesName || matchesCode || matchesHousehold || matchesGroup || matchesTags || matchesDiet;
    });
  }, [eligibleGuests, rsvpFilter, partyGroupFilter, partyTagFilter, currentSearchQuery]);

  // Group filtered guests sharing a non-empty householdName (2+ members) while preserving first-seen order
  const displayItems = useMemo<PanelDisplayItem[]>(() => {
    const householdBuckets = new Map<string, { displayName: string; members: InvitationCodeDTO[] }>();
    for (const guest of filteredGuests) {
      const hh = guest.householdName?.trim();
      if (!hh) continue;
      const key = hh.toLowerCase();
      const existing = householdBuckets.get(key);
      if (existing) {
        existing.members.push(guest);
      } else {
        householdBuckets.set(key, { displayName: hh, members: [guest] });
      }
    }

    const emittedHouseholds = new Set<string>();
    const items: PanelDisplayItem[] = [];

    for (const guest of filteredGuests) {
      const hh = guest.householdName?.trim();
      if (hh) {
        const key = hh.toLowerCase();
        const bucket = householdBuckets.get(key);
        if (bucket && bucket.members.length >= 2) {
          if (!emittedHouseholds.has(key)) {
            emittedHouseholds.add(key);
            items.push({
              kind: 'household',
              key: `household-${key}`,
              householdName: bucket.displayName,
              members: bucket.members,
            });
          }
          continue;
        }
      }
      items.push({
        kind: 'solo',
        key: guest.id,
        guest,
      });
    }

    return items;
  }, [filteredGuests]);

  const handleDragStart = (e: React.DragEvent, guestId: string) => {
    e.stopPropagation();
    clearPointerDrag();
    e.dataTransfer.setData('text/plain', guestId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleHouseholdDragStart = (e: React.DragEvent, memberIds: string[]) => {
    clearPointerDrag();
    e.dataTransfer.setData('text/plain', `household:${memberIds.join(',')}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAutoAssignAll = async () => {
    setIsAutoAssigning(true);
    try {
      const fetchInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      };
      if (!includePending) {
        fetchInit.body = JSON.stringify({ includePending: false });
      }

      const res = await fetch('/api/admin/seating/auto-assign', fetchInit);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to auto-assign seats');
      }

      const json = await res.json();
      const payload = json.data || json;
      const assignedCount = payload.assignedCount ?? 0;
      const unassignedCount = payload.unassignedCount ?? 0;

      let summaryMsg = `Successfully auto-assigned ${assignedCount} guest${assignedCount === 1 ? '' : 's'} across reception tables.`;
      if (assignedCount === 0) {
        summaryMsg = 'No guests could be auto-assigned. Please verify table capacities.';
      } else if (unassignedCount > 0) {
        summaryMsg = `Auto-assigned ${assignedCount} guest${assignedCount === 1 ? '' : 's'} (${unassignedCount} remaining unseated due to capacity).`;
      }

      toast?.addToast(summaryMsg, 'success');
      onAutoAssignComplete?.(payload);
    } catch (err: any) {
      toast?.addToast(err.message || 'Error executing auto-assignment', 'error');
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleQuickAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGuestForModal && targetTableId) {
      if (targetSeatNumber !== undefined) {
        onAssignGuestToTable(selectedGuestForModal.id, targetTableId, targetSeatNumber);
      } else {
        onAssignGuestToTable(selectedGuestForModal.id, targetTableId);
      }
      setSelectedGuestForModal(null);
      setTargetTableId('');
      setTargetSeatNumber(undefined);
    }
  };

  const openHouseholdModal = (group: HouseholdGroupItem) => {
    setSelectedHouseholdForModal(group);
    const needed = group.members.length;
    const firstFittingTable = tables.find(
      (t) => t.capacity - (t.invitationCodes?.length || 0) >= needed
    );
    setTargetHouseholdTableId(firstFittingTable ? firstFittingTable.id : '');
  };

  const handleHouseholdAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHouseholdForModal || !targetHouseholdTableId) return;

    const guestIds = selectedHouseholdForModal.members.map((m) => m.id);
    if (onAssignGuestsToTable) {
      await onAssignGuestsToTable(guestIds, targetHouseholdTableId);
    } else {
      for (const guestId of guestIds) {
        onAssignGuestToTable(guestId, targetHouseholdTableId);
      }
    }

    setSelectedHouseholdForModal(null);
    setTargetHouseholdTableId('');
  };

  const renderGuestBadges = (guest: InvitationCodeDTO) => {
    const status = getGuestAttendanceStatus(guest);
    const dietaryBadges = getDietaryBadges(guest.dietaryNotes, guest.extraFields);

    return (
      <div className="flex flex-wrap gap-1 pt-0.5">
        <span
          data-testid="guest-rsvp-badge"
          className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${
            status === 'attending'
              ? 'bg-green-50 text-green-800 border-green-300 dark:bg-green-950/70 dark:text-green-200 dark:border-green-800'
              : 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800'
          }`}
        >
          {status === 'attending' ? 'Attending' : 'Pending'}
        </span>

        {guest.partyGroup && (
          <span
            data-testid="guest-party-group-badge"
            className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-medium"
          >
            {guest.partyGroup}
          </span>
        )}

        {dietaryBadges.map((badge) => (
          <span
            key={badge.category}
            data-testid="guest-dietary-badge"
            title={guest.dietaryNotes ? `${badge.label}: ${guest.dietaryNotes}` : badge.label}
            className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 font-semibold"
          >
            🍽️ {badge.shortLabel}
          </span>
        ))}

        {guest.partyTags &&
          guest.partyTags
            .filter((tag) => tag.trim().toLowerCase() !== ADDRESS_COLLECTION_TAG)
            .map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-medium"
              >
                #{tag}
              </span>
            ))}
      </div>
    );
  };

  const hasActiveFilters =
    rsvpFilter !== 'all' || partyGroupFilter !== 'all' || partyTagFilter !== 'all';

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Unassigned Guests</h2>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            {eligibleGuests.length} guest{eligibleGuests.length === 1 ? '' : 's'} waiting for seating
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200 border border-red-200 dark:border-red-800">
          {eligibleGuests.length} unassigned
        </span>
      </div>

      {/* Search Filter Input */}
      <div className="mb-2.5">
        <label htmlFor="unassigned-search" className="sr-only">
          Search unassigned guests
        </label>
        <input
          id="unassigned-search"
          type="text"
          value={currentSearchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Filter by guest name or code..."
          className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
        />
      </div>

      {/* RSVP, Party Group, and Party Tags Filters */}
      <div className="grid grid-cols-1 gap-2 mb-3">
        <div>
          <label
            htmlFor="unassigned-rsvp-filter"
            className="block text-[11px] font-medium text-gray-700 dark:text-gray-200 mb-0.5"
          >
            RSVP Status
          </label>
          <select
            id="unassigned-rsvp-filter"
            value={rsvpFilter}
            onChange={(e) => setRsvpFilter(e.target.value as RsvpFilterValue)}
            className="w-full min-h-[30px] px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary outline-none"
          >
            <option value="all">All Eligible</option>
            <option value="attending">Attending</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="unassigned-party-group-filter"
              className="block text-[11px] font-medium text-gray-700 dark:text-gray-200 mb-0.5"
            >
              Party Group
            </label>
            <select
              id="unassigned-party-group-filter"
              value={partyGroupFilter}
              onChange={(e) => setPartyGroupFilter(e.target.value)}
              className="w-full min-h-[30px] px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary outline-none"
            >
              <option value="all">All Groups</option>
              {partyGroupOptions.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="unassigned-party-tag-filter"
              className="block text-[11px] font-medium text-gray-700 dark:text-gray-200 mb-0.5"
            >
              Party Tag
            </label>
            <select
              id="unassigned-party-tag-filter"
              value={partyTagFilter}
              onChange={(e) => setPartyTagFilter(e.target.value)}
              className="w-full min-h-[30px] px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary outline-none"
            >
              <option value="all">All Tags</option>
              {partyTagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Guest & Household Card List */}
      <div
        role={displayItems.length > 0 ? 'list' : undefined}
        aria-label={displayItems.length > 0 ? 'Unassigned guests' : undefined}
        className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[500px]"
      >
        {displayItems.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-muted-text,#4b5563)] text-xs italic">
            {currentSearchQuery.trim()
              ? `No unassigned guests match "${currentSearchQuery.trim()}".`
              : hasActiveFilters && eligibleGuests.length > 0
                ? 'No unassigned guests match the selected filters.'
                : 'All guests have been assigned to tables!'}
          </div>
        ) : (
          displayItems.map((item) => {
            if (item.kind === 'household') {
              const memberIds = item.members.map((m) => m.id);
              return (
                <div
                  key={item.key}
                  role="listitem"
                  data-testid="household-group-card"
                  className="p-2.5 bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-lg space-y-2 shadow-xs"
                >
                  <div
                    draggable
                    onDragStart={(e) => handleHouseholdDragStart(e, memberIds)}
                    onPointerDown={(e) => handleHouseholdPointerDown(e, item.householdName, memberIds)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    onPointerCancel={handleCardPointerCancel}
                    className="flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none"
                  >
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span
                        data-testid="unassigned-household-badge"
                        className="text-xs font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-900 dark:bg-purple-900/70 dark:text-purple-100"
                      >
                        🏠 {item.householdName}
                      </span>
                      <span className="text-[11px] font-medium text-purple-800 dark:text-purple-200">
                        ({item.members.length} guests)
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => openHouseholdModal(item)}
                      srContext={`for ${item.householdName} (${item.members.length} guests)`}
                      style={
                        {
                          '--btn-primary-bg': '#7e22ce',
                          '--btn-primary-hover-bg': '#6b21a8',
                          '--btn-primary-text': '#ffffff',
                          borderRadius: '0.25rem',
                          fontWeight: 600,
                        } as React.CSSProperties
                      }
                      className="!h-auto min-h-[28px] !px-2.5 !py-1 !text-[11px] shrink-0"
                    >
                      Seat Household
                    </Button>
                  </div>

                  <div
                    role="list"
                    aria-label={`${item.householdName} household members`}
                    className="space-y-1.5 pl-2 border-l-2 border-purple-200 dark:border-purple-700"
                  >
                    {item.members.map((guest) => {
                      const isBeingPointerDragged =
                        activePointerDrag?.isDragging &&
                        activePointerDrag.payload.kind === 'guest' &&
                        activePointerDrag.payload.guestId === guest.id;
                      return (
                        <div
                          key={guest.id}
                          role="listitem"
                          draggable
                          onDragStart={(e) => handleDragStart(e, guest.id)}
                          onPointerDown={(e) => handleCardPointerDown(e, guest)}
                          onPointerMove={handleCardPointerMove}
                          onPointerUp={handleCardPointerUp}
                          onPointerCancel={handleCardPointerCancel}
                          className={`p-2 bg-white dark:bg-gray-900/70 border border-gray-200 dark:border-gray-700 rounded-md cursor-grab active:cursor-grabbing select-none flex items-center justify-between gap-2 ${
                            isBeingPointerDragged ? 'opacity-50 ring-2 ring-primary' : ''
                          }`}
                        >
                          <div className="min-w-0 pr-1 space-y-0.5">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                              {guest.guestName}
                            </p>
                            <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300">
                              Code: {guest.code}
                            </p>
                            {renderGuestBadges(guest)}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedGuestForModal(guest);
                              if (tables.length > 0) setTargetTableId(tables[0].id);
                            }}
                            className="min-h-[28px] text-[11px] font-medium px-2.5 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-primary hover:text-white hover:border-primary text-gray-700 dark:text-gray-200 rounded transition-colors shrink-0"
                            aria-label={`Assign ${guest.guestName} to table`}
                          >
                            Assign
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const { guest } = item;
            const isBeingPointerDragged =
              activePointerDrag?.isDragging &&
              activePointerDrag.payload.kind === 'guest' &&
              activePointerDrag.payload.guestId === guest.id;
            return (
              <div
                key={guest.id}
                draggable
                onDragStart={(e) => handleDragStart(e, guest.id)}
                onPointerDown={(e) => handleCardPointerDown(e, guest)}
                onPointerMove={handleCardPointerMove}
                onPointerUp={handleCardPointerUp}
                onPointerCancel={handleCardPointerCancel}
                className={`group p-2.5 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 hover:border-primary/50 dark:hover:border-primary/50 rounded-lg cursor-grab active:cursor-grabbing select-none transition-all flex items-center justify-between shadow-xs hover:shadow-sm ${
                  isBeingPointerDragged ? 'opacity-50 ring-2 ring-primary' : ''
                }`}
                role="listitem"
              >
                <div className="min-w-0 pr-2 space-y-0.5">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate flex items-center gap-1.5 flex-wrap">
                    <span>{guest.guestName}</span>
                    {guest.householdName && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 font-normal rounded bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200"
                        data-testid="unassigned-household-badge"
                      >
                        🏠 {guest.householdName}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300">
                    Code: {guest.code}
                  </p>
                  {renderGuestBadges(guest)}
                </div>

                {/* Assign button for quick/accessible assignment */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGuestForModal(guest);
                    if (tables.length > 0) setTargetTableId(tables[0].id);
                  }}
                  className="min-h-[28px] text-[11px] font-medium px-2.5 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-primary hover:text-white hover:border-primary text-gray-700 dark:text-gray-200 rounded transition-colors shrink-0"
                  aria-label={`Assign ${guest.guestName} to table`}
                >
                  Assign
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Auto-Assign All Action Section */}
      {eligibleGuests.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <label
            htmlFor="auto-assign-include-pending"
            className="flex items-center gap-2 min-h-[28px] mb-2 text-xs text-gray-700 dark:text-gray-200 cursor-pointer select-none"
          >
            <input
              id="auto-assign-include-pending"
              type="checkbox"
              checked={includePending}
              onChange={(e) => setIncludePending(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary"
            />
            <span>Include pending RSVPs in auto-assign</span>
          </label>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleAutoAssignAll}
            disabled={isAutoAssigning}
            className="w-full justify-center flex items-center gap-1.5 font-medium shadow-xs"
          >
            {isAutoAssigning ? (
              <>
                <span
                  aria-hidden="true"
                  className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"
                />
                <span>Auto-Assigning...</span>
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Auto-Assign All</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Accessible Click-to-Assign Individual Dialog */}
      <Dialog
        isOpen={Boolean(selectedGuestForModal)}
        onClose={() => {
          setSelectedGuestForModal(null);
          setTargetTableId('');
          setTargetSeatNumber(undefined);
        }}
        title={selectedGuestForModal ? `Assign ${selectedGuestForModal.guestName}` : undefined}
        className="max-w-sm w-full"
      >
        <form onSubmit={handleQuickAssignSubmit} className="space-y-3">
          <div>
            <label htmlFor="quick-assign-table-select" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Select Reception Table
            </label>
            <select
              id="quick-assign-table-select"
              value={targetTableId}
              onChange={(e) => {
                setTargetTableId(e.target.value);
                setTargetSeatNumber(undefined);
              }}
              className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              {tables.map((t) => {
                const isFull = (t.invitationCodes?.length || 0) >= t.capacity;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.invitationCodes?.length || 0}/{t.capacity} seats{isFull ? ' - FULL' : ''})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label htmlFor="unassigned-seat-select" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Select Seat (Optional)
            </label>
            <select
              id="unassigned-seat-select"
              value={targetSeatNumber ?? ''}
              onChange={(e) => setTargetSeatNumber(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">Any available seat</option>
              {(() => {
                const selTable = tables.find((t) => t.id === targetTableId);
                if (!selTable) return null;
                const resolvedSeatMap = resolveSeatAssignments(selTable.invitationCodes, selTable.capacity);
                return Array.from({ length: selTable.capacity }, (_, idx) => idx + 1).map((seatNum) => {
                  const occ = resolvedSeatMap.get(seatNum);
                  return (
                    <option key={seatNum} value={seatNum}>
                      Seat {seatNum} {occ ? `(${occ.guestName})` : '(Empty)'}
                    </option>
                  );
                });
              })()}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setSelectedGuestForModal(null);
                setTargetTableId('');
                setTargetSeatNumber(undefined);
              }}
              className="min-h-[30px] px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!targetTableId}
              className="min-h-[30px] px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              Confirm Assignment
            </button>
          </div>
        </form>
      </Dialog>

      {/* Accessible Household Batch Assignment Dialog */}
      <Dialog
        isOpen={Boolean(selectedHouseholdForModal)}
        onClose={() => {
          setSelectedHouseholdForModal(null);
          setTargetHouseholdTableId('');
        }}
        title={
          selectedHouseholdForModal
            ? `Seat ${selectedHouseholdForModal.householdName} Household (${selectedHouseholdForModal.members.length} guests)`
            : undefined
        }
        className="max-w-sm w-full"
      >
        {selectedHouseholdForModal && (
          <form onSubmit={handleHouseholdAssignSubmit} className="space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Members: {selectedHouseholdForModal.members.map((m) => m.guestName).join(', ')}
            </p>

            <div>
              <label
                htmlFor="household-assign-table-select"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Select Table with {selectedHouseholdForModal.members.length}+ Open Seats
              </label>
              <select
                id="household-assign-table-select"
                value={targetHouseholdTableId}
                onChange={(e) => setTargetHouseholdTableId(e.target.value)}
                className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="" disabled>
                  Select a table...
                </option>
                {tables.map((t) => {
                  const seated = t.invitationCodes?.length || 0;
                  const openSeats = t.capacity - seated;
                  const fits = openSeats >= selectedHouseholdForModal.members.length;
                  return (
                    <option key={t.id} value={t.id} disabled={!fits}>
                      {t.name} ({openSeats} open of {t.capacity}{fits ? '' : ' - insufficient space'})
                    </option>
                  );
                })}
              </select>
            </div>

            {!targetHouseholdTableId && (
              <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded p-2">
                No single table currently has {selectedHouseholdForModal.members.length} open seats.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedHouseholdForModal(null);
                  setTargetHouseholdTableId('');
                }}
                className="min-h-[30px] px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!targetHouseholdTableId}
                className="min-h-[30px] px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                Confirm Household Seating
              </button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Floating Cross-Panel Pointer Drag Chip */}
      {activePointerDrag?.isDragging && (
        <div
          data-testid="guest-drag-chip"
          aria-hidden="true"
          className="fixed pointer-events-none z-50 px-3 py-1.5 rounded-full bg-primary text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${activePointerDrag.clientX}px`,
            top: `${activePointerDrag.clientY}px`,
          }}
        >
          <span>{activePointerDrag.payload.label}</span>
        </div>
      )}
    </div>
  );
});
