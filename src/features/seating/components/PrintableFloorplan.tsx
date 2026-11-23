'use client';

import { useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
} from '@/features/registry';
import { ServerExportTokens, ThemePreset } from '@/lib/theme/presets';
import { resolveDetailedSeatAssignments } from '../seatLayout';
import {
  computeTableMealCounts,
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isGuestEligibleForSeating,
  isLandmarkTable,
} from '../utils/seatingHelpers';

interface PrintableFloorplanProps {
  tables: SeatingTableDTO[];
  unassignedGuests: InvitationCodeDTO[];
  preset?: ThemePreset | string | null;
  tokens?: Partial<ServerExportTokens>;
}

export function PrintableFloorplan({ tables, unassignedGuests }: PrintableFloorplanProps) {
  const { guestTables, landmarkTables } = useMemo(() => {
    const normalized = tables.map((t) => ({
      ...t,
      invitationCodes: (t.invitationCodes || []).filter((g) => isGuestEligibleForSeating(g)),
    }));
    return {
      guestTables: normalized.filter((t) => !isLandmarkTable(t)),
      landmarkTables: normalized.filter((t) => isLandmarkTable(t)),
    };
  }, [tables]);

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

      {landmarkTables.length > 0 && (
        <div
          data-testid="printable-landmarks-summary"
          className="mb-5 p-2.5 border rounded text-xs flex flex-wrap items-center gap-2"
          style={{
            borderColor: 'var(--print-border)',
            backgroundColor: 'var(--print-badge-bg)',
          }}
        >
          <span className="font-bold uppercase tracking-wide">Room Landmarks:</span>
          {landmarkTables.map((landmark) => (
            <span
              key={landmark.id}
              className="px-2 py-0.5 rounded border font-medium"
              style={{
                borderColor: 'var(--print-border)',
                backgroundColor: 'var(--print-bg)',
              }}
            >
              {landmark.name} ({getSeatingShapeLabel(landmark.shape)})
            </span>
          ))}
        </div>
      )}

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
          {guestTables.map((table) => {
            const seatedHeadcount = getGuestsHeadcount(table.invitationCodes || []);
            const mealSummary = computeTableMealCounts(table.invitationCodes);
            const detailedSeatMap = resolveDetailedSeatAssignments(
              table.invitationCodes,
              table.capacity
            );
            const orderedEntries = Array.from(detailedSeatMap.values()).sort(
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
                  className="flex justify-between items-center border-b pb-2 mb-2"
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

                {seatedHeadcount > 0 && (
                  <div
                    data-testid="printable-table-meal-summary"
                    className="text-[11px] mb-2.5 px-2 py-1 rounded border"
                    style={{
                      backgroundColor: 'var(--print-badge-bg)',
                      borderColor: 'var(--print-border)',
                    }}
                  >
                    <span className="font-semibold">Entrées:</span> {mealSummary.formattedMeals}
                    {mealSummary.dietaryCounts.length > 0 && (
                      <span> · <span className="font-semibold">Dietary:</span> {mealSummary.formattedDietary}</span>
                    )}
                  </div>
                )}

                {orderedEntries.length > 0 ? (
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    {orderedEntries.map((entry) => {
                      const mealSelections = !entry.isCompanion
                        ? formatGuestMealSelections(entry.guest)
                        : '';
                      const customAnswers = !entry.isCompanion
                        ? formatGuestCustomAnswers(entry.guest)
                        : '';

                      return (
                        <li
                          key={`${entry.guest.id}-seat-${entry.seatNumber}`}
                          className="border-b border-dashed py-1 space-y-0.5"
                          style={{ borderColor: 'var(--print-border)' }}
                        >
                          <div className="flex justify-between items-center gap-2">
                            <span className="font-medium flex items-center flex-wrap gap-1">
                              <span>
                                Seat {entry.seatNumber}: {entry.displayName}
                              </span>
                              {entry.dietaryBadges.map((badge) => (
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
                            {entry.mealChoice && (
                              <span className="text-[10px] font-medium opacity-85">
                                {entry.mealChoice}
                              </span>
                            )}
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
