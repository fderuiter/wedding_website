'use client';

import React, { useState, useMemo } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { InvitationCodeDTO } from '@/features/registry/schemas';
import { SeatingTableDTO } from '../schemas';

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

interface UnassignedGuestPanelProps {
  unassignedGuests: InvitationCodeDTO[];
  tables: SeatingTableDTO[];
  onAssignGuestToTable: (guestId: string, tableId: string, seatNumber?: number) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onAutoAssignComplete?: (result: { assignedCount: number; unassignedCount: number; assignedGuests: any[] }) => void;
}

export const UnassignedGuestPanel = React.memo(function UnassignedGuestPanel({
  unassignedGuests,
  tables,
  onAssignGuestToTable,
  searchQuery,
  onSearchQueryChange,
  onAutoAssignComplete,
}: UnassignedGuestPanelProps) {
  const toast = useOptionalToast();
  const [optimisticallyAssignedIds, setOptimisticallyAssignedIds] = useState<Set<string>>(new Set());
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const [selectedGuestForModal, setSelectedGuestForModal] = useState<InvitationCodeDTO | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>('');
  const [targetSeatNumber, setTargetSeatNumber] = useState<number | undefined>(undefined);

  // Derive active unassigned guests synchronously from props and local optimistic assignments
  const effectiveUnassignedGuests = useMemo(() => {
    if (optimisticallyAssignedIds.size === 0) return unassignedGuests;
    return unassignedGuests.filter((g) => !optimisticallyAssignedIds.has(g.id));
  }, [unassignedGuests, optimisticallyAssignedIds]);

  const currentSearchQuery = searchQuery !== undefined ? searchQuery : internalSearchTerm;

  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchTerm(val);
    }
  };

  const filteredGuests = useMemo(() => {
    const term = currentSearchQuery.trim().toLowerCase();
    if (!term) return effectiveUnassignedGuests;
    return effectiveUnassignedGuests.filter((guest) => {
      const matchesName = guest.guestName.toLowerCase().includes(term);
      const matchesCode = guest.code ? guest.code.toLowerCase().includes(term) : false;
      const matchesHousehold = guest.householdName ? guest.householdName.toLowerCase().includes(term) : false;
      const matchesTags = guest.partyTags ? guest.partyTags.some((t) => t.toLowerCase().includes(term)) : false;
      return matchesName || matchesCode || matchesHousehold || matchesTags;
    });
  }, [effectiveUnassignedGuests, currentSearchQuery]);

  const handleDragStart = (e: React.DragEvent, guestId: string) => {
    e.dataTransfer.setData('text/plain', guestId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAutoAssignAll = async () => {
    setIsAutoAssigning(true);
    try {
      const res = await fetch('/api/admin/seating/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to auto-assign seats');
      }

      const json = await res.json();
      const payload = json.data || json;
      const assignedCount = payload.assignedCount ?? 0;
      const unassignedCount = payload.unassignedCount ?? 0;

      const assignedIds: string[] = (payload.assignedGuests || []).map((g: any) => g.id);

      // Optimistically update local guest state
      setOptimisticallyAssignedIds((prev) => {
        const next = new Set(prev);
        assignedIds.forEach((id) => next.add(id));
        return next;
      });

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

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Unassigned Guests</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {effectiveUnassignedGuests.length} guest{effectiveUnassignedGuests.length === 1 ? '' : 's'} waiting for seating
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
          {effectiveUnassignedGuests.length} unassigned
        </span>
      </div>

      {/* Search Filter Input */}
      <div className="mb-3">
        <label htmlFor="unassigned-search" className="sr-only">
          Search unassigned guests
        </label>
        <input
          id="unassigned-search"
          type="text"
          value={currentSearchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Filter by guest name or code..."
          className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
        />
      </div>

      {/* Guest Card List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[500px]">
        {filteredGuests.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-xs italic">
            {currentSearchQuery.trim()
              ? `No unassigned guests match "${currentSearchQuery.trim()}".`
              : 'All guests have been assigned to tables!'}
          </div>
        ) : (
          filteredGuests.map((guest) => (
            <div
              key={guest.id}
              draggable
              onDragStart={(e) => handleDragStart(e, guest.id)}
              className="group p-2.5 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 hover:border-primary/50 dark:hover:border-primary/50 rounded-lg cursor-grab active:cursor-grabbing transition-all flex items-center justify-between shadow-xs hover:shadow-sm"
              role="listitem"
            >
              <div className="min-w-0 pr-2 space-y-0.5">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate flex items-center gap-1.5 flex-wrap">
                  <span>{guest.guestName}</span>
                  {guest.householdName && (
                    <span className="text-[10px] px-1.5 py-0.2 font-normal rounded bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200" data-testid="unassigned-household-badge">
                      🏠 {guest.householdName}
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                  Code: {guest.code}
                </p>
                {guest.partyTags && guest.partyTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {guest.partyTags.map((tag) => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-medium">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Assign button for quick/accessible assignment */}
              <button
                type="button"
                onClick={() => {
                  setSelectedGuestForModal(guest);
                  if (tables.length > 0) setTargetTableId(tables[0].id);
                }}
                className="text-[11px] font-medium px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-primary hover:text-white hover:border-primary text-gray-700 dark:text-gray-300 rounded transition-colors"
                aria-label={`Assign ${guest.guestName} to table`}
              >
                Assign
              </button>
            </div>
          ))
        )}
      </div>

      {/* Auto-Assign All Action Button */}
      {effectiveUnassignedGuests.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleAutoAssignAll}
            disabled={isAutoAssigning}
            className="w-full justify-center flex items-center gap-1.5 font-medium shadow-xs"
            aria-label="Auto-Assign All"
          >
            {isAutoAssigning ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Auto-Assigning...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>Auto-Assign All</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Accessible Click-to-Assign Dialog */}
      {/* Accessible Click-to-Assign Dialog */}
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
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              <option value="">Any available seat</option>
              {(() => {
                const selTable = tables.find((t) => t.id === targetTableId);
                if (!selTable) return null;
                return Array.from({ length: selTable.capacity }, (_, idx) => idx + 1).map((seatNum) => {
                  const occ = selTable.invitationCodes?.find((g) => g.seatNumber === seatNum);
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
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!targetTableId}
              className="px-3 py-1.5 text-xs bg-primary text-white font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              Confirm Assignment
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
});
