'use client';

import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';

interface PrintableFloorplanProps {
  tables: SeatingTableDTO[];
  unassignedGuests: InvitationCodeDTO[];
}

export function PrintableFloorplan({ tables, unassignedGuests }: PrintableFloorplanProps) {
  return (
    <div
      className="hidden print:block print:p-6 font-sans"
      style={{
        backgroundColor: 'var(--print-bg, #ffffff)',
        color: 'var(--print-text, #111827)',
      }}
    >
      <div
        className="border-b-2 pb-4 mb-6 flex justify-between items-end"
        style={{ borderColor: 'var(--print-header-border, #111827)' }}
      >
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wider">Reception Seating Roster & Floorplan</h1>
          <p className="text-sm opacity-80">Generated for Catering & Venue Coordination</p>
        </div>
        <div className="text-right text-xs opacity-75">
          Printed: {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Table Breakdown Grid */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        {tables.map((table) => (
          <div
            key={table.id}
            className="border rounded-lg p-4 break-inside-avoid"
            style={{
              borderColor: 'var(--print-border, #e5e7eb)',
              backgroundColor: 'var(--print-bg, #ffffff)',
              borderRadius: 'var(--btn-radius, 0.5rem)',
            }}
          >
            <div
              className="flex justify-between items-center border-b pb-2 mb-3"
              style={{ borderColor: 'var(--print-header-border, #111827)' }}
            >
              <h2 className="font-bold text-base">{table.name}</h2>
              <span
                className="text-xs font-mono px-2 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--print-badge-bg, #f3f4f6)',
                  borderColor: 'var(--print-border, #e5e7eb)',
                  color: 'var(--print-text, #111827)',
                }}
              >
                Shape: {table.shape} | Capacity: {table.capacity} | Seated: {table.invitationCodes?.length || 0}
              </span>
            </div>

            {table.invitationCodes && table.invitationCodes.length > 0 ? (
              <ol className="list-decimal list-inside space-y-1 text-xs">
                {table.invitationCodes.map((guest, idx) => (
                  <li
                    key={guest.id}
                    className="flex justify-between border-b border-dashed py-0.5"
                    style={{ borderColor: 'var(--print-border, #e5e7eb)' }}
                  >
                    <span className="font-medium">
                      Seat {guest.seatNumber || idx + 1}: {guest.guestName}
                    </span>
                    <span className="font-mono text-[10px] opacity-75">{guest.code}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs italic py-2 opacity-60">No guests assigned to this table.</p>
            )}
          </div>
        ))}
      </div>

      {/* Unassigned Guests Section */}
      {unassignedGuests.length > 0 && (
        <div
          className="border-t-2 pt-4 break-before-auto"
          style={{ borderColor: 'var(--print-header-border, #111827)' }}
        >
          <h2 className="text-sm font-bold uppercase mb-2">Unassigned Guests ({unassignedGuests.length})</h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {unassignedGuests.map((guest) => (
              <div
                key={guest.id}
                className="p-1.5 border rounded flex justify-between"
                style={{
                  borderColor: 'var(--print-border, #e5e7eb)',
                  backgroundColor: 'var(--print-badge-bg, #f3f4f6)',
                }}
              >
                <span>{guest.guestName}</span>
                <span className="font-mono text-[10px] opacity-75">{guest.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
