'use client';

import React, { useState } from 'react';
import { InvitationCodeDTO } from '@/features/registry/schemas';
import { SeatingTableDTO } from '../schemas';

interface UnassignedGuestPanelProps {
  unassignedGuests: InvitationCodeDTO[];
  tables: SeatingTableDTO[];
  onAssignGuestToTable: (guestId: string, tableId: string, seatNumber?: number) => void;
}

export function UnassignedGuestPanel({
  unassignedGuests,
  tables,
  onAssignGuestToTable,
}: UnassignedGuestPanelProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGuestForModal, setSelectedGuestForModal] = useState<InvitationCodeDTO | null>(null);
  const [targetTableId, setTargetTableId] = useState<string>('');

  const filteredGuests = unassignedGuests.filter((guest) => {
    const term = searchTerm.toLowerCase();
    return (
      guest.guestName.toLowerCase().includes(term) ||
      guest.code.toLowerCase().includes(term)
    );
  });

  const handleDragStart = (e: React.DragEvent, guestId: string) => {
    e.dataTransfer.setData('text/plain', guestId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleQuickAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGuestForModal && targetTableId) {
      onAssignGuestToTable(selectedGuestForModal.id, targetTableId);
      setSelectedGuestForModal(null);
      setTargetTableId('');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Unassigned Guests</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {unassignedGuests.length} guest{unassignedGuests.length === 1 ? '' : 's'} waiting for seating
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
          {unassignedGuests.length} unassigned
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
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by guest name or code..."
          className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
        />
      </div>

      {/* Guest Card List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[500px]">
        {filteredGuests.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-xs italic">
            {searchTerm ? 'No guests match your filter.' : 'All guests have been assigned to tables!'}
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
              <div className="min-w-0 pr-2">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                  {guest.guestName}
                </p>
                <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                  Code: {guest.code}
                </p>
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

      {/* Accessible Click-to-Assign Dialog */}
      {selectedGuestForModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-5 max-w-sm w-full shadow-xl border border-gray-200 dark:border-gray-700 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              Assign {selectedGuestForModal.guestName}
            </h3>
            <form onSubmit={handleQuickAssignSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Select Reception Table
                </label>
                <select
                  value={targetTableId}
                  onChange={(e) => setTargetTableId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.invitationCodes?.length || 0}/{t.capacity} seats)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedGuestForModal(null)}
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
          </div>
        </div>
      )}
    </div>
  );
}
