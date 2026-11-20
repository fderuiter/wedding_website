'use client';

import { useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { ServerExportTokens, ThemePreset } from '@/lib/theme/presets';
import { resolveSeatAssignments } from '../seatLayout';
import { getDietaryBadges, isGuestEligibleForSeating } from '../utils/seatingHelpers';

interface PrintableFloorplanProps {
  tables: SeatingTableDTO[];
  unassignedGuests: InvitationCodeDTO[];
  preset?: ThemePreset | string | null;
  tokens?: Partial<ServerExportTokens>;
}

export function PrintableFloorplan({ tables, unassignedGuests }: PrintableFloorplanProps) {
  const printableTables = useMemo(
    () =>
      tables.map((t) => ({
        ...t,
        invitationCodes: (t.invitationCodes || []).filter((g) => isGuestEligibleForSeating(g)),
      })),
    [tables]
  );

  const printableUnassignedGuests = useMemo(
    () => unassignedGuests.filter((g) => isGuestEligibleForSeating(g)),
    [unassignedGuests]
  );

  return (
    <main
      className="hidden print:block print:p-6 font-sans"
      aria-labelledby="printable-roster-title"
      style={{
        backgroundColor: 'var(--print-bg)',
        color: 'var(--print-text)',
      }}
    >
      <div
        className="border-b-2 pb-4 mb-6 flex justify-between items-end"
        style={{ borderColor: 'var(--print-header-border)' }}
      >
        <div>
          <h1 id="printable-roster-title" className="text-2xl font-bold uppercase tracking-wider">
            Reception Seating Roster & Floorplan
          </h1>
          <p className="text-sm opacity-80">Generated for Catering & Venue Coordination</p>
        </div>
        <div className="text-right text-xs opacity-75">
          Printed: {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Table Breakdown Grid */}
      <section aria-labelledby="tables-section-heading">
        <h2
          id="tables-section-heading"
          className="text-lg font-bold mb-4 border-b pb-1"
          style={{ borderColor: 'var(--print-header-border)' }}
        >
          Seating Table Assignments
        </h2>
        <div className="grid grid-cols-2 gap-6 mb-8">
          {printableTables.map((table) => (
            <article
              key={table.id}
              className="border rounded-lg p-4 break-inside-avoid"
              aria-labelledby={`table-heading-${table.id}`}
              style={{
                borderColor: 'var(--print-border)',
                backgroundColor: 'var(--print-bg)',
                borderRadius: 'var(--btn-radius, 0.5rem)',
              }}
            >
              <div
                className="flex justify-between items-center border-b pb-2 mb-3"
                style={{ borderColor: 'var(--print-header-border)' }}
              >
                <h3 id={`table-heading-${table.id}`} className="font-bold text-base">
                  {table.name}
                </h3>
                <span
                  className="text-xs font-mono px-2 py-0.5 rounded border"
                  style={{
                    backgroundColor: 'var(--print-badge-bg)',
                    borderColor: 'var(--print-border)',
                    color: 'var(--print-text)',
                  }}
                >
                  Shape: {table.shape} | Capacity: {table.capacity} | Seated: {table.invitationCodes?.length || 0}
                </span>
              </div>

              {table.invitationCodes && table.invitationCodes.length > 0 ? (
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  {(() => {
                    const resolvedSeatMap = resolveSeatAssignments(table.invitationCodes, table.capacity);
                    const resolvedSeatByGuestId = new Map<string, number>();
                    resolvedSeatMap.forEach((g, seatNum) => {
                      if (g.id) {
                        resolvedSeatByGuestId.set(g.id, seatNum);
                      }
                    });
                    return table.invitationCodes.map((guest, idx) => {
                      const dietaryBadges = getDietaryBadges(guest.dietaryNotes);
                      const resolvedSeat = guest.seatNumber || resolvedSeatByGuestId.get(guest.id) || idx + 1;
                      return (
                        <li
                          key={guest.id}
                          className="flex justify-between items-center gap-2 border-b border-dashed py-0.5"
                          style={{ borderColor: 'var(--print-border)' }}
                        >
                          <span className="font-medium flex items-center flex-wrap gap-1">
                            <span>
                              Seat {resolvedSeat}: {guest.guestName}
                            </span>
                            {dietaryBadges.map((badge) => (
                              <span
                                key={badge.category}
                                data-testid="printable-dietary-badge"
                                className="text-[10px] font-semibold px-1.5 py-0.2 rounded border"
                                style={{
                                  backgroundColor: 'var(--print-badge-bg)',
                                  borderColor: 'var(--print-border)',
                                  color: 'var(--print-text)',
                                }}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </span>
                          <span className="font-mono text-[10px] opacity-75">{guest.code}</span>
                        </li>
                      );
                    });
                  })()}
                </ol>
              ) : (
                <p className="text-xs italic py-2 opacity-60">No guests assigned to this table.</p>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* Unassigned Guests Section */}
      {printableUnassignedGuests.length > 0 && (
        <section
          className="border-t-2 pt-4 break-before-auto"
          aria-labelledby="unassigned-guests-heading"
          style={{ borderColor: 'var(--print-header-border)' }}
        >
          <h2 id="unassigned-guests-heading" className="text-sm font-bold uppercase mb-2">
            Unassigned Guests ({printableUnassignedGuests.length})
          </h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {printableUnassignedGuests.map((guest) => {
              const dietaryBadges = getDietaryBadges(guest.dietaryNotes);
              return (
                <div
                  key={guest.id}
                  className="p-1.5 border rounded flex justify-between items-center gap-1"
                  style={{
                    borderColor: 'var(--print-border)',
                    backgroundColor: 'var(--print-badge-bg)',
                  }}
                >
                  <span className="flex items-center flex-wrap gap-1">
                    <span>{guest.guestName}</span>
                    {dietaryBadges.map((badge) => (
                      <span
                        key={badge.category}
                        data-testid="printable-dietary-badge"
                        className="text-[10px] font-semibold px-1 rounded border"
                        style={{
                          borderColor: 'var(--print-border)',
                          color: 'var(--print-text)',
                        }}
                      >
                        {badge.shortLabel}
                      </span>
                    ))}
                  </span>
                  <span className="font-mono text-[10px] opacity-75">{guest.code}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
