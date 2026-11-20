'use client';

import { useState, useMemo } from 'react';
import {
  SeatingTableDTO,
  FloorplanCanvas,
  UnassignedGuestPanel,
  TableModal,
  PrintableFloorplan,
  useSeatingState,
  ADDRESS_COLLECTION_TAG,
  getDietaryBadges,
  getGuestAttendanceStatus,
  isGuestEligibleForSeating,
} from '@/features/seating';
import { Dialog } from '@/components/ui/Dialog';
import { InvitationCodeDTO } from '@/features/registry';

export default function SeatingChartAdminPage() {
  const {
    tables,
    allGuests,
    unassignedGuests,
    isLoading,
    errorMsg,
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
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<SeatingTableDTO | null>(null);
  const [assignSeatTarget, setAssignSeatTarget] = useState<{ tableId: string; seatNumber: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
        (g.code ? g.code.toLowerCase().includes(normalizedQuery) : false) ||
        (g.householdName && g.householdName.toLowerCase().includes(normalizedQuery)) ||
        (g.partyGroup && g.partyGroup.toLowerCase().includes(normalizedQuery)) ||
        (g.partyTags && g.partyTags.some((t) => t.toLowerCase().includes(normalizedQuery)))
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
    const flagged: Array<{ guest: InvitationCodeDTO; tableId: string; tableName: string }> = [];
    for (const table of tables) {
      for (const guest of table.invitationCodes || []) {
        if (getGuestAttendanceStatus(guest) === 'declined') {
          flagged.push({ guest, tableId: table.id, tableName: table.name });
        }
      }
    }
    return flagged;
  }, [tables]);

  // Table CRUD handlers
  const handleCreateTable = () => {
    setEditingTable(null);
    setIsTableModalOpen(true);
  };

  const handleEditTable = (table: SeatingTableDTO) => {
    setEditingTable(table);
    setIsTableModalOpen(true);
  };

  const handleSaveTable = async (tableData: Partial<SeatingTableDTO>) => {
    await saveTable(tableData);
  };

  const handleDeleteTable = async (tableId: string) => {
    setSelectedTableId(null);
    await deleteTable(tableId);
  };

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
              href="/api/admin/seating/export?format=pdf"
              download="seating-chart.pdf"
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Export Visual PDF
            </a>

            <a
              href="/api/admin/seating/export"
              download
              className="px-3.5 py-2 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
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
                {declinedSeatedGuests.map(({ guest, tableId, tableName }) => (
                  <span
                    key={guest.id}
                    className="inline-flex items-center gap-1.5 text-xs bg-white dark:bg-gray-900 px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTableId(tableId)}
                      className="min-h-[24px] font-semibold underline hover:no-underline"
                    >
                      {guest.guestName} ({tableName}, Seat {guest.seatNumber || '?'})
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
              <input
                id="global-guest-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guest name or code across floorplan..."
                className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              />
              <svg
                className="w-4 h-4 text-gray-400 absolute left-3 top-2.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1.5 w-6 h-6 inline-flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 font-bold text-xs rounded"
                  aria-label="Clear search query"
                >
                  ×
                </button>
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
            <FloorplanCanvas
              tables={tables}
              selectedTableId={selectedTableId}
              onSelectTable={setSelectedTableId}
              onUpdateTablePosition={handleUpdateTablePosition}
              onUpdateTableRotation={handleUpdateTableRotation}
              onDropGuestOnTable={handleAssignGuestToTable}
              onDropGuestsOnTable={handleAssignGuestsToTable}
              onUnassignGuest={handleUnassignGuest}
              searchQuery={searchQuery}
              onOpenSeatAssignModal={(tableId, seatNumber) => setAssignSeatTarget({ tableId, seatNumber })}
              onAddTable={handleCreateTable}
            />

            {/* Selected Table Inspector Bar */}
            {selectedTable && (
              <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {selectedTable.name}
                    <span className="text-xs font-normal text-gray-600 dark:text-gray-300">
                      ({selectedTable.shape}, {selectedTable.capacity} capacity, {selectedTable.invitationCodes?.length || 0} seated)
                    </span>
                  </h3>
                  {selectedTable.invitationCodes && selectedTable.invitationCodes.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedTable.invitationCodes.map((guest) => {
                        const isDeclined = getGuestAttendanceStatus(guest) === 'declined';
                        const dietaryBadges = getDietaryBadges(guest.dietaryNotes);
                        const visibleTags = (guest.partyTags || []).filter(
                          (tag) => tag.trim().toLowerCase() !== ADDRESS_COLLECTION_TAG
                        );

                        return (
                          <span
                            key={guest.id}
                            data-testid={isDeclined ? 'inspector-declined-guest-chip' : 'inspector-guest-chip'}
                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${
                              isDeclined
                                ? 'bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                            }`}
                          >
                            <span>
                              Seat {guest.seatNumber || '?'}: {guest.guestName}
                            </span>
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
                            {dietaryBadges.map((badge) => (
                              <span
                                key={badge.category}
                                data-testid="inspector-dietary-badge"
                                title={`${badge.label}: ${guest.dietaryNotes}`}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 font-semibold"
                              >
                                🍽️ {badge.shortLabel}
                              </span>
                            ))}
                            {visibleTags.length > 0 && (
                              <span className="text-[9px] text-blue-800 dark:text-blue-200 ml-0.5">
                                [{visibleTags.join(', ')}]
                              </span>
                            )}
                            {isDeclined ? (
                              <button
                                type="button"
                                onClick={() => handleUnassignGuest(guest.id)}
                                className="min-h-[24px] px-2 py-0.5 ml-1 text-[10px] font-semibold bg-red-700 hover:bg-red-800 text-white rounded transition-colors"
                                aria-label={`Release seat for declined guest ${guest.guestName}`}
                              >
                                Release Seat
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleUnassignGuest(guest.id)}
                                className="min-w-[24px] min-h-[24px] inline-flex items-center justify-center text-gray-500 hover:text-red-600 font-bold ml-0.5 rounded"
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
                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/60 p-1 rounded-lg border border-gray-200 dark:border-gray-600">
                    <button
                      type="button"
                      onClick={() => {
                        const current = selectedTable.rotation || 0;
                        const next = (current - 45 + 360) % 360;
                        handleUpdateTableRotation(selectedTable.id, next);
                      }}
                      className="min-w-[32px] min-h-[26px] px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded shadow-2xs"
                      title="Rotate -45°"
                    >
                      -45°
                    </button>
                    <span className="px-1.5 font-mono text-xs font-bold text-primary">
                      {selectedTable.rotation || 0}°
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const current = selectedTable.rotation || 0;
                        const next = (current + 45) % 360;
                        handleUpdateTableRotation(selectedTable.id, next);
                      }}
                      className="min-w-[32px] min-h-[26px] px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded shadow-2xs"
                      title="Rotate +45°"
                    >
                      +45°
                    </button>
                  </div>
                  <button
                    type="button"
                    data-testid="clear-table-seats-button"
                    onClick={() => handleClearTableSeats(selectedTable.id)}
                    disabled={(selectedTable.invitationCodes?.length || 0) === 0}
                    className="min-h-[30px] px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 hover:bg-amber-100 rounded-lg border border-amber-300 dark:border-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear Seats
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEditTable(selectedTable)}
                    className="min-h-[30px] px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Edit Properties
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTable(selectedTable.id)}
                    className="min-h-[30px] px-3 py-1.5 text-xs font-medium bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300 hover:bg-red-100 rounded-lg border border-red-200"
                  >
                    Delete Table
                  </button>
                </div>
              </div>
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
        onDelete={handleDeleteTable}
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
          ) : (
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
                  defaultValue={unassignedGuests[0]?.id || ''}
                  className="w-full min-h-[32px] px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {unassignedGuests.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.guestName} ({g.code})
                    </option>
                  ))}
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
                  className="min-h-[30px] px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90"
                >
                  Assign Guest
                </button>
              </div>
            </form>
          )
        )}
      </Dialog>
    </div>
  );
}
