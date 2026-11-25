'use client';

import React, { useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
} from '@/features/registry';
import { ServerExportTokens, ThemePreset } from '@/lib/theme/presets';
import {
  computeScaledTableDimensions,
  computeSeatPosition,
  computeTableMinBounds,
  resolveDetailedSeatAssignments,
} from '../seatLayout';
import {
  getDietaryBadges,
  getGuestCompanionNames,
  getGuestPartySize,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isGuestEligibleForSeating,
  isLandmarkTable,
  isOneSidedTableShape,
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
    prev.isSample === next.isSample &&
    areGuestListsEqual(prev.invitationCodes, next.invitationCodes)
  );
}

function areTableDiagramPropsEqual(prev: SeatingTableDTO, next: SeatingTableDTO): boolean {
  if (prev === next) return true;
  return (
    areTableRosterPropsEqual(prev, next) &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.width === next.width &&
    prev.height === next.height &&
    (prev.rotation ?? 0) === (next.rotation ?? 0)
  );
}

function areTablesDiagramEqual(
  prevTables: ReadonlyArray<SeatingTableDTO>,
  nextTables: ReadonlyArray<SeatingTableDTO>
): boolean {
  if (prevTables === nextTables) return true;
  if (prevTables.length !== nextTables.length) return false;
  for (let i = 0; i < prevTables.length; i++) {
    if (!areTableDiagramPropsEqual(prevTables[i], nextTables[i])) {
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
    areTablesDiagramEqual(prev.tables, next.tables)
  );
}

function computeOccupiedSeatSet(
  invitationCodes: ReadonlyArray<InvitationCodeDTO> | undefined,
  capacity: number
): { occupiedSeats: Set<number>; seatedHeadcount: number } {
  const occupiedSeats = new Set<number>();
  if (!invitationCodes || invitationCodes.length === 0 || capacity <= 0) {
    return { occupiedSeats, seatedHeadcount: 0 };
  }

  const eligible = invitationCodes
    .filter((guest) => isGuestEligibleForSeating(guest))
    .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));

  const unseatedPrimary: InvitationCodeDTO[] = [];
  for (const guest of eligible) {
    const primarySeat = guest.seatNumber;
    if (
      typeof primarySeat === 'number' &&
      primarySeat >= 1 &&
      primarySeat <= capacity &&
      !occupiedSeats.has(primarySeat)
    ) {
      occupiedSeats.add(primarySeat);
    } else {
      unseatedPrimary.push(guest);
    }
  }

  let nextFallback = 1;
  const claimNextOpen = () => {
    while (nextFallback <= capacity) {
      const candidate = nextFallback++;
      if (!occupiedSeats.has(candidate)) {
        occupiedSeats.add(candidate);
        return;
      }
    }
  };

  for (let i = 0; i < unseatedPrimary.length; i++) {
    claimNextOpen();
  }

  let seatedHeadcount = 0;
  for (const guest of eligible) {
    const partySize = getGuestPartySize(guest);
    seatedHeadcount += partySize;
    const plusOneCount = Math.max(0, partySize - 1);
    if (plusOneCount <= 0) continue;

    const explicitPlusOnes = Array.isArray(guest.plusOneSeatNumbers)
      ? guest.plusOneSeatNumbers
      : [];
    for (let idx = 0; idx < plusOneCount; idx++) {
      const explicit = explicitPlusOnes[idx];
      if (
        typeof explicit === 'number' &&
        explicit >= 1 &&
        explicit <= capacity &&
        !occupiedSeats.has(explicit)
      ) {
        occupiedSeats.add(explicit);
      } else {
        claimNextOpen();
      }
    }
  }

  return { occupiedSeats, seatedHeadcount };
}

interface PrintableFloorplanSvgProps {
  tables: SeatingTableDTO[];
}

const PrintableFloorplanSvg = React.memo(function PrintableFloorplanSvg({
  tables,
}: PrintableFloorplanSvgProps) {
  const layout = useMemo(() => {
    if (tables.length === 0) return null;

    let minExtentX = Infinity;
    let minExtentY = Infinity;
    let maxExtentX = -Infinity;
    let maxExtentY = -Infinity;

    const items = tables.map((table) => {
      const isLandmark = isLandmarkTable(table);
      const rotationDeg = (((Number(table.rotation) || 0) % 360) + 360) % 360;
      const isAxisAligned = rotationDeg % 90 === 0;
      const { width: scaledW, height: scaledH } = computeScaledTableDimensions({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: isAxisAligned ? 0 : 45,
      });
      const { minX, minY } = computeTableMinBounds({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: rotationDeg,
      });
      const clampedX = Math.max(minX, Number(table.x) || 0);
      const clampedY = Math.max(minY, Number(table.y) || 0);
      const cx = clampedX + scaledW / 2;
      const cy = clampedY + scaledH / 2;

      const rad = (rotationDeg * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const seatClearance = isLandmark ? 8 : 28;
      const halfSpanX = (scaledW / 2) * cos + (scaledH / 2) * sin + seatClearance;
      const halfSpanY = (scaledW / 2) * sin + (scaledH / 2) * cos + seatClearance;

      minExtentX = Math.min(minExtentX, cx - halfSpanX);
      minExtentY = Math.min(minExtentY, cy - halfSpanY);
      maxExtentX = Math.max(maxExtentX, cx + halfSpanX);
      maxExtentY = Math.max(maxExtentY, cy + halfSpanY);

      const { occupiedSeats, seatedHeadcount } = isLandmark
        ? { occupiedSeats: new Set<number>(), seatedHeadcount: 0 }
        : computeOccupiedSeatSet(table.invitationCodes, table.capacity);

      const isRound = table.shape === 'round';
      const isOneSided = isOneSidedTableShape(table.shape);
      const seatOffset = isRound || isOneSided ? 18 : 16;
      const seats: Array<{ seatNumber: number; x: number; y: number; occupied: boolean }> = [];

      if (!isLandmark && table.capacity > 0) {
        for (let s = 1; s <= table.capacity; s++) {
          const pos = computeSeatPosition({
            shape: table.shape,
            seatNumber: s,
            capacity: table.capacity,
            width: scaledW,
            height: scaledH,
            offset: seatOffset,
            originX: clampedX,
            originY: clampedY,
          });
          seats.push({
            seatNumber: s,
            x: pos.x,
            y: pos.y,
            occupied: occupiedSeats.has(s),
          });
        }
      }

      return {
        table,
        isLandmark,
        rotationDeg,
        clampedX,
        clampedY,
        scaledW,
        scaledH,
        cx,
        cy,
        seatedHeadcount,
        seats,
      };
    });

    const pad = 24;
    const viewX = Math.floor(minExtentX - pad);
    const viewY = Math.floor(minExtentY - pad);
    const viewW = Math.max(320, Math.ceil(maxExtentX - minExtentX + pad * 2));
    const viewH = Math.max(180, Math.ceil(maxExtentY - minExtentY + pad * 2));

    return { items, viewBox: `${viewX} ${viewY} ${viewW} ${viewH}` };
  }, [tables]);

  if (!layout) return null;

  return (
    <div
      data-testid="printable-floorplan-diagram"
      className="mb-6 p-4 border rounded-lg break-inside-avoid"
      style={{
        borderColor: 'var(--print-border)',
        backgroundColor: 'var(--print-bg)',
      }}
    >
      <div
        className="flex justify-between items-center border-b pb-1.5 mb-3 text-xs font-bold uppercase tracking-wide"
        style={{ borderColor: 'var(--print-header-border)' }}
      >
        <span>2D Reception Floorplan Diagram</span>
        <span className="font-normal text-[11px] normal-case opacity-80">
          Filled circles = assigned seats · Dashed outlines = landmarks
        </span>
      </div>
      <svg
        data-testid="printable-floorplan-svg"
        role="img"
        aria-label="2D Reception Floorplan Diagram"
        viewBox={layout.viewBox}
        className="w-full h-auto max-h-[340px] block"
      >
        <title>2D Reception Floorplan Diagram</title>
        {layout.items.map((item) => {
          const {
            table,
            isLandmark,
            rotationDeg,
            clampedX,
            clampedY,
            scaledW,
            scaledH,
            cx,
            cy,
            seatedHeadcount,
            seats,
          } = item;
          const rotateTransform =
            rotationDeg !== 0 ? `rotate(${rotationDeg} ${cx} ${cy})` : undefined;

          if (isLandmark) {
            const isCircularLandmark = table.shape === 'cake';
            const radius = isCircularLandmark ? Math.min(scaledW, scaledH) / 2 : 8;
            return (
              <g
                key={table.id}
                data-testid="printable-svg-landmark"
                data-table-id={table.id}
              >
                <g
                  data-testid="printable-svg-landmark-rotated"
                  transform={rotateTransform}
                >
                  <rect
                    x={clampedX}
                    y={clampedY}
                    width={scaledW}
                    height={scaledH}
                    rx={radius}
                    ry={radius}
                    fill="var(--print-badge-bg, #f8fafc)"
                    stroke="var(--print-border, #64748b)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                </g>
                <text
                  data-testid="printable-svg-landmark-label"
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight="bold"
                  fill="var(--print-text, #111827)"
                >
                  {table.name} · {getSeatingShapeLabel(table.shape)}
                </text>
              </g>
            );
          }

          const isRound = table.shape === 'round';
          return (
            <g
              key={table.id}
              data-testid="printable-svg-table"
              data-table-id={table.id}
            >
              <g
                data-testid="printable-svg-table-rotated"
                transform={rotateTransform}
              >
                {isRound ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Math.min(scaledW, scaledH) / 2}
                    fill="var(--print-bg, #ffffff)"
                    stroke="var(--print-header-border, #1f2937)"
                    strokeWidth={2}
                  />
                ) : (
                  <rect
                    x={clampedX}
                    y={clampedY}
                    width={scaledW}
                    height={scaledH}
                    rx={8}
                    ry={8}
                    fill="var(--print-bg, #ffffff)"
                    stroke="var(--print-header-border, #1f2937)"
                    strokeWidth={2}
                  />
                )}
                {seats.map((seat) => (
                  <circle
                    key={seat.seatNumber}
                    data-testid="printable-svg-seat"
                    data-seat-number={seat.seatNumber}
                    data-occupied={seat.occupied ? 'true' : 'false'}
                    cx={seat.x}
                    cy={seat.y}
                    r={8}
                    fill={
                      seat.occupied
                        ? 'var(--print-header-border, #1f2937)'
                        : 'var(--print-bg, #ffffff)'
                    }
                    stroke="var(--print-header-border, #374151)"
                    strokeWidth={1.5}
                    strokeDasharray={seat.occupied ? undefined : '2 2'}
                  />
                ))}
              </g>
              <text
                data-testid="printable-svg-table-label"
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight="bold"
                fill="var(--print-text, #111827)"
              >
                {table.name} ({seatedHeadcount}/{table.capacity})
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

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

interface PrintableUnassignedSectionProps {
  unassignedGuests: InvitationCodeDTO[];
}

const PrintableUnassignedSection = React.memo(
  function PrintableUnassignedSection({ unassignedGuests }: PrintableUnassignedSectionProps) {
    const printableUnassignedGuests = useMemo(
      () => unassignedGuests.filter((g) => isGuestEligibleForSeating(g)),
      [unassignedGuests]
    );

    const unassignedHeadcount = useMemo(
      () => getGuestsHeadcount(printableUnassignedGuests),
      [printableUnassignedGuests]
    );

    const unassignedGuestCards = useMemo(
      () =>
        printableUnassignedGuests.map((guest) => {
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
          return {
            guest,
            dietaryBadges,
            companionSuffix,
            mealSelections,
            customAnswers,
          };
        }),
      [printableUnassignedGuests]
    );

    if (unassignedGuestCards.length === 0) {
      return null;
    }

    return (
      <section
        className="border-t-2 pt-4 break-before-auto"
        aria-labelledby="unassigned-guests-heading"
        style={{ borderColor: 'var(--print-header-border)' }}
      >
        <h2 id="unassigned-guests-heading" className="text-sm font-bold uppercase mb-2">
          Unassigned Guests ({unassignedHeadcount})
        </h2>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {unassignedGuestCards.map(
            ({ guest, dietaryBadges, companionSuffix, mealSelections, customAnswers }) => (
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
            )
          )}
        </div>
      </section>
    );
  },
  (prev, next) => areGuestListsEqual(prev.unassignedGuests, next.unassignedGuests)
);

export const PrintableFloorplan = React.memo(function PrintableFloorplan({
  tables,
  unassignedGuests,
}: PrintableFloorplanProps) {
  const { visibleTables, guestTables, landmarkTables } = useMemo(() => {
    const nextVisibleTables: SeatingTableDTO[] = [];
    const nextGuestTables: SeatingTableDTO[] = [];
    const nextLandmarkTables: SeatingTableDTO[] = [];
    for (const table of tables) {
      if (table.isSample === true) continue;
      nextVisibleTables.push(table);
      if (isLandmarkTable(table)) {
        nextLandmarkTables.push(table);
      } else {
        nextGuestTables.push(table);
      }
    }
    return {
      visibleTables: nextVisibleTables,
      guestTables: nextGuestTables,
      landmarkTables: nextLandmarkTables,
    };
  }, [tables]);

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

      {visibleTables.length > 0 && <PrintableFloorplanSvg tables={visibleTables} />}

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
      <PrintableUnassignedSection unassignedGuests={unassignedGuests} />
    </div>
  );
}, arePrintableFloorplanPropsEqual);
