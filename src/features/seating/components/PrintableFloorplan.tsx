'use client';

import { useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import {
  InvitationCodeDTO,
  formatGuestMealSelections,
  formatGuestCustomAnswers,
} from '@/features/registry';
import { ServerExportTokens, ThemePreset } from '@/lib/theme/presets';
import { resolveDetailedSeatAssignments } from '../seatLayout';
import {
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestsHeadcount,
  isGuestEligibleForSeating,
} from '../utils/seatingHelpers';

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

  const unassignedHeadcount = useMemo(
    () => getGuestsHeadcount(printableUnassignedGuests),
    [printableUnassignedGuests]
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
          {printableTables.map((table) => {
            const seatedHeadcount = getGuestsHeadcount(table.invitationCodes || []);
            const detailedSeatMap = resolveDetailedSeatAssignments(
              table.invitationCodes,
              table.capacity
            );
            const sortedSeatEntries = Array.from(detailedSeatMap.values()).sort(
              (a, b) => a.seatNumber - b.seatNumber
            );

            return (
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
                    Shape: {table.shape} | Capacity: {table.capacity} | Seated: {seatedHeadcount}
                  </span>
                </div>

                {sortedSeatEntries.length > 0 ? (
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    {sortedSeatEntries.map((entry) => {
                      const { guest, seatNumber, isCompanion, companionIndex, displayName } = entry;
                      const dietaryBadges = !isCompanion
                        ? getDietaryBadges(guest.dietaryNotes, guest.extraFields, guest.partyTags)
                        : [];
                      const mealSelections = !isCompanion ? formatGuestMealSelections(guest) : '';
                      const customAnswers = !isCompanion ? formatGuestCustomAnswers(guest) : '';

                      return (
                        <li
                          key={isCompanion ? `${guest.id}-companion-${companionIndex}` : guest.id}
                          className="border-b border-dashed py-1 space-y-0.5"
                          style={{ borderColor: 'var(--print-border)' }}
                        >
                          <div className="flex justify-between items-center gap-2">
                            <span className="font-medium flex items-center flex-wrap gap-1">
                              <span>
                                Seat {seatNumber}: {displayName}
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
                          </div>
                          {mealSelections && (
                            <div
                              data-testid="printable-meal-selections"
                              className="text-[10px] opacity-85 pl-3"
                            >
                              Meals: {mealSelections}
                            </div>
                          )}
                          {customAnswers && (
                            <div
                              data-testid="printable-custom-answers"
                              className="text-[10px] opacity-85 pl-3"
                            >
                              Responses: {customAnswers}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-xs italic py-2 opacity-60">No guests assigned to this table.</p>
                )}
              </article>
            );
          })}
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
            Unassigned Guests ({unassignedHeadcount})
          </h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {printableUnassignedGuests.map((guest) => {
              const dietaryBadges = getDietaryBadges(
                guest.dietaryNotes,
                guest.extraFields,
                guest.partyTags
              );
              const companions = getGuestCompanionNames(guest);
              const hasNamedCompanion = companions.some(
                (c) => !c.startsWith(`${guest.guestName} (+`)
              );
              const companionSuffix =
                companions.length > 0
                  ? hasNamedCompanion
                    ? ` (+${companions.length}: ${companions.join(', ')})`
                    : ` (+${companions.length})`
                  : '';
              const mealSelections = formatGuestMealSelections(guest);
              const customAnswers = formatGuestCustomAnswers(guest);
              return (
                <div
                  key={guest.id}
                  className="p-1.5 border rounded space-y-0.5"
                  style={{
                    borderColor: 'var(--print-border)',
                    backgroundColor: 'var(--print-badge-bg)',
                  }}
                >
                  <div className="flex justify-between items-center gap-1">
                    <span className="flex items-center flex-wrap gap-1">
                      <span>
                        {guest.guestName}
                        {companionSuffix}
                      </span>
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
                  {mealSelections && (
                    <div data-testid="printable-meal-selections" className="text-[10px] opacity-85">
                      Meals: {mealSelections}
                    </div>
                  )}
                  {customAnswers && (
                    <div data-testid="printable-custom-answers" className="text-[10px] opacity-85">
                      Responses: {customAnswers}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
