'use client';

import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';

interface PrintableFloorplanProps {
  tables: SeatingTableDTO[];
  unassignedGuests: InvitationCodeDTO[];
}

export function PrintableFloorplan({ tables, unassignedGuests }: PrintableFloorplanProps) {
  return (
    <div className="hidden print:block print:p-6 print:bg-white text-black font-sans">
      <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">Reception Seating Roster & Floorplan</h1>
          <p className="text-sm text-gray-600">Generated for Catering & Venue Coordination</p>
        </div>
        <div className="text-right text-xs text-gray-500">
          Printed: {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Table Breakdown Grid */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {tables.map((table) => (
          <div key={table.id} className="border border-black rounded-lg p-4 break-inside-avoid">
            <div className="flex justify-between items-center border-b border-black/30 pb-2 mb-3">
              <h2 className="font-bold text-base">{table.name}</h2>
              <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded border border-gray-300">
                Shape: {table.shape} | Capacity: {table.capacity} | Seated: {table.invitationCodes?.length || 0}
              </span>
            </div>

            {table.invitationCodes && table.invitationCodes.length > 0 ? (
              <ol className="list-decimal list-inside space-y-1 text-xs">
                {table.invitationCodes.map((guest, idx) => (
                  <li key={guest.id} className="flex justify-between border-b border-dashed border-gray-200 py-0.5">
                    <span className="font-medium">
                      Seat {guest.seatNumber || idx + 1}: {guest.guestName}
                    </span>
                    <span className="font-mono text-gray-500 text-[10px]">{guest.code}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-gray-400 italic py-2">No guests assigned to this table.</p>
            )}
          </div>
        ))}
      </div>

      {/* Unassigned Guests Section */}
      {unassignedGuests.length > 0 && (
        <div className="border-t-2 border-black pt-4 break-before-auto">
          <h2 className="text-sm font-bold uppercase mb-2">Unassigned Guests ({unassignedGuests.length})</h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {unassignedGuests.map((guest) => (
              <div key={guest.id} className="p-1.5 border border-gray-300 rounded flex justify-between">
                <span>{guest.guestName}</span>
                <span className="font-mono text-gray-400 text-[10px]">{guest.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
