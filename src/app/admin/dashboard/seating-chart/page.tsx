'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

      setTables(Array.isArray(tablesData) ? tablesData : []);
      setAllGuests(Array.isArray(guestsData) ? guestsData : []);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while loading data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derive unassigned guests
  const unassignedGuests = allGuests.filter((g) => !g.tableId);

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
      }
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Error saving table');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    try {
      const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete table');
      setSelectedTableId(null);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Error deleting table');
    }
  };

  const handleUpdateTablePosition = async (tableId: string, x: number, y: number) => {
    // Optimistic update local state
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, x, y } : t))
    );

    // Persist position update
    try {
      await fetch(`/api/admin/seating-tables/${tableId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      });
    } catch (e) {
      // Revert if error
      fetchData();
    }
  };

  // Seat assignment handlers
  const handleAssignGuestToTable = async (
    guestId: string,
    tableId: string,
    seatNumber?: number
  ) => {
    try {
      const res = await fetch('/api/admin/seating/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: guestId,
          tableId,
          seatNumber,
        }),
      });

      if (!res.ok) throw new Error('Failed to assign guest seat');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Error assigning guest seat');
    }
  };

  const handleUnassignGuest = async (guestId: string) => {
    try {
      const res = await fetch('/api/admin/seating/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: guestId,
          tableId: null,
        }),
      });

      if (!res.ok) throw new Error('Failed to unassign guest');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Error unassigning guest');
    }
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
            />
          </div>

          {/* Interactive 2D Floorplan Canvas Area */}
          <div className="lg:col-span-3 space-y-4">
            <FloorplanCanvas
              tables={tables}
              selectedTableId={selectedTableId}
              onSelectTable={setSelectedTableId}
              onUpdateTablePosition={handleUpdateTablePosition}
              onDropGuestOnTable={handleAssignGuestToTable}
              onUnassignGuest={handleUnassignGuest}
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

                <div className="flex gap-2">
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
    </div>
  );
}
