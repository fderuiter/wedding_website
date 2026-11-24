'use client';

import React, { useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
} from '@/features/registry';
import { ServerExportTokens, ThemePreset } from '@/lib/theme/presets';
import { resolveDetailedSeatAssignments } from '../seatLayout';
import {
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isGuestEligibleForSeating,
  isLandmarkTable,
  summarizeAttendeeMeals,
} from '../utils/seatingHelpers';

interface PrintableFloorplanProps {
  tables: SeatingTableDTO[];
  unassignedGuests: InvitationCodeDTO[];
  preset?: ThemePreset | string | null;
  tokens?: Partial<ServerExportTokens>;
}

function areGuestListsEqual(
  prev: ReadonlyArray<InvitationCodeDTO> | undefined,
  next: ReadonlyArray<InvitationCodeDTO> | undefined
): boolean {
  if (prev === next) return true;
  const prevLen = prev?.length ?? 0;
  const nextLen = next?.length ?? 0;
  if (prevLen !== nextLen) return false;
  if (prevLen === 0) return true;
  for (let i = 0; i < prevLen; i++) {
    if (prev![i] !== next![i]) return false;
  }
  return true;
}

function areTableRosterPropsEqual(prev: SeatingTableDTO, next: SeatingTableDTO): boolean {
  if (prev === next) return true;
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.shape === next.shape &&
    prev.capacity === next.capacity &&
    areGuestListsEqual(prev.invitationCodes, next.invitationCodes)
  );
}

function areTablesRosterEqual(
  prevTables: ReadonlyArray<SeatingTableDTO>,
  nextTables: ReadonlyArray<SeatingTableDTO>
): boolean {
  if (prevTables === nextTables) return true;
  if (prevTables.length !== nextTables.length) return false;
  for (let i = 0; i < prevTables.length; i++) {
    if (!areTableRosterPropsEqual(prevTables[i], nextTables[i])) {
      return false;
    }
  }
  return true;
}

function arePrintableFloorplanPropsEqual(
  prev: PrintableFloorplanProps,
  next: PrintableFloorplanProps
): boolean {
  return (
    prev.preset === next.preset &&
    prev.tokens === next.tokens &&
    areGuestListsEqual(prev.unassignedGuests, next.unassignedGuests) &&
    areTablesRosterEqual(prev.tables, next.tables)
  );
}

interface PrintableTableCardProps {
  table: SeatingTableDTO;
}

const PrintableTableCard = React.memo(
  function PrintableTableCard({ table }: PrintableTableCardProps) {
    const { seatedHeadcount, mealSummary, orderedEntries } = useMemo(() => {
      const eligibleGuests = (table.invitationCodes || []).filter((g) =>
        isGuestEligibleForSeating(g)
      );
      const detailedSeatMap = resolveDetailedSeatAssignments(eligibleGuests, table.capacity);
      const sorted = Array.from(detailedSeatMap.values()).sort(
        (a, b) => a.seatNumber - b.seatNumber
      );
      const rows = sorted.map((entry) => ({
        entry,
        mealSelections: !entry.isCompanion ? formatGuestMealSelections(entry.guest) : '',
        customAnswers: !entry.isCompanion ? formatGuestCustomAnswers(entry.guest) : '',
      }));
      return {
        seatedHeadcount: sorted.length,
        mealSummary: summarizeAttendeeMeals(sorted),
        orderedEntries: rows,
      };
    }, [table.invitationCodes, table.capacity]);

    return (
      <article
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
            {orderedEntries.map(({ entry, mealSelections, customAnswers }) => (
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
            ))}
          </ol>
        ) : (
          <p className="text-xs italic py-2 opacity-60">No guests assigned to this table.</p>
        )}
      </article>
    );
  },
  (prev, next) => areTableRosterPropsEqual(prev.table, next.table)
);

export const PrintableFloorplan = React.memo(function PrintableFloorplan({
  tables,
  unassignedGuests,
}: PrintableFloorplanProps) {
  const { guestTables, landmarkTables } = useMemo(() => {
    const nextGuestTables: SeatingTableDTO[] = [];
    const nextLandmarkTables: SeatingTableDTO[] = [];
    for (const table of tables) {
      if (isLandmarkTable(table)) {
        nextLandmarkTables.push(table);
      } else {
        nextGuestTables.push(table);
      }
    }
    return {
      guestTables: nextGuestTables,
      landmarkTables: nextLandmarkTables,
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
    <div
      role="region"
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
          {guestTables.map((table) => (
            <PrintableTableCard key={table.id} table={table} />
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
    </div>
  );
}, arePrintableFloorplanPropsEqual);
