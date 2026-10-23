'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SeatingTableDTO } from '@/features/seating/schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';
import { FloorplanCanvas } from '@/features/seating/components/FloorplanCanvas';
import { UnassignedGuestPanel } from '@/features/seating/components/UnassignedGuestPanel';
import { TableModal } from '@/features/seating/components/TableModal';
import { PrintableFloorplan } from '@/features/seating/components/PrintableFloorplan';

export default function SeatingChartAdminPage() {
  const [tables, setTables] = useState<SeatingTableDTO[]>([]);
  const [allGuests, setAllGuests] = useState<InvitationCodeDTO[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<SeatingTableDTO | null>(null);
  const [assignSeatTarget, setAssignSeatTarget] = useState<{ tableId: string; seatNumber: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Helper to sync tables' nested invitationCodes with allGuests state in a single pass O(G + T)
  const syncTablesWithGuests = useCallback(
    (tablesList: SeatingTableDTO[], guestsList: InvitationCodeDTO[]): SeatingTableDTO[] => {
      const guestsByTableMap = new Map<string, InvitationCodeDTO[]>();
      for (const guest of guestsList) {
        if (guest.tableId) {
          const existing = guestsByTableMap.get(guest.tableId);
          if (existing) {
            existing.push(guest);
          } else {
            guestsByTableMap.set(guest.tableId, [guest]);
          }
        }
      }

      return tablesList.map((t) => {
        const assigned = guestsByTableMap.get(t.id) ? [...guestsByTableMap.get(t.id)!] : [];
        assigned.sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
        return {
          ...t,
          invitationCodes: assigned,
        };
      });
    },
    []
  );

  // Fetch tables & invitation codes
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [tablesRes, guestsRes] = await Promise.all([
        fetch('/api/admin/seating-tables'),
        fetch('/api/admin/invitation-codes'),
      ]);

      if (!tablesRes.ok || !guestsRes.ok) {
        throw new Error('Failed to load seating chart data.');
      }

      const tablesData = await tablesRes.json();
      const guestsData = await guestsRes.json();

      const rawTables = Array.isArray(tablesData) ? tablesData : [];
      const rawGuests = Array.isArray(guestsData) ? guestsData : [];

      setAllGuests(rawGuests);
      setTables(syncTablesWithGuests(rawTables, rawGuests));
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while loading data.');
    } finally {
      setIsLoading(false);
    }
  }, [syncTablesWithGuests]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derive unassigned guests with memoization
  const unassignedGuests = useMemo(() => {
    return allGuests.filter((g) => !g.tableId);
  }, [allGuests]);

  // Compute search matching stats with memoization
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

    const matches = allGuests.filter(
      (g) =>
        g.guestName.toLowerCase().includes(normalizedQuery) ||
        g.code.toLowerCase().includes(normalizedQuery) ||
        (g.householdName && g.householdName.toLowerCase().includes(normalizedQuery)) ||
        (g.partyTags && g.partyTags.some((t) => t.toLowerCase().includes(normalizedQuery)))
    );

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
    try {
      if (tableData.id) {
        // Update existing table
        const res = await fetch(`/api/admin/seating-tables/${tableData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tableData),
        });
        if (!res.ok) throw new Error('Failed to update table');
        const updatedTable: SeatingTableDTO = await res.json();
        setTables((prev) => {
          const nextTables = prev.map((t) =>
            t.id === updatedTable.id ? { ...t, ...updatedTable } : t
          );
          return syncTablesWithGuests(nextTables, allGuests);
        });
      } else {
        // Create new table with default offset coordinates
        const defaultX = (tables.length % 4) * 180 + 40;
        const defaultY = Math.floor(tables.length / 4) * 180 + 40;
        const res = await fetch('/api/admin/seating-tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x: defaultX,
            y: defaultY,
            shape: 'round',
            capacity: 8,
            width: 120,
            height: 120,
            rotation: 0,
            ...tableData,
          }),
        });
        if (!res.ok) throw new Error('Failed to create table');
        const createdTable: SeatingTableDTO = await res.json();
        setTables((prev) =>
          syncTablesWithGuests([...prev, { ...createdTable, invitationCodes: [] }], allGuests)
        );
      }
    } catch (err: any) {
      alert(err.message || 'Error saving table');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    const previousTables = tables;
    const previousGuests = allGuests;

    // Optimistically remove table and unassign affected guests in local memory
    const nextGuests = allGuests.map((g) =>
      g.tableId === tableId ? { ...g, tableId: null, seatNumber: null } : g
    );
    const nextTables = tables.filter((t) => t.id !== tableId);

    setAllGuests(nextGuests);
    setTables(syncTablesWithGuests(nextTables, nextGuests));
    setSelectedTableId(null);

    try {
      const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete table');
    } catch (err: any) {
      setAllGuests(previousGuests);
      setTables(previousTables);
      alert(err.message || 'Error deleting table');
    }
  };

  const handleUpdateTablePosition = async (tableId: string, x: number, y: number) => {
    const previousTables = tables;

    // Optimistic update local state
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, x, y } : t))
    );

    // Persist position update
    try {
      const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
      if (!res.ok) throw new Error('Failed to update table position');
    } catch (e) {
      // Revert if error
      setTables(previousTables);
    }
  };

  const handleUpdateTableRotation = async (tableId: string, rotation: number) => {
    const previousTables = tables;

    // Optimistic update local state
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, rotation } : t))
    );

    // Persist rotation update
    try {
      const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation }),
      });
      if (!res.ok) throw new Error('Failed to update table rotation');
    } catch (e) {
      // Revert if error
      setTables(previousTables);
    }
  };

  // Seat assignment handlers
  const handleAssignGuestToTable = async (
    guestId: string,
    tableId: string | null,
    seatNumber?: number | null
  ) => {
    const previousGuests = allGuests;
    const previousTables = tables;

    const targetTableId = tableId || null;
    const targetSeatNumber = targetTableId ? (seatNumber ?? null) : null;

    // Optimistically update local guest state, accounting for seat swap side-effects
    const optimisticGuests = allGuests.map((g) => {
      if (g.id === guestId) {
        return { ...g, tableId: targetTableId, seatNumber: targetSeatNumber };
      }
      if (
        targetTableId &&
        targetSeatNumber &&
        g.tableId === targetTableId &&
        g.seatNumber === targetSeatNumber
      ) {
        return { ...g, seatNumber: null };
      }
      return g;
    });

    setAllGuests(optimisticGuests);
    setTables(syncTablesWithGuests(tables, optimisticGuests));

    try {
      const res = await fetch('/api/admin/seating/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: guestId,
          tableId: targetTableId,
          seatNumber: targetSeatNumber,
        }),
      });

      if (!res.ok) throw new Error('Failed to assign guest seat');

      const returnedGuest: InvitationCodeDTO = await res.json();
      if (returnedGuest && returnedGuest.id) {
        setAllGuests((currentGuests) => {
          const mergedGuests = currentGuests.map((g) =>
            g.id === returnedGuest.id ? { ...g, ...returnedGuest } : g
          );
          setTables((currentTables) => syncTablesWithGuests(currentTables, mergedGuests));
          return mergedGuests;
        });
      }
    } catch (err: any) {
      setAllGuests(previousGuests);
      setTables(previousTables);
      alert(err.message || 'Error assigning guest seat');
    }
  };

  const handleUnassignGuest = async (guestId: string) => {
    await handleAssignGuestToTable(guestId, null);
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Configure reception tables, drag to position on hall floorplan, and assign guests to seats.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={handleCreateTable}
              className="px-3.5 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Table
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
                  className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-bold text-xs"
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
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
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
                    <span className="text-xs font-normal text-gray-500">
                      ({selectedTable.shape}, {selectedTable.capacity} capacity, {selectedTable.invitationCodes?.length || 0} seated)
                    </span>
                  </h3>
                  {selectedTable.invitationCodes && selectedTable.invitationCodes.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {selectedTable.invitationCodes.map((guest) => (
                        <span
                          key={guest.id}
                          className="inline-flex items-center gap-1 text-[11px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-700 dark:text-gray-200"
                        >
                          Seat {guest.seatNumber || '?'}: {guest.guestName}
                          {guest.householdName && (
                            <span className="text-[9px] text-purple-600 dark:text-purple-300 font-semibold ml-0.5">
                              (🏠 {guest.householdName})
                            </span>
                          )}
                          {guest.partyTags && guest.partyTags.length > 0 && (
                            <span className="text-[9px] text-blue-600 dark:text-blue-300 ml-0.5">
                              [{guest.partyTags.join(', ')}]
                            </span>
                          )}
                          <button
                            onClick={() => handleUnassignGuest(guest.id)}
                            className="text-gray-400 hover:text-red-600 font-bold ml-1"
                            title="Unassign guest"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No guests assigned to this table yet.</p>
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
                      className="px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded shadow-2xs"
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
                      className="px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-600 rounded shadow-2xs"
                      title="Rotate +45°"
                    >
                      +45°
                    </button>
                  </div>
                  <button
                    onClick={() => handleEditTable(selectedTable)}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Edit Properties
                  </button>
                  <button
                    onClick={() => handleDeleteTable(selectedTable.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 hover:bg-red-100 rounded-lg border border-red-200"
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
      {assignSeatTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 max-w-sm w-full shadow-xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              Assign Guest to {tables.find((t) => t.id === assignSeatTarget.tableId)?.name || 'Table'} (Seat {assignSeatTarget.seatNumber})
            </h3>
            {unassignedGuests.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  All guests have already been assigned to tables.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAssignSeatTarget(null)}
                    className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
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
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
                    className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90"
                  >
                    Assign Guest
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
