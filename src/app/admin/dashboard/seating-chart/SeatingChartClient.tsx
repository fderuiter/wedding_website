'use client';

import { memo, useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import {
  SeatingTableDTO,
  FloorplanCanvas,
  UnassignedGuestPanel,
  TableModal,
  PrintableFloorplan,
  useSeatingState,
  resolveDetailedSeatAssignments,
  resolveSeatAssignments,
  ADDRESS_COLLECTION_TAG,
  computeTableMinBounds,
  getDietaryBadges,
  getGuestAttendanceStatus,
  getGuestCompanionNames,
  getGuestPartySize,
  getGuestPlusOneNamesList,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isGuestEligibleForSeating,
  isLandmarkTable,
  summarizeAttendeeMeals,
} from '@/features/seating';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { EnsureToastProvider, useToast } from '@/components/ui/ToastProvider';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
  formatGuestPlusOneNames,
} from '@/features/registry';
import { withBasePath } from '@/lib/basePath';
import { downloadExportBlob } from '@/utils/exportDownload';

interface SelectedTableInspectorProps {
  table: SeatingTableDTO;
  isPlacementMode: boolean;
  onTogglePlacementMode: (tableId: string) => void;
  onNudgeTable: (table: SeatingTableDTO, dx: number, dy: number) => void;
  onUpdateTableRotation: (tableId: string, rotation: number) => void;
  onUnassignGuest: (guestId: string) => void;
  onClearTableSeats: (tableId: string) => void;
  onEditTable: (table: SeatingTableDTO) => void;
  onRequestDeleteTable: (table: SeatingTableDTO) => void;
}

const SelectedTableInspector = memo(function SelectedTableInspector({
  table,
  isPlacementMode,
  onTogglePlacementMode,
  onNudgeTable,
  onUpdateTableRotation,
  onUnassignGuest,
  onClearTableSeats,
  onEditTable,
  onRequestDeleteTable,
}: SelectedTableInspectorProps) {
  const isLandmark = isLandmarkTable({ shape: table.shape, capacity: table.capacity });

  const detailedSeats = useMemo(() => {
    if (!table.invitationCodes || isLandmark) return [];
    return Array.from(
      resolveDetailedSeatAssignments(table.invitationCodes, table.capacity).values()
    ).sort((a, b) => a.seatNumber - b.seatNumber);
  }, [isLandmark, table.invitationCodes, table.capacity]);

  const seatedHeadcount = useMemo(
    () => (!isLandmark ? getGuestsHeadcount(table.invitationCodes || []) : 0),
    [isLandmark, table.invitationCodes]
  );

  const mealSummary = useMemo(() => {
    if (isLandmark) return null;
    const eligibleEntries = detailedSeats.filter((entry) =>
      isGuestEligibleForSeating(entry.guest)
    );
    return summarizeAttendeeMeals(eligibleEntries);
  }, [isLandmark, detailedSeats]);

  const guestChips = useMemo(() => {
    if (isLandmark || !table.invitationCodes || table.invitationCodes.length === 0) {
      return [];
    }
    const seatsByGuestId = new Map<string, number[]>();
    const plusOneSeatsByGuestId = new Map<
      string,
      Array<{ seatNumber: number; attendeeName: string }>
    >();
    for (const entry of detailedSeats) {
      if (!entry.guest.id) continue;
      const list = seatsByGuestId.get(entry.guest.id);
      if (list) {
        list.push(entry.seatNumber);
      } else {
        seatsByGuestId.set(entry.guest.id, [entry.seatNumber]);
      }
      if (entry.isPlusOne) {
        const poList = plusOneSeatsByGuestId.get(entry.guest.id) ?? [];
        poList.push({ seatNumber: entry.seatNumber, attendeeName: entry.attendeeName });
        plusOneSeatsByGuestId.set(entry.guest.id, poList);
      }
    }

    return table.invitationCodes.map((guest) => {
      const isDeclined = getGuestAttendanceStatus(guest) === 'declined';
      const dietaryBadges = getDietaryBadges(
        guest.dietaryNotes,
        guest.extraFields,
        guest.partyTags
      );
      const companionNames = formatGuestPlusOneNames(guest);
      const mealSelections = formatGuestMealSelections(guest);
      const customAnswers = formatGuestCustomAnswers(guest);
      const visibleTags = (guest.partyTags || []).filter(
        (tag) => tag.trim().toLowerCase() !== ADDRESS_COLLECTION_TAG
      );
      const resolvedSeats = seatsByGuestId.get(guest.id) || [];
      const companions = !isDeclined ? getGuestCompanionNames(guest) : [];
      const seatPrefix =
        resolvedSeats.length > 1
          ? `Seats ${resolvedSeats.join(', ')}`
          : `Seat ${resolvedSeats[0] || guest.seatNumber || '?'}`;
      const plusOneSeats = plusOneSeatsByGuestId.get(guest.id) || [];

      return {
        guest,
        isDeclined,
        dietaryBadges,
        companionNames,
        mealSelections,
        customAnswers,
        visibleTags,
        companions,
        seatPrefix,
        plusOneSeats,
      };
    });
  }, [isLandmark, table.invitationCodes, detailedSeats]);

  const minBounds = useMemo(
    () =>
      computeTableMinBounds({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
      }),
    [table.shape, table.capacity, table.width, table.height, table.rotation]
  );

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 flex-wrap">
          {table.name}
          <span className="text-xs font-normal text-gray-600 dark:text-gray-300">
            {isLandmark
              ? `(Landmark · ${getSeatingShapeLabel(table.shape)}, 0 seats)`
              : `(${table.shape}, ${table.capacity} capacity, ${seatedHeadcount} seated)`}
          </span>
        </h2>
        {!isLandmark && seatedHeadcount > 0 && mealSummary && (
          <p
            data-testid="inspector-meal-summary"
            className="mt-1 text-[11px] font-medium text-gray-700 dark:text-gray-300"
          >
            Entrées: {mealSummary.formattedMeals}
          </p>
        )}
        {isLandmark ? (
          <p className="text-xs text-gray-600 dark:text-gray-300 italic">
            Room landmark fixture — drag or rotate to position on floorplan.
          </p>
        ) : guestChips.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {guestChips.map((chip) => {
              const {
                guest,
                isDeclined,
                dietaryBadges,
                companionNames,
                mealSelections,
                customAnswers,
                visibleTags,
                companions,
                seatPrefix,
                plusOneSeats,
              } = chip;

              return (
                <span
                  key={guest.id}
                  data-testid={isDeclined ? 'inspector-declined-guest-chip' : 'inspector-guest-chip'}
                  className={`inline-flex items-center flex-wrap gap-1 text-[11px] px-2 py-0.5 rounded ${
                    isDeclined
                      ? 'bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                  }`}
                >
                  <span>
                    {seatPrefix}: {guest.guestName}
                    {companions.length > 0 ? ` (+${companions.length}: ${companions.join(', ')})` : ''}
                  </span>
                  {companionNames && (
                    <span
                      data-testid="inspector-companion-names"
                      className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-600/80 text-slate-800 dark:text-slate-100 font-medium"
                    >
                      +1: {companionNames}
                    </span>
                  )}
                  {plusOneSeats.map((po) => (
                    <span
                      key={`${guest.id}-po-${po.seatNumber}`}
                      data-testid="inspector-plus-one-seat"
                      className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-900 dark:bg-indigo-950/80 dark:text-indigo-200 font-semibold"
                    >
                      Seat {po.seatNumber}: {po.attendeeName} (+1)
                    </span>
                  ))}
                  {isDeclined && (
                    <span
                      data-testid="seated-declined-badge"
                      className="text-[9px] px-1.5 py-0.5 rounded bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100 font-bold"
                    >
                      RSVP Declined
                    </span>
                  )}
                  {guest.householdName && (
                    <span className="text-[9px] text-purple-800 dark:text-purple-200 font-semibold ml-0.5">
                      (🏠 {guest.householdName})
                    </span>
                  )}
                  {mealSelections && (
                    <span
                      data-testid="inspector-meal-selections"
                      className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 font-medium"
                    >
                      🍽️ {mealSelections}
                    </span>
                  )}
                  {dietaryBadges.map((badge) => (
                    <span
                      key={badge.category}
                      data-testid="inspector-dietary-badge"
                      title={guest.dietaryNotes ? `${badge.label}: ${guest.dietaryNotes}` : badge.label}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 font-semibold"
                    >
                      🍽️ {badge.shortLabel}
                    </span>
                  ))}
                  {customAnswers && (
                    <span
                      data-testid="inspector-custom-answers"
                      className="text-[9px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-200 border border-sky-200 dark:border-sky-800 font-medium"
                    >
                      💬 {customAnswers}
                    </span>
                  )}
                  {visibleTags.length > 0 && (
                    <span className="text-[9px] text-blue-800 dark:text-blue-200 ml-0.5">
                      [{visibleTags.join(', ')}]
                    </span>
                  )}
                  {isDeclined ? (
                    <button
                      type="button"
                      onClick={() => onUnassignGuest(guest.id)}
                      className="min-h-[24px] px-2 py-0.5 ml-1 text-[10px] font-semibold bg-red-700 hover:bg-red-800 text-white rounded transition-colors"
                      aria-label={`Release seat for declined guest ${guest.guestName}`}
                    >
                      Release Seat
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onUnassignGuest(guest.id)}
                      className="min-w-6 min-h-6 inline-flex items-center justify-center text-gray-700 hover:text-red-700 dark:text-gray-200 dark:hover:text-red-300 font-bold ml-0.5 rounded"
                      title="Unassign guest"
                      aria-label={`Unassign ${guest.guestName}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-600 dark:text-gray-300 italic">No guests assigned to this table yet.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={`Position controls for ${table.name}`}
          data-testid="inspector-position-controls"
          className="flex flex-wrap items-center gap-1 bg-gray-100 dark:bg-gray-700/60 p-1 rounded-lg border border-gray-200 dark:border-gray-600"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNudgeTable(table, -20, 0)}
            aria-label={`Nudge ${table.name} left`}
            title="Nudge left (20px)"
            className="!h-7 !w-7 min-w-[28px] min-h-[28px] !p-0 text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
          >
            <Icon name="ArrowLeft" size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNudgeTable(table, 0, -20)}
            aria-label={`Nudge ${table.name} up`}
            title="Nudge up (20px)"
            className="!h-7 !w-7 min-w-[28px] min-h-[28px] !p-0 text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
          >
            <Icon name="ArrowUp" size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNudgeTable(table, 0, 20)}
            aria-label={`Nudge ${table.name} down`}
            title="Nudge down (20px)"
            className="!h-7 !w-7 min-w-[28px] min-h-[28px] !p-0 text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
          >
            <Icon name="ArrowDown" size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNudgeTable(table, 20, 0)}
            aria-label={`Nudge ${table.name} right`}
            title="Nudge right (20px)"
            className="!h-7 !w-7 min-w-[28px] min-h-[28px] !p-0 text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
          >
            <Icon name="ArrowRight" size={14} />
          </Button>
          <span
            data-testid="inspector-coordinates"
            className="px-1.5 font-mono text-[11px] font-semibold text-gray-700 dark:text-gray-200"
          >
            X: {Math.round(Math.max(minBounds.minX, table.x))}, Y: {Math.round(Math.max(minBounds.minY, table.y))}
          </span>
          <Button
            type="button"
            variant={isPlacementMode ? 'primary' : 'outline'}
            size="sm"
            pressed={isPlacementMode}
            srContext={`for ${table.name}`}
            onClick={() => onTogglePlacementMode(table.id)}
            title="Toggle click-to-place mode on floorplan"
            className="!h-7 min-h-[28px] !px-2.5 !py-0.5 !text-[11px]"
          >
            Place Table
          </Button>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 p-1 rounded-lg border border-gray-200 dark:border-gray-600">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const current = table.rotation || 0;
              const next = (current - 45 + 360) % 360;
              onUpdateTableRotation(table.id, next);
            }}
            srContext={`for ${table.name}`}
            className="!h-7 min-w-[32px] min-h-[28px] !px-2 !py-0.5 !text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
            title="Rotate -45°"
          >
            -45°
          </Button>
          <span className="px-1.5 font-mono text-xs font-bold text-primary">
            {table.rotation || 0}°
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const current = table.rotation || 0;
              const next = (current + 45) % 360;
              onUpdateTableRotation(table.id, next);
            }}
            srContext={`for ${table.name}`}
            className="!h-7 min-w-[32px] min-h-[28px] !px-2 !py-0.5 !text-xs font-semibold text-gray-800 dark:text-gray-100 hover:bg-white dark:hover:bg-gray-600"
            title="Rotate +45°"
          >
            +45°
          </Button>
        </div>
        {!isLandmark && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="clear-table-seats-button"
            onClick={() => onClearTableSeats(table.id)}
            disabled={(table.invitationCodes?.length || 0) === 0}
            className="!h-8 min-h-[30px] !px-3 !py-1.5 !text-xs font-medium !bg-amber-50 !text-amber-900 dark:!bg-amber-950/50 dark:!text-amber-200 hover:!bg-amber-100 !border-amber-300 dark:!border-amber-700"
          >
            Clear Seats
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onEditTable(table)}
          className="!h-8 min-h-[30px] !px-3 !py-1.5 !text-xs font-medium"
        >
          Edit Properties
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => {
            onRequestDeleteTable(table);
          }}
          className="!h-8 min-h-[30px] !px-3 !py-1.5 !text-xs font-medium"
        >
          Delete Table
        </Button>
      </div>
    </div>
  );
});

function SeatingChartAdminContent() {
  const { confirm, addToast } = useToast();
  const {
    tables,
    allGuests,
    unassignedGuests,
    isLoading,
    errorMsg,
    statusAnnouncement,
    canUndo,
    undoLabel,
    assignGuestToTable: handleAssignGuestToTable,
    assignGuestsToTable: handleAssignGuestsToTable,
    unassignGuest: handleUnassignGuest,
    clearTableSeats: handleClearTableSeats,
    undoLastBatchAction: handleUndoLastBatchAction,
    applyAutoAssignResult,
    saveTable,
    deleteTable,
    updateTablePosition: handleUpdateTablePosition,
    updateTableRotation: handleUpdateTableRotation,
  } = useSeatingState();

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [placementTableId, setPlacementTableId] = useState<string | null>(null);
  const [announcementOverride, setAnnouncementOverride] = useState<{
    sourceStatus: string;
    text: string;
  } | null>(null);
  const politeAnnouncement =
    announcementOverride && announcementOverride.sourceStatus === statusAnnouncement
      ? announcementOverride.text
      : statusAnnouncement;
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<SeatingTableDTO | null>(null);
  const [assignSeatTarget, setAssignSeatTarget] = useState<{ tableId: string; seatNumber: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedTableIdRef = useRef(selectedTableId);
  useLayoutEffect(() => {
    selectedTableIdRef.current = selectedTableId;
  }, [selectedTableId]);

  const isPlacementMode = Boolean(selectedTableId && placementTableId === selectedTableId);

  const nudgeSelectedTableBy = useCallback(
    (table: SeatingTableDTO, dx: number, dy: number) => {
      const { minX, minY } = computeTableMinBounds({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: table.rotation,
      });
      const baseX = Math.max(minX, table.x);
      const baseY = Math.max(minY, table.y);
      const nextX = Math.max(minX, Math.round(baseX + dx));
      const nextY = Math.max(minY, Math.round(baseY + dy));
      handleUpdateTablePosition(table.id, nextX, nextY);
      setAnnouncementOverride({
        sourceStatus: statusAnnouncement,
        text: `${table.name} moved to X ${nextX}, Y ${nextY}.`,
      });
    },
    [handleUpdateTablePosition, statusAnnouncement]
  );

  // Compute search matching stats with memoization (excluding unseated ineligible records)
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const { matchingGuestCount, matchingUnassignedCount, matchingSeatedCount } = useMemo(() => {
    if (!isSearching) {
      return {
        matchingGuests: [] as InvitationCodeDTO[],
        matchingGuestCount: 0,
        matchingUnassignedCount: 0,
        matchingSeatedCount: 0,
      };
    }

    const matches = allGuests.filter((g) => {
      if (!g.tableId && !isGuestEligibleForSeating(g)) {
        return false;
      }
      return (
        g.guestName.toLowerCase().includes(normalizedQuery) ||
        getGuestPlusOneNamesList(g).some((n) => n.toLowerCase().includes(normalizedQuery)) ||
        formatGuestPlusOneNames(g).toLowerCase().includes(normalizedQuery) ||
        (g.code ? g.code.toLowerCase().includes(normalizedQuery) : false) ||
        (g.householdName && g.householdName.toLowerCase().includes(normalizedQuery)) ||
        (g.partyGroup && g.partyGroup.toLowerCase().includes(normalizedQuery)) ||
        (g.dietaryNotes && g.dietaryNotes.toLowerCase().includes(normalizedQuery)) ||
        (g.partyTags && g.partyTags.some((t) => t.toLowerCase().includes(normalizedQuery))) ||
        formatGuestMealSelections(g).toLowerCase().includes(normalizedQuery) ||
        formatGuestCustomAnswers(g).toLowerCase().includes(normalizedQuery)
      );
    });

    const totalCount = matches.length;
    const unassignedCount = matches.filter((g) => !g.tableId).length;
    const seatedCount = totalCount - unassignedCount;

    return {
      matchingGuests: matches,
      matchingGuestCount: totalCount,
      matchingUnassignedCount: unassignedCount,
      matchingSeatedCount: seatedCount,
    };
  }, [allGuests, isSearching, normalizedQuery]);

  // Detect any currently seated guest whose RSVP status has changed to 'declined'
  const declinedSeatedGuests = useMemo(() => {
    const flagged: Array<{ guest: InvitationCodeDTO; tableId: string; tableName: string; resolvedSeat?: number }> = [];
    for (const table of tables) {
      const codes = table.invitationCodes;
      if (!codes || codes.length === 0) continue;

      const hasDeclined = codes.some((guest) => getGuestAttendanceStatus(guest) === 'declined');
      if (!hasDeclined) continue;

      const seatMap = resolveSeatAssignments(codes, table.capacity);
      const guestSeatLookup = new Map<string, number>();
      seatMap.forEach((g, seatNum) => {
        if (g.id) guestSeatLookup.set(g.id, seatNum);
      });
      for (const guest of codes) {
        if (getGuestAttendanceStatus(guest) === 'declined') {
          flagged.push({
            guest,
            tableId: table.id,
            tableName: table.name,
            resolvedSeat: guest.seatNumber || guestSeatLookup.get(guest.id),
          });
        }
      }
    }
    return flagged;
  }, [tables]);

  // Table CRUD & FloorplanCanvas handlers (memoized to preserve FloorplanCanvas React.memo)
  const handleCreateTable = useCallback(() => {
    setEditingTable(null);
    setIsTableModalOpen(true);
  }, []);

  const handleEditTable = useCallback((table: SeatingTableDTO) => {
    setEditingTable(table);
    setIsTableModalOpen(true);
  }, []);

  const handleSaveTable = useCallback(
    async (tableData: Partial<SeatingTableDTO>) => {
      await saveTable(tableData);
    },
    [saveTable]
  );

  const handleDeleteTableConfirmed = useCallback(
    async (tableId: string) => {
      setSelectedTableId(null);
      await deleteTable(tableId);
    },
    [deleteTable]
  );

  const handleOpenSeatAssignModal = useCallback((tableId: string, seatNumber: number) => {
    setAssignSeatTarget({ tableId, seatNumber });
  }, []);

  const handlePlacementModeChange = useCallback((active: boolean) => {
    setPlacementTableId(active ? selectedTableIdRef.current : null);
  }, []);

  const handleTogglePlacementTable = useCallback((tableId: string) => {
    setPlacementTableId((prev) => (prev === tableId ? null : tableId));
  }, []);

  const handleRequestDeleteTable = useCallback(
    async (table: SeatingTableDTO) => {
      const seatedGuests = table.invitationCodes || [];
      if (seatedGuests.length > 0) {
        const seatedHeadcount = getGuestsHeadcount(seatedGuests);
        const confirmed = await confirm(
          `Are you sure you want to delete "${table.name}"? ${seatedHeadcount} seated guest${seatedHeadcount === 1 ? '' : 's'} will become unassigned.`
        );
        if (!confirmed) {
          return;
        }
      }
      await handleDeleteTableConfirmed(table.id);
    },
    [confirm, handleDeleteTableConfirmed]
  );

  const handleRequestDeleteTableSync = useCallback(
    (table: SeatingTableDTO) => {
      void handleRequestDeleteTable(table);
    },
    [handleRequestDeleteTable]
  );

  const selectedTable = tables.find((t) => t.id === selectedTableId) || null;

  return (
    <div className="space-y-6">
      {/* Printable view (visible only during print) */}
      <PrintableFloorplan tables={tables} unassignedGuests={unassignedGuests} />

      {/* Screen Dashboard View */}
      <div className="print:hidden space-y-6">
        {/* Header Actions & Stats */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Interactive Seating Chart & Reception Floorplan
            </h1>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Configure reception tables, drag to position on hall floorplan, and assign guests to seats.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={handleCreateTable}
              className="px-3.5 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Table
            </button>

            <button
              type="button"
              data-testid="seating-undo-button"
              onClick={() => handleUndoLastBatchAction()}
              disabled={!canUndo}
              title={undoLabel ? `Undo ${undoLabel}` : 'Undo last batch seating action'}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Undo
            </button>

            <a
              href={withBasePath('/api/admin/seating/export?format=pdf')}
              download="seating-chart.pdf"
              onClick={(e) => {
                e.preventDefault();
                void downloadExportBlob('/api/admin/seating/export?format=pdf', 'seating-chart.pdf')
                  .then(() => addToast('Visual seating chart PDF exported successfully.', 'success'))
                  .catch((err: unknown) =>
                    addToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Failed to export visual seating chart PDF.',
                      'error'
                    )
                  );
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Export Visual PDF
            </a>

            <a
              href={withBasePath('/api/admin/seating/export')}
              download
              onClick={(e) => {
                e.preventDefault();
                void downloadExportBlob('/api/admin/seating/export', 'seating-roster.csv')
                  .then(() => addToast('Seating roster CSV exported successfully.', 'success'))
                  .catch((err: unknown) =>
                    addToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Failed to export seating roster CSV.',
                      'error'
                    )
                  );
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </a>

            <a
              href={withBasePath('/api/admin/seating/export?format=meals')}
              download
              onClick={(e) => {
                e.preventDefault();
                void downloadExportBlob('/api/admin/seating/export?format=meals', 'seating-meal-counts.csv')
                  .then(() => addToast('Meal counts CSV exported successfully.', 'success'))
                  .catch((err: unknown) =>
                    addToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Failed to export meal counts CSV.',
                      'error'
                    )
                  );
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Meal Counts CSV
            </a>

            <a
              href={withBasePath('/api/admin/seating/export?format=place-cards')}
              download="seating-place-cards.pdf"
              onClick={(e) => {
                e.preventDefault();
                void downloadExportBlob(
                  '/api/admin/seating/export?format=place-cards',
                  'seating-place-cards.pdf'
                )
                  .then(() => addToast('Place cards PDF exported successfully.', 'success'))
                  .catch((err: unknown) =>
                    addToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Failed to export place cards PDF.',
                      'error'
                    )
                  );
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
              Place Cards PDF
            </a>

            <a
              href={withBasePath('/api/admin/seating/export?format=escort-cards')}
              download="seating-escort-cards.pdf"
              onClick={(e) => {
                e.preventDefault();
                void downloadExportBlob(
                  '/api/admin/seating/export?format=escort-cards',
                  'seating-escort-cards.pdf'
                )
                  .then(() => addToast('Escort cards PDF exported successfully.', 'success'))
                  .catch((err: unknown) =>
                    addToast(
                      err instanceof Error && err.message
                        ? err.message
                        : 'Failed to export escort cards PDF.',
                      'error'
                    )
                  );
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2zm4 4h10M7 15h6" />
              </svg>
              Escort Cards PDF
            </a>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Floorplan
            </button>
          </div>
        </div>

        {/* Flagged Declined Seated Guests Alert Banner */}
        {declinedSeatedGuests.length > 0 && (
          <div
            data-testid="declined-seated-alert"
            role="status"
            className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <p className="text-xs font-bold text-red-900 dark:text-red-200">
                {declinedSeatedGuests.length} seated guest{declinedSeatedGuests.length === 1 ? ' has' : 's have'} declined RSVP
              </p>
              <div className="flex flex-wrap gap-2">
                {declinedSeatedGuests.map(({ guest, tableId, tableName, resolvedSeat }) => (
                  <span
                    key={guest.id}
                    className="inline-flex items-center gap-1.5 text-xs bg-white dark:bg-gray-900 px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTableId(tableId)}
                      className="min-h-[24px] font-semibold underline hover:no-underline"
                    >
                      {guest.guestName} ({tableName}, Seat {resolvedSeat || '?'})
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnassignGuest(guest.id)}
                      className="min-h-[24px] px-2 py-0.5 text-[11px] font-semibold bg-red-700 hover:bg-red-800 text-white rounded transition-colors"
                      aria-label={`Release seat for ${guest.guestName} from ${tableName}`}
                    >
                      Release Seat
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Global Guest Search Control Bar */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <label htmlFor="global-guest-search" className="sr-only">
              Search all guests across floorplan and unassigned list
            </label>
            <div className="relative">
              <Input
                id="global-guest-search"
                type="text"
                sizeVariant="compact"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guest name or code across floorplan..."
                className="!pl-9 !pr-9 !py-2 !text-xs"
              />
              <Icon
                name="Search"
                size={16}
                className="text-muted-text absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              />
              {searchQuery && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                  className="absolute right-1 top-1/2 -translate-y-1/2 !h-7 !w-7 min-w-6 min-h-6 !p-0 text-muted-text hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <Icon name="X" size={14} />
                </Button>
              )}
            </div>
          </div>

          {/* Search Result Match Summary */}
          {isSearching && (
            <div className="flex items-center gap-2 text-xs" aria-live="polite">
              {matchingGuestCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Found {matchingGuestCount} match{matchingGuestCount === 1 ? '' : 'es'} ({matchingSeatedCount} seated, {matchingUnassignedCount} unassigned)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
                  No guests match &ldquo;{searchQuery}&rdquo;
                </span>
              )}
            </div>
          )}
        </div>

        {isLoading && (
          <div className="p-4 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
            Loading floorplan tables and guest list...
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl">
            {errorMsg}
          </div>
        )}

        {/* Main Grid Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Unassigned Guest Drawer / Panel */}
          <div className="lg:col-span-1">
            <UnassignedGuestPanel
              unassignedGuests={unassignedGuests}
              tables={tables}
              onAssignGuestToTable={handleAssignGuestToTable}
              onAssignGuestsToTable={handleAssignGuestsToTable}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onAutoAssignComplete={applyAutoAssignResult}
            />
          </div>

          {/* Interactive 2D Floorplan Canvas Area */}
          <div className="lg:col-span-3 space-y-4">
            <div
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="seating-status-live-region"
            >
              {politeAnnouncement}
            </div>
            <FloorplanCanvas
              tables={tables}
              guests={allGuests}
              selectedTableId={selectedTableId}
              onSelectTable={setSelectedTableId}
              onUpdateTablePosition={handleUpdateTablePosition}
              onUpdateTableRotation={handleUpdateTableRotation}
              onDropGuestOnTable={handleAssignGuestToTable}
              onDropGuestsOnTable={handleAssignGuestsToTable}
              onUnassignGuest={handleUnassignGuest}
              searchQuery={searchQuery}
              onOpenSeatAssignModal={handleOpenSeatAssignModal}
              onAddTable={handleCreateTable}
              placementMode={isPlacementMode}
              onPlacementModeChange={handlePlacementModeChange}
            />

            {/* Selected Table Inspector Bar */}
            {selectedTable && (
              <SelectedTableInspector
                table={selectedTable}
                isPlacementMode={isPlacementMode}
                onTogglePlacementMode={handleTogglePlacementTable}
                onNudgeTable={nudgeSelectedTableBy}
                onUpdateTableRotation={handleUpdateTableRotation}
                onUnassignGuest={handleUnassignGuest}
                onClearTableSeats={handleClearTableSeats}
                onEditTable={handleEditTable}
                onRequestDeleteTable={handleRequestDeleteTableSync}
              />
            )}
          </div>
        </div>
      </div>

      {/* Table Edit/Create Modal */}
      <TableModal
        isOpen={isTableModalOpen}
        table={editingTable}
        onClose={() => setIsTableModalOpen(false)}
        onSave={handleSaveTable}
        onDelete={handleDeleteTableConfirmed}
      />

      {/* Target Seat Assignment Modal */}
      <Dialog
        isOpen={Boolean(assignSeatTarget)}
        onClose={() => setAssignSeatTarget(null)}
        title={
          assignSeatTarget
            ? `Assign Guest to ${tables.find((t) => t.id === assignSeatTarget.tableId)?.name || 'Table'} (Seat ${assignSeatTarget.seatNumber})`
            : undefined
        }
        className="max-w-sm w-full"
      >
        {assignSeatTarget && (
          unassignedGuests.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                All guests have already been assigned to tables.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setAssignSeatTarget(null)}
                  className="min-h-[30px] px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (() => {
            const modalTable = tables.find((t) => t.id === assignSeatTarget.tableId);
            const openSeats = modalTable
              ? Math.max(0, modalTable.capacity - getGuestsHeadcount(modalTable.invitationCodes || []))
              : Infinity;
            const firstFittingGuest = unassignedGuests.find((g) => getGuestPartySize(g) <= openSeats);

            return (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const guestId = formData.get('guestId') as string;
                  if (guestId && assignSeatTarget) {
                    handleAssignGuestToTable(guestId, assignSeatTarget.tableId, assignSeatTarget.seatNumber);
                    setAssignSeatTarget(null);
                  }
                }}
                className="space-y-3"
              >
                <div>
                  <label htmlFor="modal-assign-guest" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Select Guest
                  </label>
                  <select
                    id="modal-assign-guest"
                    name="guestId"
                    required
                    defaultValue={firstFittingGuest?.id || unassignedGuests[0]?.id || ''}
                    className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  >
                    {unassignedGuests.map((g) => {
                      const pSize = getGuestPartySize(g);
                      const plusOneNames = getGuestPlusOneNamesList(g);
                      const fits = pSize <= openSeats;
                      return (
                        <option key={g.id} value={g.id} disabled={!fits}>
                          {g.guestName}
                          {plusOneNames.length > 0 ? ` (+1: ${plusOneNames.join(', ')})` : ''}
                          {pSize > 1 ? ` — ${pSize} seats` : ''}
                          {!fits ? ' (insufficient open seats)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAssignSeatTarget(null)}
                    className="min-h-[30px] px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!firstFittingGuest}
                    className="min-h-[30px] px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    Assign Guest
                  </button>
                </div>
              </form>
            );
          })()
        )}
      </Dialog>
    </div>
  );
}

export default function SeatingChartAdminPage() {
  return (
    <EnsureToastProvider>
      <SeatingChartAdminContent />
    </EnsureToastProvider>
  );
}
