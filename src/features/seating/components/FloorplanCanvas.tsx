'use client';

import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EnsureToastProvider, useToast } from '@/components/ui/ToastProvider';
import type { SeatingTableDTO } from '../schemas';
import {
  type InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
  formatGuestPlusOneNames,
} from '@/features/registry';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';
import {
  computeScaledTableDimensions,
  computeSeatPosition,
  computeTableMinBounds,
  resolveDetailedSeatAssignments,
} from '../seatLayout';
import {
  getGuestPartySize,
  getGuestPlusOneNamesList,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isLandmarkTable,
  isOneSidedTableShape,
  type DietaryBadgeInfo,
} from '../utils/seatingHelpers';

const EMPTY_SET = new Set<string>();
const EMPTY_STRING_MAP = new Map<string, string>();
const DEFAULT_STAGE_WIDTH = 800;
const DEFAULT_STAGE_HEIGHT = 650;
const STAGE_PADDING = 48;
const NUDGE_STEP_PX = 20;
const NUDGE_FAST_STEP_PX = 50;
const ROTATION_HANDLE_POLE_OFFSET_PX = 62;
const ROTATION_HANDLE_KNOB_CLEARANCE_PX = 16;

function shouldFlipRotationHandle(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  stageBounds: { width: number; height: number }
): boolean {
  const cx = width / 2;
  const cy = height / 2;
  const rad = (rotation * Math.PI) / 180;
  const poleDistance = cy + ROTATION_HANDLE_POLE_OFFSET_PX;
  const dx = poleDistance * Math.sin(rad);
  const dy = -poleDistance * Math.cos(rad);

  const topPoleX = x + cx + dx;
  const topPoleY = y + cy + dy;
  const bottomPoleX = x + cx - dx;
  const bottomPoleY = y + cy - dy;

  const topPoleCrossesStage =
    topPoleX - ROTATION_HANDLE_KNOB_CLEARANCE_PX < 0 ||
    topPoleY - ROTATION_HANDLE_KNOB_CLEARANCE_PX < 0 ||
    topPoleX + ROTATION_HANDLE_KNOB_CLEARANCE_PX > stageBounds.width ||
    topPoleY + ROTATION_HANDLE_KNOB_CLEARANCE_PX > stageBounds.height;

  const bottomPoleClearsNegativeAxes =
    bottomPoleX - ROTATION_HANDLE_KNOB_CLEARANCE_PX >= 0 &&
    bottomPoleY - ROTATION_HANDLE_KNOB_CLEARANCE_PX >= 0;

  return topPoleCrossesStage && bottomPoleClearsNegativeAxes;
}

interface ActiveDropTarget {
  type: 'table' | 'seat';
  tableId: string;
  seatNumber?: number;
}

type ActivePointerGesture =
  | {
    mode: 'drag';
    tableId: string;
    tableName: string;
    startX: number;
    startY: number;
    previewX: number;
    previewY: number;
    minX: number;
    minY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    pointerStartX: number;
    pointerStartY: number;
    pointerId?: number;
    captureElement?: HTMLElement | null;
    hasMoved: boolean;
  }
  | {
    mode: 'rotate';
    tableId: string;
    tableName: string;
    startRotation: number;
    previewRotation: number;
    handleFlipped: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    pointerStartX: number;
    pointerStartY: number;
    pointerId?: number;
    captureElement?: HTMLElement | null;
    hasMoved: boolean;
  };

interface FloorplanCanvasProps {
  tables: SeatingTableDTO[];
  guests?: InvitationCodeDTO[];
  allGuests?: InvitationCodeDTO[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  onUpdateTablePosition: (tableId: string, x: number, y: number) => void;
  onUpdateTableRotation?: (tableId: string, rotation: number) => void;
  onDropGuestOnTable: (guestId: string, tableId: string, seatNumber?: number) => void;
  onDropGuestsOnTable?: (guestIds: string[], tableId: string) => void;
  onUnassignGuest: (guestId: string) => void;
  searchQuery?: string;
  onOpenSeatAssignModal?: (tableId: string, seatNumber: number) => void;
  onAddTable?: () => void;
  placementMode?: boolean;
  onPlacementModeChange?: (active: boolean) => void;
  emptyHeadingLevel?: HeadingLevel;
}

function getSeatInitials(displayName: string, isCompanion: boolean): string {
  if (isCompanion) {
    const parenIdx = displayName.indexOf('(');
    const prefix = (parenIdx > 0 ? displayName.slice(0, parenIdx) : displayName).trim();
    const parenTag = parenIdx >= 0 ? displayName.slice(parenIdx + 1).replace(/\).*/, '').trim() : '';
    if (parenTag.startsWith('+') && !parenTag.includes(' of ')) {
      return parenTag.slice(0, 3);
    }
    const parts = prefix.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`;
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return `${parts[0][0]}+`;
    }
    return '+1';
  }
  const parts = displayName.split(' ');
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`;
}

function areGuestArraysEqual(
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

function areTableDisplayPropsEqual(prev: SeatingTableDTO, next: SeatingTableDTO): boolean {
  if (prev === next) return true;
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.shape === next.shape &&
    prev.capacity === next.capacity &&
    prev.x === next.x &&
    prev.y === next.y &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.rotation === next.rotation &&
    areGuestArraysEqual(prev.invitationCodes, next.invitationCodes)
  );
}

interface ResolvedSeatSummary {
  assignedGuest: InvitationCodeDTO;
  isCompanionSeat: boolean;
  seatDisplayLabel: string;
  seatInitials: string;
  dietaryBadges: DietaryBadgeInfo[];
  dietarySummary: string;
}

interface FloorplanTableNodeProps {
  table: SeatingTableDTO;
  isSelected: boolean;
  isPlacementMode: boolean;
  isSearching: boolean;
  hasMatchingGuest: boolean;
  matchingGuestIdsKey: string;
  isTableDropTarget: boolean;
  dropTargetSeatNumber: number | null;
  gestureMode: 'drag' | 'rotate' | null;
  previewX: number | undefined;
  previewY: number | undefined;
  previewRotation: number | undefined;
  gestureHandleFlipped: boolean | undefined;
  stageWidth: number;
  stageHeight: number;
  onTablePointerDown: (e: React.PointerEvent, table: SeatingTableDTO) => void;
  onTableMouseDown: (e: React.MouseEvent, table: SeatingTableDTO) => void;
  onRotationPointerDown: (e: React.PointerEvent, table: SeatingTableDTO) => void;
  onRotationMouseDown: (e: React.MouseEvent, table: SeatingTableDTO) => void;
  onCanvasPointerMove: (e: React.PointerEvent) => void;
  onCanvasPointerUp: (e: React.PointerEvent) => void;
  onCanvasPointerCancel: (e: React.PointerEvent) => void;
  onSelectTable: (tableId: string) => void;
  onTableKeyDown: (e: React.KeyboardEvent, table: SeatingTableDTO) => void;
  onTableDragEnter: (e: React.DragEvent, tableId: string) => void;
  onTableDragOver: (e: React.DragEvent, tableId: string) => void;
  onTableDragLeave: (e: React.DragEvent, tableId: string) => void;
  onSeatDragEnter: (e: React.DragEvent, tableId: string, seatNumber: number) => void;
  onSeatDragOver: (e: React.DragEvent, tableId: string, seatNumber: number) => void;
  onSeatDragLeave: (e: React.DragEvent, tableId: string, seatNumber: number) => void;
  onDropOnTable: (e: React.DragEvent, tableId: string, seatNumber?: number) => void;
  onSeatClick: (tableId: string, seatNumber: number, hasAssignedGuest: boolean) => void;
  onSeatDoubleClick: (
    table: SeatingTableDTO,
    seatNumber: number,
    assignedGuest: InvitationCodeDTO
  ) => void;
  onSeatKeyDown: (
    e: React.KeyboardEvent,
    table: SeatingTableDTO,
    seatNumber: number,
    assignedGuest?: InvitationCodeDTO
  ) => void;
  onNudgeTable: (table: SeatingTableDTO, dx: number, dy: number) => void;
  onRotateTableBy: (table: SeatingTableDTO, delta: number) => void;
  onTogglePlacementMode: (table: SeatingTableDTO) => void;
  onExitPlacementMode: (table: SeatingTableDTO) => void;
}

function areFloorplanTableNodePropsEqual(
  prev: FloorplanTableNodeProps,
  next: FloorplanTableNodeProps
): boolean {
  return (
    prev.isSelected === next.isSelected &&
    prev.isPlacementMode === next.isPlacementMode &&
    prev.isSearching === next.isSearching &&
    prev.hasMatchingGuest === next.hasMatchingGuest &&
    prev.matchingGuestIdsKey === next.matchingGuestIdsKey &&
    prev.isTableDropTarget === next.isTableDropTarget &&
    prev.dropTargetSeatNumber === next.dropTargetSeatNumber &&
    prev.gestureMode === next.gestureMode &&
    prev.previewX === next.previewX &&
    prev.previewY === next.previewY &&
    prev.previewRotation === next.previewRotation &&
    prev.gestureHandleFlipped === next.gestureHandleFlipped &&
    prev.stageWidth === next.stageWidth &&
    prev.stageHeight === next.stageHeight &&
    areTableDisplayPropsEqual(prev.table, next.table) &&
    prev.onTablePointerDown === next.onTablePointerDown &&
    prev.onTableMouseDown === next.onTableMouseDown &&
    prev.onRotationPointerDown === next.onRotationPointerDown &&
    prev.onRotationMouseDown === next.onRotationMouseDown &&
    prev.onCanvasPointerMove === next.onCanvasPointerMove &&
    prev.onCanvasPointerUp === next.onCanvasPointerUp &&
    prev.onCanvasPointerCancel === next.onCanvasPointerCancel &&
    prev.onSelectTable === next.onSelectTable &&
    prev.onTableKeyDown === next.onTableKeyDown &&
    prev.onTableDragEnter === next.onTableDragEnter &&
    prev.onTableDragOver === next.onTableDragOver &&
    prev.onTableDragLeave === next.onTableDragLeave &&
    prev.onSeatDragEnter === next.onSeatDragEnter &&
    prev.onSeatDragOver === next.onSeatDragOver &&
    prev.onSeatDragLeave === next.onSeatDragLeave &&
    prev.onDropOnTable === next.onDropOnTable &&
    prev.onSeatClick === next.onSeatClick &&
    prev.onSeatDoubleClick === next.onSeatDoubleClick &&
    prev.onSeatKeyDown === next.onSeatKeyDown &&
    prev.onNudgeTable === next.onNudgeTable &&
    prev.onRotateTableBy === next.onRotateTableBy &&
    prev.onTogglePlacementMode === next.onTogglePlacementMode &&
    prev.onExitPlacementMode === next.onExitPlacementMode
  );
}

const FloorplanTableNode = React.memo(function FloorplanTableNode({
  table,
  isSelected,
  isPlacementMode,
  isSearching,
  hasMatchingGuest,
  matchingGuestIdsKey,
  isTableDropTarget,
  dropTargetSeatNumber,
  gestureMode,
  previewX,
  previewY,
  previewRotation,
  gestureHandleFlipped,
  stageWidth,
  stageHeight,
  onTablePointerDown,
  onTableMouseDown,
  onRotationPointerDown,
  onRotationMouseDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasPointerCancel,
  onSelectTable,
  onTableKeyDown,
  onTableDragEnter,
  onTableDragOver,
  onTableDragLeave,
  onSeatDragEnter,
  onSeatDragOver,
  onSeatDragLeave,
  onDropOnTable,
  onSeatClick,
  onSeatDoubleClick,
  onSeatKeyDown,
  onNudgeTable,
  onRotateTableBy,
  onTogglePlacementMode,
  onExitPlacementMode,
}: FloorplanTableNodeProps) {
  const isLandmark = isLandmarkTable(table);
  const isDraggingThisTable = gestureMode === 'drag';
  const isRotatingThisTable = gestureMode === 'rotate';
  const isGestureActiveOnTable = isDraggingThisTable || isRotatingThisTable;
  const renderedRotation =
    isRotatingThisTable && previewRotation !== undefined ? previewRotation : (table.rotation || 0);
  const normalizedRotation = (((Number(renderedRotation) || 0) % 360) + 360) % 360;
  const isAxisAligned = normalizedRotation % 90 === 0;

  const { assignedCount, seatOccupants } = useMemo(() => {
    if (isLandmark) {
      return {
        assignedCount: 0,
        seatOccupants: [] as Array<ResolvedSeatSummary | undefined>,
      };
    }
    const detailedSeatMap = resolveDetailedSeatAssignments(table.invitationCodes, table.capacity);
    const headcount = getGuestsHeadcount(table.invitationCodes || []);
    const summaries: Array<ResolvedSeatSummary | undefined> = new Array(table.capacity + 1);
    for (let i = 1; i <= table.capacity; i++) {
      const occupant = detailedSeatMap.get(i);
      if (occupant) {
        const isCompanionSeat = Boolean(occupant.isCompanion);
        const seatDisplayLabel = occupant.displayName;
        const dietaryBadges = occupant.dietaryBadges;
        summaries[i] = {
          assignedGuest: occupant.guest,
          isCompanionSeat,
          seatDisplayLabel,
          seatInitials: getSeatInitials(seatDisplayLabel, isCompanionSeat),
          dietaryBadges,
          dietarySummary: dietaryBadges.map((b) => b.label).join(', '),
        };
      }
    }
    return { assignedCount: headcount, seatOccupants: summaries };
  }, [isLandmark, table.invitationCodes, table.capacity]);

  const { scaledW, scaledH, seatCoordinates } = useMemo(() => {
    const { width, height } = computeScaledTableDimensions({
      shape: table.shape,
      capacity: table.capacity,
      width: table.width,
      height: table.height,
      rotation: isAxisAligned ? 0 : 45,
    });
    if (isLandmark || table.capacity <= 0) {
      return {
        scaledW: width,
        scaledH: height,
        seatCoordinates: [] as Array<{ x: number; y: number }>,
      };
    }
    const isRound = table.shape === 'round';
    const isOneSided = isOneSidedTableShape(table.shape);
    const seatOffset = isRound || isOneSided ? 18 : 16;
    const coords: Array<{ x: number; y: number }> = new Array(table.capacity + 1);
    for (let i = 1; i <= table.capacity; i++) {
      coords[i] = computeSeatPosition({
        seatNumber: i,
        capacity: table.capacity,
        shape: table.shape,
        width,
        height,
        offset: seatOffset,
      });
    }
    return { scaledW: width, scaledH: height, seatCoordinates: coords };
  }, [isLandmark, table.shape, table.capacity, table.width, table.height, isAxisAligned]);

  const { minX, minY } = useMemo(
    () =>
      computeTableMinBounds({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: normalizedRotation,
      }),
    [table.shape, table.capacity, table.width, table.height, normalizedRotation]
  );

  const matchingGuestIds = useMemo(
    () => (matchingGuestIdsKey ? new Set(matchingGuestIdsKey.split('\0')) : EMPTY_SET),
    [matchingGuestIdsKey]
  );

  const isOverCapacity = !isLandmark && assignedCount > table.capacity;
  const isFull = !isLandmark && assignedCount >= table.capacity;
  const isDropDisabled = isTableDropTarget && (isLandmark || isFull);
  const renderedX =
    isDraggingThisTable && previewX !== undefined ? previewX : Math.max(minX, table.x);
  const renderedY =
    isDraggingThisTable && previewY !== undefined ? previewY : Math.max(minY, table.y);
  const isCircularSurface = table.shape === 'round' || table.shape === 'cake';
  const isOneSided = isOneSidedTableShape(table.shape);
  const seatCounterRotate = renderedRotation ? `rotate(${-renderedRotation}deg)` : undefined;

  let handleFlipped = false;
  let toolbarLocalX = 0;
  let toolbarLocalY = 0;
  if (isSelected) {
    const cx = scaledW / 2;
    const cy = scaledH / 2;
    const rad = (renderedRotation * Math.PI) / 180;
    handleFlipped =
      isRotatingThisTable && gestureHandleFlipped !== undefined
        ? gestureHandleFlipped
        : shouldFlipRotationHandle(renderedX, renderedY, scaledW, scaledH, renderedRotation, {
          width: stageWidth,
          height: stageHeight,
        });
    const rotatedHalfExtentY =
      Math.abs(cx * Math.sin(rad)) + Math.abs(cy * Math.cos(rad)) + (isLandmark ? 8 : 34);
    const handlePoleLocalY = handleFlipped
      ? cy + ROTATION_HANDLE_POLE_OFFSET_PX
      : -(cy + ROTATION_HANDLE_POLE_OFFSET_PX);
    const handleScreenDeltaY = handlePoleLocalY * Math.cos(rad);
    const handleScreenExtentAbove = -handleScreenDeltaY + ROTATION_HANDLE_KNOB_CLEARANCE_PX;
    const handleScreenExtentBelow = handleScreenDeltaY + ROTATION_HANDLE_KNOB_CLEARANCE_PX;
    const clearanceAboveCenter = Math.max(rotatedHalfExtentY, handleScreenExtentAbove) + 21;
    const clearanceBelowCenter = Math.max(rotatedHalfExtentY, handleScreenExtentBelow) + 21;
    const placeToolbarBelow = renderedY + cy - clearanceAboveCenter < 14;
    const screenOffsetY = placeToolbarBelow ? clearanceBelowCenter : -clearanceAboveCenter;
    const minToolbarCenterX = 165;
    const maxToolbarCenterX = Math.max(minToolbarCenterX, stageWidth - 165);
    const clampedToolbarCenterX = Math.min(
      maxToolbarCenterX,
      Math.max(minToolbarCenterX, renderedX + cx)
    );
    const screenOffsetX = clampedToolbarCenterX - (renderedX + cx);
    toolbarLocalX = cx + screenOffsetX * Math.cos(rad) + screenOffsetY * Math.sin(rad);
    toolbarLocalY = cy - screenOffsetX * Math.sin(rad) + screenOffsetY * Math.cos(rad);
  }

  const renderSeats = () => {
    if (isLandmark) {
      return null;
    }

    const seats = [];
    const capacity = table.capacity;

    for (let i = 1; i <= capacity; i++) {
      const occupant = seatOccupants[i];
      const assignedGuest = occupant?.assignedGuest;
      const isCompanionSeat = Boolean(occupant?.isCompanionSeat);
      const seatDisplayLabel = occupant ? occupant.seatDisplayLabel : '';
      const dietaryBadges = occupant ? occupant.dietaryBadges : [];
      const dietarySummary = occupant ? occupant.dietarySummary : '';
      const isMatch = assignedGuest ? matchingGuestIds.has(assignedGuest.id) : false;
      const isSeatDropTarget = dropTargetSeatNumber === i;
      const isSeatDropDisabled = isSeatDropTarget && assignedCount >= capacity;
      const coords = seatCoordinates[i];
      const seatX = coords ? coords.x : 0;
      const seatY = coords ? coords.y : 0;

      seats.push(
        <React.Fragment key={i}>
          <button
            type="button"
            tabIndex={0}
            role="button"
            data-table-id={table.id}
            data-seat-number={i}
            data-is-plus-one={isCompanionSeat ? 'true' : undefined}
            aria-label={
              assignedGuest
                ? dietarySummary
                  ? `Seat ${i}: ${seatDisplayLabel}, Dietary: ${dietarySummary}`
                  : `Seat ${i}: ${seatDisplayLabel}`
                : `Seat ${i}: Empty`
            }
            onDragEnter={(e) => onSeatDragEnter(e, table.id, i)}
            onDragOver={(e) => onSeatDragOver(e, table.id, i)}
            onDragLeave={(e) => onSeatDragLeave(e, table.id, i)}
            onDrop={(e) => onDropOnTable(e, table.id, i)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeatClick(table.id, i, Boolean(assignedGuest));
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (assignedGuest) {
                onSeatDoubleClick(table, i, assignedGuest);
              }
            }}
            onKeyDown={(e) => onSeatKeyDown(e, table, i, assignedGuest)}
            data-testid={isMatch ? 'matching-seat' : undefined}
            data-seat-side={isOneSided ? 'single' : undefined}
            data-is-companion={isCompanionSeat ? 'true' : undefined}
            data-is-search-match={isMatch ? 'true' : 'false'}
            data-is-drop-target={isSeatDropTarget ? 'true' : undefined}
            title={
              assignedGuest
                ? isMatch
                  ? `Seat ${i}: ${seatDisplayLabel}${dietarySummary ? ` (${dietarySummary})` : ''} (Search Match! Double click to unassign)`
                  : `Seat ${i}: ${seatDisplayLabel}${dietarySummary ? ` (${dietarySummary})` : ''} (Double click or press Enter/Space/Delete to unassign)`
                : `Seat ${i}: Empty (Drop guest or press Enter/Space to assign)`
            }
            className={`absolute pointer-events-auto -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border text-xs font-semibold flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
              isSeatDropTarget
                ? isSeatDropDisabled
                  ? 'scale-125 bg-red-100 dark:bg-red-950/40 border-red-500 ring-2 ring-red-500 z-30 font-bold shadow-lg cursor-not-allowed'
                  : 'scale-125 bg-primary/20 border-primary ring-2 ring-primary z-30 font-bold shadow-lg'
                : assignedGuest
                  ? isMatch
                    ? 'bg-amber-700 text-white border-amber-800 ring-4 ring-amber-300 dark:ring-amber-500/50 shadow-lg scale-125 z-30 animate-pulse font-bold'
                    : isSearching
                      ? 'shadow-sm'
                      : 'shadow-sm hover:scale-110'
                  : 'hover:border-primary hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]'
            }`}
            style={
              assignedGuest
                ? isMatch
                  ? {
                    left: `${seatX}px`,
                    top: `${seatY}px`,
                    transform: seatCounterRotate,
                  }
                  : isSearching
                    ? {
                      left: `${seatX}px`,
                      top: `${seatY}px`,
                      transform: seatCounterRotate,
                      backgroundColor: 'var(--floorplan-seat-dimmed-bg, #e5e7eb)',
                      color: 'var(--floorplan-seat-dimmed-text, #374151)',
                      borderColor: 'var(--floorplan-seat-dimmed-border, #9ca3af)',
                    }
                    : {
                      left: `${seatX}px`,
                      top: `${seatY}px`,
                      transform: seatCounterRotate,
                      backgroundColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
                      color: 'var(--floorplan-seat-assigned-text, #ffffff)',
                      borderColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
                    }
                : {
                  left: `${seatX}px`,
                  top: `${seatY}px`,
                  transform: seatCounterRotate,
                  backgroundColor: isSearching
                    ? 'var(--floorplan-seat-dimmed-bg, #e5e7eb)'
                    : 'var(--floorplan-table-bg, #ffffff)',
                  color: isSearching
                    ? 'var(--floorplan-seat-dimmed-text, #374151)'
                    : 'var(--color-muted-text, #4b5563)',
                  borderColor: isSearching
                    ? 'var(--floorplan-seat-dimmed-border, #9ca3af)'
                    : 'var(--floorplan-table-border, #9ca3af)',
                  borderStyle: 'dashed',
                }
            }
          >
            {occupant ? (
              <span
                className="truncate px-0.5 text-[10px] before:content-[attr(data-initials)]"
                data-initials={occupant.seatInitials}
                aria-hidden="true"
              />
            ) : (
              <span aria-hidden="true">{i}</span>
            )}
          </button>
          {assignedGuest && isCompanionSeat && (
            <span
              data-testid="seat-plus-one-badge"
              aria-hidden="true"
              className="absolute pointer-events-none px-1 min-w-[14px] h-[14px] rounded-full bg-indigo-700 text-white text-[8px] leading-[14px] font-bold border border-white shadow-2xs z-30"
              style={{
                left: `${seatX + 4}px`,
                top: `${seatY - 16}px`,
              }}
            >
              +1
            </span>
          )}
          {assignedGuest && dietaryBadges.length > 0 && (
            <span
              data-testid="seat-dietary-badge"
              aria-hidden="true"
              className="absolute pointer-events-none px-1 min-w-[14px] h-[14px] rounded-full bg-emerald-800 text-white text-[8px] leading-[14px] font-bold border border-white shadow-2xs z-30"
              style={{
                left: `${seatX + 4}px`,
                top: `${seatY + 4}px`,
              }}
            >
              {dietaryBadges[0].shortLabel}
            </span>
          )}
        </React.Fragment>
      );
    }
    return seats;
  };

  return (
    <>
      <div
        data-table-id={table.id}
        data-table-landmark={isLandmark ? 'true' : undefined}
        data-is-drop-target={isTableDropTarget ? 'true' : undefined}
        data-drop-disabled={isDropDisabled ? 'true' : undefined}
        aria-disabled={isDropDisabled ? 'true' : undefined}
        onPointerDown={(e) => onTablePointerDown(e, table)}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onPointerCancel={onCanvasPointerCancel}
        onMouseDown={(e) => onTableMouseDown(e, table)}
        onClick={(e) => {
          e.stopPropagation();
          onSelectTable(table.id);
        }}
        onKeyDown={(e) => onTableKeyDown(e, table)}
        onDragEnter={(e) => onTableDragEnter(e, table.id)}
        onDragOver={(e) => onTableDragOver(e, table.id)}
        onDragLeave={(e) => onTableDragLeave(e, table.id)}
        onDrop={(e) => onDropOnTable(e, table.id)}
        className={`absolute cursor-move touch-none ${isGestureActiveOnTable ? 'transition-none' : 'transition-all'} transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary ${
          isTableDropTarget
            ? isDropDisabled
              ? 'ring-4 ring-red-500 border-red-500 shadow-xl shadow-red-500/20 scale-[1.03] z-30 cursor-not-allowed'
              : 'ring-4 ring-primary border-primary shadow-xl shadow-primary/20 scale-[1.03] z-30'
            : isSelected
              ? 'ring-4 ring-primary ring-offset-2 z-20'
              : 'z-10'
        } ${
          hasMatchingGuest ? 'ring-4 ring-amber-400 shadow-lg shadow-amber-300/50 dark:shadow-amber-900/50 rounded-2xl z-20' : ''
        }`}
        style={{
          left: `${renderedX}px`,
          top: `${renderedY}px`,
          width: `${scaledW}px`,
          height: `${scaledH}px`,
          transform: `rotate(${renderedRotation}deg)`,
        }}
        tabIndex={0}
        role="button"
        aria-label={
          isLandmark
            ? `${table.name}, landmark ${getSeatingShapeLabel(table.shape)}, 0 seats`
            : `${table.name}, shape ${table.shape}, capacity ${table.capacity}, seated ${assignedCount}`
        }
      >
        {/* Table or Landmark Surface */}
        <div
          className={`w-full h-full border-2 flex flex-col items-center justify-center p-2 pb-5 text-center shadow-md relative transition-colors ${
            isCircularSurface ? 'rounded-full' : ''
          } ${isLandmark ? 'border-dashed' : ''} ${
            isTableDropTarget ? (isDropDisabled ? 'border-red-500' : 'border-primary') : ''
          }`}
          style={{
            backgroundColor: isOverCapacity || isDropDisabled
              ? 'var(--floorplan-status-overcapacity-bg, #fef2f2)'
              : isLandmark
                ? 'color-mix(in srgb, var(--floorplan-table-bg, #f8fafc) 92%, #64748b)'
                : 'var(--floorplan-table-bg, #ffffff)',
            borderColor: isTableDropTarget
              ? isDropDisabled
                ? 'var(--floorplan-status-overcapacity-border, #ef4444)'
                : 'var(--color-primary, #B91C1C)'
              : isOverCapacity
                ? 'var(--floorplan-status-overcapacity-border, #ef4444)'
                : isLandmark
                  ? '#64748b'
                  : 'var(--floorplan-table-border, #d1d5db)',
            borderRadius: isCircularSurface
              ? '9999px'
              : 'var(--floorplan-table-radius, 0.75rem)',
            color: isOverCapacity || isDropDisabled
              ? 'var(--color-error-text, #991b1b)'
              : 'var(--color-foreground, #1f2937)',
          }}
        >
          <span className="font-bold text-xs truncate max-w-[90%]">{table.name}</span>
          {!isLandmark &&
            isOneSided &&
            Array.from({ length: table.capacity }, (_, idx) => (
              <span
                key={idx}
                aria-hidden="true"
                data-seat-side="single"
                className="hidden pointer-events-none"
              />
            ))}
        </div>
      </div>

      {/* Sibling Perimeter & Metadata Layer (avoids nested-interactive & WCAG 2.5.3 label-content-name-mismatch) */}
      <div
        className={`absolute pointer-events-none ${isGestureActiveOnTable ? 'transition-none' : 'transition-all'} ${
          isSelected ? 'z-30' : 'z-20'
        }`}
        style={{
          left: `${renderedX}px`,
          top: `${renderedY}px`,
          width: `${scaledW}px`,
          height: `${scaledH}px`,
          transform: `rotate(${renderedRotation}deg)`,
        }}
      >
        <div className="w-full h-full flex flex-col items-center justify-center pt-4 text-center relative">
          {isLandmark ? (
            <span
              data-testid="table-landmark-badge"
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: 'var(--color-muted-text, #4b5563)',
              }}
            >
              {getSeatingShapeLabel(table.shape)}
            </span>
          ) : (
            <span
              className="text-[10px] font-medium"
              style={{
                color: isOverCapacity
                  ? 'var(--color-error-text, #991b1b)'
                  : 'var(--color-muted-text, #4b5563)',
              }}
            >
              {assignedCount} / {table.capacity} seats
            </span>
          )}

          {/* Over capacity / Full capacity warning badges */}
          {!isLandmark && isOverCapacity ? (
            <span
              data-testid="table-overcapacity-badge"
              className="absolute -top-2 -right-2 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md animate-bounce"
              style={{
                backgroundColor: 'var(--floorplan-status-overcapacity-border, #dc2626)',
              }}
            >
              Over capacity!
            </span>
          ) : !isLandmark && isFull ? (
            <span
              data-testid="table-full-badge"
              className="absolute -top-2 -right-2 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md"
              style={{
                backgroundColor: 'var(--floorplan-status-overcapacity-border, #dc2626)',
              }}
            >
              Full
            </span>
          ) : null}

          {/* Search Match Badge */}
          {hasMatchingGuest && (
            <span
              data-testid="table-search-match-badge"
              className="absolute -top-2 -left-2 bg-amber-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md flex items-center gap-1 animate-pulse z-30"
            >
              🔍 Match
            </span>
          )}
        </div>

        {/* Individual Seat Circles around table (omitted on landmarks) */}
        {!isLandmark && renderSeats()}

        {/* Counter-Rotated Nudge, Placement & Rotation Controls and Handle for Selected Table */}
        {isSelected && (
          <>
            {/* Floating Quick Nudge, Placement & Rotation Controls (counter-rotated to screen axes) */}
            <div
              data-testid="rotation-controls"
              role="toolbar"
              aria-label={`${table.name} position and rotation controls`}
              className="absolute pointer-events-auto flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-md px-1.5 py-0.5 z-40 text-xs font-semibold select-none whitespace-nowrap"
              style={{
                left: `${toolbarLocalX}px`,
                top: `${toolbarLocalY}px`,
                transform: `translate(-50%, -50%) rotate(${-renderedRotation}deg)`,
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && isPlacementMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  onExitPlacementMode(table);
                }
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudgeTable(table, -(e.shiftKey ? NUDGE_FAST_STEP_PX : NUDGE_STEP_PX), 0);
                }}
                className="!h-7 !w-7 min-w-7 min-h-6 !p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Nudge left"
                aria-label={`Nudge ${table.name} left`}
              >
                <Icon name="ArrowLeft" size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudgeTable(table, 0, -(e.shiftKey ? NUDGE_FAST_STEP_PX : NUDGE_STEP_PX));
                }}
                className="!h-7 !w-7 min-w-7 min-h-6 !p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Nudge up"
                aria-label={`Nudge ${table.name} up`}
              >
                <Icon name="ArrowUp" size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudgeTable(table, 0, e.shiftKey ? NUDGE_FAST_STEP_PX : NUDGE_STEP_PX);
                }}
                className="!h-7 !w-7 min-w-7 min-h-6 !p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Nudge down"
                aria-label={`Nudge ${table.name} down`}
              >
                <Icon name="ArrowDown" size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudgeTable(table, e.shiftKey ? NUDGE_FAST_STEP_PX : NUDGE_STEP_PX, 0);
                }}
                className="!h-7 !w-7 min-w-7 min-h-6 !p-0 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Nudge right"
                aria-label={`Nudge ${table.name} right`}
              >
                <Icon name="ArrowRight" size={14} />
              </Button>

              <Button
                type="button"
                variant={isPlacementMode ? 'primary' : 'outline'}
                size="sm"
                pressed={isPlacementMode}
                srContext={`for ${table.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePlacementMode(table);
                }}
                className={`!h-7 min-h-6 !px-2 !py-0.5 !text-[11px] ${
                  isPlacementMode
                    ? ''
                    : 'text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title="Click any open spot on the floorplan to place this table"
              >
                <Icon name="MapPin" size={13} className="mr-1 shrink-0" />
                Place
              </Button>

              <span className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-0.5" aria-hidden="true" />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRotateTableBy(table, -45);
                }}
                className="!h-7 min-w-7 min-h-6 !px-1.5 !py-0.5 !text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Rotate -45°"
                aria-label={`Rotate ${table.name} -45 degrees`}
              >
                -45°
              </Button>
              <span className="px-1 font-mono text-[11px] text-primary" data-testid="table-rotation-display">
                {renderedRotation}°
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRotateTableBy(table, 45);
                }}
                className="!h-7 min-w-7 min-h-6 !px-1.5 !py-0.5 !text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Rotate +45°"
                aria-label={`Rotate ${table.name} +45 degrees`}
              >
                +45°
              </Button>
            </div>

            {/* Floating Handle Stem and Knob (positioned clear of seats and flipped inside stage borders) */}
            <div
              data-testid="rotation-handle"
              data-handle-flipped={handleFlipped ? 'true' : undefined}
              className={`absolute pointer-events-auto ${
                handleFlipped ? '-bottom-[76px] flex-col-reverse' : '-top-[76px] flex-col'
              } left-1/2 -translate-x-1/2 flex items-center cursor-grab active:cursor-grabbing touch-none z-40`}
              onPointerDown={(e) => onRotationPointerDown(e, table)}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerCancel}
              onMouseDown={(e) => onRotationMouseDown(e, table)}
              title={`Rotate ${table.name} (drag pointer or press 'r', Alt+Arrows)`}
            >
              <button
                type="button"
                tabIndex={0}
                aria-label={`Rotate handle for ${table.name}`}
                className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:scale-110 touch-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                style={{
                  transform: renderedRotation ? `rotate(${-renderedRotation}deg)` : undefined,
                }}
                onPointerDown={(e) => onRotationPointerDown(e, table)}
                onMouseDown={(e) => onRotationMouseDown(e, table)}
                onKeyDown={(e) => onTableKeyDown(e, table)}
              >
                <Icon name="RotateCw" size={14} />
              </button>
              <div className="w-0.5 h-3.5 bg-primary pointer-events-none" />
            </div>
          </>
        )}
      </div>
    </>
  );
}, areFloorplanTableNodePropsEqual);

function FloorplanCanvasContent({
  tables,
  guests,
  allGuests,
  selectedTableId,
  onSelectTable,
  onUpdateTablePosition,
  onUpdateTableRotation,
  onDropGuestOnTable,
  onDropGuestsOnTable,
  onUnassignGuest,
  searchQuery,
  onOpenSeatAssignModal,
  onAddTable,
  placementMode,
  onPlacementModeChange,
  emptyHeadingLevel = 'h2',
}: FloorplanCanvasProps) {
  const { confirm } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeGesture, setActiveGesture] = useState<ActivePointerGesture | null>(null);
  const activeGestureRef = useRef<ActivePointerGesture | null>(null);
  const usedPointerEventRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);
  const [internalPlacementTableId, setInternalPlacementTableId] = useState<string | null>(null);
  const [measuredViewportBounds, setMeasuredViewportBounds] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const isPlacementMode =
    Boolean(selectedTableId) &&
    (placementMode !== undefined ? placementMode : internalPlacementTableId === selectedTableId);

  const setPlacementMode = useCallback(
    (nextActive: boolean) => {
      setInternalPlacementTableId(nextActive ? selectedTableId : null);
      onPlacementModeChange?.(nextActive);
    },
    [onPlacementModeChange, selectedTableId]
  );

  const callbacksRef = useRef({ onUpdateTablePosition, onUpdateTableRotation });
  useEffect(() => {
    callbacksRef.current = { onUpdateTablePosition, onUpdateTableRotation };
  }, [onUpdateTablePosition, onUpdateTableRotation]);

  const getTableScaledBounds = useCallback(
    (table: SeatingTableDTO, rotationOverride?: number) =>
      computeScaledTableDimensions({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: rotationOverride ?? table.rotation ?? 0,
      }),
    []
  );

  const getTableMinBounds = useCallback(
    (table: SeatingTableDTO, rotationOverride?: number) =>
      computeTableMinBounds({
        shape: table.shape,
        capacity: table.capacity,
        width: table.width,
        height: table.height,
        rotation: rotationOverride ?? table.rotation ?? 0,
      }),
    []
  );

  // Compute scrollable inner stage dimensions so off-screen and high-capacity tables remain reachable
  const stageDimensions = useMemo(() => {
    let maxRight = DEFAULT_STAGE_WIDTH;
    let maxBottom = DEFAULT_STAGE_HEIGHT;
    for (const t of tables) {
      const { width: w, height: h } = getTableScaledBounds(t);
      const { minX, minY } = getTableMinBounds(t);
      maxRight = Math.max(maxRight, Math.max(minX, t.x) + w + STAGE_PADDING);
      maxBottom = Math.max(maxBottom, Math.max(minY, t.y) + h + STAGE_PADDING);
    }
    return { width: maxRight, height: maxBottom };
  }, [getTableMinBounds, getTableScaledBounds, tables]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const measure = () => {
      const rect = canvasEl.getBoundingClientRect();
      const nextWidth = Math.max(rect.width || 0, canvasEl.clientWidth || 0);
      const nextHeight = Math.max(rect.height || 0, canvasEl.clientHeight || 0);
      setMeasuredViewportBounds((prev) =>
        prev && prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvasEl);
    return () => observer.disconnect();
  }, [tables.length]);

  const renderStageBounds = useMemo(
    () => ({
      width: Math.max(stageDimensions.width, measuredViewportBounds?.width ?? 0),
      height: Math.max(stageDimensions.height, measuredViewportBounds?.height ?? 0),
    }),
    [measuredViewportBounds, stageDimensions]
  );

  const getEffectiveStageBounds = useCallback(() => {
    let stageWidth = stageDimensions.width;
    let stageHeight = stageDimensions.height;

    if (stageRef.current) {
      const stageRect = stageRef.current.getBoundingClientRect();
      stageWidth = Math.max(stageWidth, stageRect.width || 0, stageRef.current.clientWidth || 0);
      stageHeight = Math.max(stageHeight, stageRect.height || 0, stageRef.current.clientHeight || 0);
    }

    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const viewportWidth = canvasRect.width || canvasRef.current.clientWidth || 0;
      const viewportHeight = canvasRect.height || canvasRef.current.clientHeight || 0;
      stageWidth = Math.max(stageWidth, viewportWidth);
      stageHeight = Math.max(stageHeight, viewportHeight);
    }

    return { width: stageWidth, height: stageHeight };
  }, [stageDimensions]);

  const clientToStagePoint = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) {
      return { x: clientX, y: clientY };
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const scrollLeft = canvasRef.current.scrollLeft || 0;
    const scrollTop = canvasRef.current.scrollTop || 0;
    return {
      x: clientX - rect.left + scrollLeft,
      y: clientY - rect.top + scrollTop,
    };
  }, []);

  const normalizedQuery = searchQuery ? searchQuery.trim().toLowerCase() : '';
  const isSearching = normalizedQuery.length > 0;

  const resolvedGuests = guests ?? allGuests;

  const guestLookupById = useMemo(() => {
    const map = new Map<string, InvitationCodeDTO>();
    for (const g of resolvedGuests ?? []) {
      if (g?.id) map.set(g.id, g);
    }
    for (const table of tables) {
      for (const g of table.invitationCodes ?? []) {
        if (g?.id && !map.has(g.id)) {
          map.set(g.id, g);
        }
      }
    }
    return map;
  }, [resolvedGuests, tables]);

  // Compute search match counts and per-table lookup keys with memoization
  const { totalSeatedMatches, matchingTableIds, matchingGuestIdsKeyByTable } = useMemo(() => {
    if (!isSearching) {
      return {
        totalSeatedMatches: 0,
        matchingTableIds: EMPTY_SET,
        matchingGuestIdsKeyByTable: EMPTY_STRING_MAP,
      };
    }

    let count = 0;
    const tableIds = new Set<string>();
    const guestKeysByTable = new Map<string, string>();

    for (const table of tables) {
      if (!table.invitationCodes) continue;
      const tableMatchedIds: string[] = [];
      for (const guest of table.invitationCodes) {
        const nameMatch = guest.guestName.toLowerCase().includes(normalizedQuery);
        const plusOneMatch =
          getGuestPlusOneNamesList(guest).some((n) => n.toLowerCase().includes(normalizedQuery)) ||
          formatGuestPlusOneNames(guest).toLowerCase().includes(normalizedQuery);
        const codeMatch = guest.code ? guest.code.toLowerCase().includes(normalizedQuery) : false;
        const householdMatch = guest.householdName
          ? guest.householdName.toLowerCase().includes(normalizedQuery)
          : false;
        const groupMatch = guest.partyGroup
          ? guest.partyGroup.toLowerCase().includes(normalizedQuery)
          : false;
        const dietaryMatch = guest.dietaryNotes
          ? guest.dietaryNotes.toLowerCase().includes(normalizedQuery)
          : false;
        const tagMatch = guest.partyTags
          ? guest.partyTags.some((t) => t.toLowerCase().includes(normalizedQuery))
          : false;
        const mealMatch = formatGuestMealSelections(guest)
          .toLowerCase()
          .includes(normalizedQuery);
        const answerMatch = formatGuestCustomAnswers(guest)
          .toLowerCase()
          .includes(normalizedQuery);

        if (
          nameMatch ||
          plusOneMatch ||
          codeMatch ||
          householdMatch ||
          groupMatch ||
          dietaryMatch ||
          tagMatch ||
          mealMatch ||
          answerMatch
        ) {
          count++;
          tableMatchedIds.push(guest.id);
          tableIds.add(table.id);
        }
      }
      if (tableMatchedIds.length > 0) {
        guestKeysByTable.set(table.id, tableMatchedIds.join('\0'));
      }
    }

    return {
      totalSeatedMatches: count,
      matchingTableIds: tableIds,
      matchingGuestIdsKeyByTable: guestKeysByTable,
    };
  }, [tables, isSearching, normalizedQuery]);

  const canvasContextRef = useRef({
    tables,
    guestLookupById,
    isPlacementMode,
    setPlacementMode,
    getEffectiveStageBounds,
    clientToStagePoint,
    confirm,
    onSelectTable,
    onUpdateTablePosition,
    onUpdateTableRotation,
    onDropGuestOnTable,
    onDropGuestsOnTable,
    onUnassignGuest,
    onOpenSeatAssignModal,
  });
  useLayoutEffect(() => {
    canvasContextRef.current = {
      tables,
      guestLookupById,
      isPlacementMode,
      setPlacementMode,
      getEffectiveStageBounds,
      clientToStagePoint,
      confirm,
      onSelectTable,
      onUpdateTablePosition,
      onUpdateTableRotation,
      onDropGuestOnTable,
      onDropGuestsOnTable,
      onUnassignGuest,
      onOpenSeatAssignModal,
    };
  });

  // Rotate table by relative degree delta with normalization to 0-359
  const rotateTableBy = useCallback((table: SeatingTableDTO, delta: number) => {
    const current = table.rotation || 0;
    let next = Math.round((current + delta) % 360);
    if (next < 0) next += 360;
    if (next === 360) next = 0;
    canvasContextRef.current.onUpdateTableRotation?.(table.id, next);
    setLiveAnnouncement(`${table.name} rotated to ${next} degrees`);
  }, []);

  const nudgeTableBy = useCallback(
    (table: SeatingTableDTO, dx: number, dy: number) => {
      const { width: tableWidth, height: tableHeight } = getTableScaledBounds(table);
      const { minX, minY } = getTableMinBounds(table);
      const { width: canvasWidth, height: canvasHeight } =
        canvasContextRef.current.getEffectiveStageBounds();

      const baseX = Math.max(minX, table.x);
      const baseY = Math.max(minY, table.y);
      const maxX = Math.max(minX, canvasWidth - tableWidth);
      const maxY = Math.max(minY, canvasHeight - tableHeight);

      const newX = Math.round(Math.max(minX, Math.min(maxX, baseX + dx)));
      const newY = Math.round(Math.max(minY, Math.min(maxY, baseY + dy)));

      canvasContextRef.current.onUpdateTablePosition(table.id, newX, newY);
      setLiveAnnouncement(`${table.name} moved to X ${newX}, Y ${newY}`);
    },
    [getTableMinBounds, getTableScaledBounds]
  );

  const handleSelectTableById = useCallback((tableId: string) => {
    canvasContextRef.current.onSelectTable(tableId);
  }, []);

  const handleTogglePlacementModeForTable = useCallback((table: SeatingTableDTO) => {
    const next = !canvasContextRef.current.isPlacementMode;
    canvasContextRef.current.setPlacementMode(next);
    setLiveAnnouncement(
      next
        ? `Placement mode active for ${table.name}. Click an open spot on the floorplan to move table, or press Escape to exit.`
        : `Placement mode exited for ${table.name}`
    );
  }, []);

  const handleExitPlacementModeForTable = useCallback((table: SeatingTableDTO) => {
    canvasContextRef.current.setPlacementMode(false);
    setLiveAnnouncement(`Placement mode exited for ${table.name}`);
  }, []);

  useEffect(() => {
    if (!isPlacementMode) return;
    const selected = tables.find((t) => t.id === selectedTableId);
    const handlePlacementEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPlacementMode(false);
        setLiveAnnouncement(
          selected ? `Placement mode exited for ${selected.name}` : 'Placement mode exited'
        );
      }
    };
    window.addEventListener('keydown', handlePlacementEscape);
    return () => {
      window.removeEventListener('keydown', handlePlacementEscape);
    };
  }, [isPlacementMode, selectedTableId, setPlacementMode, tables]);

  // Handle table keyboard navigation, repositioning & rotation
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent, table: SeatingTableDTO) => {
      if (e.key === 'Escape' && canvasContextRef.current.isPlacementMode) {
        e.preventDefault();
        e.stopPropagation();
        canvasContextRef.current.setPlacementMode(false);
        setLiveAnnouncement(`Placement mode exited for ${table.name}`);
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        canvasContextRef.current.onSelectTable(table.id);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateTableBy(table, e.shiftKey ? -45 : 45);
        return;
      }

      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const step = e.shiftKey ? 45 : 15;
        rotateTableBy(table, e.key === 'ArrowRight' ? step : -step);
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 50 : 10;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        nudgeTableBy(table, dx, dy);
      }
    },
    [nudgeTableBy, rotateTableBy]
  );

  const updateGestureFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const gesture = activeGestureRef.current;
    if (!gesture || !canvasRef.current) return;

    if (!gesture.hasMoved && clientX === gesture.pointerStartX && clientY === gesture.pointerStartY) {
      return;
    }

    const stagePoint = canvasContextRef.current.clientToStagePoint(clientX, clientY);

    if (gesture.mode === 'rotate') {
      const centerX = gesture.x + gesture.width / 2;
      const centerY = gesture.y + gesture.height / 2;

      const dx = stagePoint.x - centerX;
      const dy = stagePoint.y - centerY;

      const angleOffset = gesture.handleFlipped ? -90 : 90;
      const deg = Math.atan2(dy, dx) * (180 / Math.PI) + angleOffset;
      let normalized = Math.round(((deg % 360) + 360) % 360);
      if (normalized === 360) normalized = 0;

      if (normalized === gesture.previewRotation && gesture.hasMoved) {
        return;
      }

      const nextGesture: ActivePointerGesture = {
        ...gesture,
        previewRotation: normalized,
        hasMoved: true,
      };
      activeGestureRef.current = nextGesture;
      setActiveGesture(nextGesture);
      return;
    }

    const { width: canvasWidth, height: canvasHeight } =
      canvasContextRef.current.getEffectiveStageBounds();
    const maxX = Math.max(gesture.minX, canvasWidth - gesture.width);
    const maxY = Math.max(gesture.minY, canvasHeight - gesture.height);

    const newX = Math.round(Math.max(gesture.minX, Math.min(maxX, stagePoint.x - gesture.offsetX)));
    const newY = Math.round(Math.max(gesture.minY, Math.min(maxY, stagePoint.y - gesture.offsetY)));

    if (newX === gesture.previewX && newY === gesture.previewY && gesture.hasMoved) {
      return;
    }

    const nextGesture: ActivePointerGesture = {
      ...gesture,
      previewX: newX,
      previewY: newY,
      hasMoved: true,
    };
    activeGestureRef.current = nextGesture;
    setActiveGesture(nextGesture);
  }, []);

  const releaseGesturePointerCapture = (gesture: ActivePointerGesture | null) => {
    if (gesture?.captureElement && gesture.pointerId !== undefined) {
      try {
        gesture.captureElement.releasePointerCapture?.(gesture.pointerId);
      } catch {
        // Ignore release errors when pointer was already released
      }
    }
  };

  const windowListenersCleanupRef = useRef<(() => void) | null>(null);

  const detachWindowListeners = useCallback(() => {
    if (windowListenersCleanupRef.current) {
      windowListenersCleanupRef.current();
      windowListenersCleanupRef.current = null;
    }
  }, []);

  const cancelActiveGesture = useCallback(() => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;
    releaseGesturePointerCapture(gesture);
    activeGestureRef.current = null;
    detachWindowListeners();
    setActiveGesture(null);
  }, [detachWindowListeners]);

  const commitActiveGesture = useCallback(() => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;

    releaseGesturePointerCapture(gesture);
    activeGestureRef.current = null;
    detachWindowListeners();
    setActiveGesture(null);

    if (gesture.hasMoved) {
      suppressCanvasClickRef.current = true;
      if (suppressClickTimeoutRef.current) {
        clearTimeout(suppressClickTimeoutRef.current);
      }
      suppressClickTimeoutRef.current = setTimeout(() => {
        suppressCanvasClickRef.current = false;
        suppressClickTimeoutRef.current = null;
      }, 0);
    }

    if (gesture.mode === 'rotate') {
      if (gesture.previewRotation !== gesture.startRotation) {
        callbacksRef.current.onUpdateTableRotation?.(gesture.tableId, gesture.previewRotation);
        setLiveAnnouncement(`${gesture.tableName} rotated to ${gesture.previewRotation} degrees`);
      }
      return;
    }

    if (
      gesture.hasMoved &&
      (gesture.previewX !== gesture.startX || gesture.previewY !== gesture.startY)
    ) {
      callbacksRef.current.onUpdateTablePosition(gesture.tableId, gesture.previewX, gesture.previewY);
      setLiveAnnouncement(`${gesture.tableName} moved to X ${gesture.previewX}, Y ${gesture.previewY}`);
    }
  }, [detachWindowListeners]);

  const attachWindowListeners = useCallback(() => {
    detachWindowListeners();

    const handleWindowPointerMove = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (gesture?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      updateGestureFromClientPoint(event.clientX, event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (gesture?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      commitActiveGesture();
    };

    const handleWindowPointerCancel = (event: PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (gesture?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      cancelActiveGesture();
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      if (activeGestureRef.current?.pointerId !== undefined) return;
      updateGestureFromClientPoint(event.clientX, event.clientY);
    };

    const handleWindowMouseUp = () => {
      if (activeGestureRef.current?.pointerId !== undefined) return;
      commitActiveGesture();
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeGestureRef.current) {
        event.preventDefault();
        cancelActiveGesture();
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('keydown', handleWindowKeyDown);

    windowListenersCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [cancelActiveGesture, commitActiveGesture, detachWindowListeners, updateGestureFromClientPoint]);

  useEffect(() => {
    return () => {
      detachWindowListeners();
      if (suppressClickTimeoutRef.current) {
        clearTimeout(suppressClickTimeoutRef.current);
      }
    };
  }, [detachWindowListeners]);

  useEffect(() => {
    const gesture = activeGestureRef.current;
    if (gesture && !tables.some((t) => t.id === gesture.tableId)) {
      cancelActiveGesture();
    }
  }, [tables, cancelActiveGesture]);

  const startRotateGesture = useCallback(
    (
      clientX: number,
      clientY: number,
      table: SeatingTableDTO,
      pointerId?: number,
      captureElement?: HTMLElement | null
    ) => {
      canvasContextRef.current.onSelectTable(table.id);

      const startRotation = table.rotation || 0;
      const { width: scaledW, height: scaledH } = getTableScaledBounds(table, startRotation);
      const { minX, minY } = getTableMinBounds(table, startRotation);
      const clampedX = Math.max(minX, table.x);
      const clampedY = Math.max(minY, table.y);
      const stageBounds = canvasContextRef.current.getEffectiveStageBounds();
      const handleFlipped = shouldFlipRotationHandle(
        clampedX,
        clampedY,
        scaledW,
        scaledH,
        startRotation,
        stageBounds
      );
      const nextGesture: ActivePointerGesture = {
        mode: 'rotate',
        tableId: table.id,
        tableName: table.name,
        startRotation,
        previewRotation: startRotation,
        handleFlipped,
        x: clampedX,
        y: clampedY,
        width: scaledW,
        height: scaledH,
        pointerStartX: clientX,
        pointerStartY: clientY,
        pointerId,
        captureElement,
        hasMoved: false,
      };
      activeGestureRef.current = nextGesture;
      setActiveGesture(nextGesture);
      attachWindowListeners();
    },
    [attachWindowListeners, getTableMinBounds, getTableScaledBounds]
  );

  const startDragGesture = useCallback(
    (
      clientX: number,
      clientY: number,
      table: SeatingTableDTO,
      pointerId?: number,
      captureElement?: HTMLElement | null
    ) => {
      canvasContextRef.current.onSelectTable(table.id);

      const { width: scaledW, height: scaledH } = getTableScaledBounds(table);
      const { minX, minY } = getTableMinBounds(table);
      const clampedX = Math.max(minX, table.x);
      const clampedY = Math.max(minY, table.y);

      let offsetX = 0;
      let offsetY = 0;
      if (canvasRef.current) {
        const stagePoint = canvasContextRef.current.clientToStagePoint(clientX, clientY);
        offsetX = stagePoint.x - clampedX;
        offsetY = stagePoint.y - clampedY;
      }

      const nextGesture: ActivePointerGesture = {
        mode: 'drag',
        tableId: table.id,
        tableName: table.name,
        startX: table.x,
        startY: table.y,
        previewX: clampedX,
        previewY: clampedY,
        minX,
        minY,
        offsetX,
        offsetY,
        width: scaledW,
        height: scaledH,
        pointerStartX: clientX,
        pointerStartY: clientY,
        pointerId,
        captureElement,
        hasMoved: false,
      };
      activeGestureRef.current = nextGesture;
      setActiveGesture(nextGesture);
      attachWindowListeners();
    },
    [attachWindowListeners, getTableMinBounds, getTableScaledBounds]
  );

  // Handle rotation pointer / mouse drag start
  const handleRotationPointerDown = useCallback(
    (e: React.PointerEvent, table: SeatingTableDTO) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
      usedPointerEventRef.current = true;
      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore synthetic pointer events in test environments
      }
      startRotateGesture(e.clientX, e.clientY, table, e.pointerId, target);
    },
    [startRotateGesture]
  );

  const handleRotationMouseDown = useCallback(
    (e: React.MouseEvent, table: SeatingTableDTO) => {
      e.stopPropagation();
      e.preventDefault();
      if (usedPointerEventRef.current) {
        usedPointerEventRef.current = false;
        return;
      }
      if (e.button !== 0) return;
      startRotateGesture(e.clientX, e.clientY, table);
    },
    [startRotateGesture]
  );

  // Handle table pointer / mouse drag start
  const handleTablePointerDown = useCallback(
    (e: React.PointerEvent, table: SeatingTableDTO) => {
      e.stopPropagation();
      if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;
      usedPointerEventRef.current = true;
      const target = e.currentTarget as HTMLElement;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore synthetic pointer events in test environments
      }
      startDragGesture(e.clientX, e.clientY, table, e.pointerId, target);
    },
    [startDragGesture]
  );

  const handleTableMouseDown = useCallback(
    (e: React.MouseEvent, table: SeatingTableDTO) => {
      e.stopPropagation();
      if (usedPointerEventRef.current) {
        usedPointerEventRef.current = false;
        return;
      }
      if (e.button !== 0) return; // Only primary click
      startDragGesture(e.clientX, e.clientY, table);
    },
    [startDragGesture]
  );

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (!gesture) return;
      if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      updateGestureFromClientPoint(e.clientX, e.clientY);
    },
    [updateGestureFromClientPoint]
  );

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (!gesture) return;
      if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      commitActiveGesture();
    },
    [commitActiveGesture]
  );

  const handleCanvasPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const gesture = activeGestureRef.current;
      if (!gesture) return;
      if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      cancelActiveGesture();
    },
    [cancelActiveGesture]
  );

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (activeGestureRef.current?.pointerId !== undefined) return;
    updateGestureFromClientPoint(e.clientX, e.clientY);
  };

  const handleCanvasMouseUp = () => {
    if (activeGestureRef.current?.pointerId !== undefined) return;
    commitActiveGesture();
  };

  const handleSeatClick = useCallback(
    (tableId: string, seatNumber: number, hasAssignedGuest: boolean) => {
      if (hasAssignedGuest) {
        canvasContextRef.current.onSelectTable(tableId);
      } else {
        canvasContextRef.current.onOpenSeatAssignModal?.(tableId, seatNumber);
      }
    },
    []
  );

  const handleSeatDoubleClick = useCallback(
    (table: SeatingTableDTO, seatNumber: number, assignedGuest: InvitationCodeDTO) => {
      canvasContextRef.current.onUnassignGuest(assignedGuest.id);
      setLiveAnnouncement(`${assignedGuest.guestName} unassigned from ${table.name} Seat ${seatNumber}`);
    },
    []
  );

  // Seat circle keyboard events
  const handleSeatKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      table: SeatingTableDTO,
      seatNumber: number,
      assignedGuest?: InvitationCodeDTO
    ) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (assignedGuest) {
          void (async () => {
            const confirmed = await canvasContextRef.current.confirm(
              `Remove ${assignedGuest.guestName} from ${table.name} (Seat ${seatNumber})?`
            );
            if (confirmed) {
              canvasContextRef.current.onUnassignGuest(assignedGuest.id);
              setLiveAnnouncement(
                `${assignedGuest.guestName} unassigned from ${table.name} Seat ${seatNumber}`
              );
            }
          })();
        } else {
          canvasContextRef.current.onOpenSeatAssignModal?.(table.id, seatNumber);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && assignedGuest) {
        e.preventDefault();
        e.stopPropagation();
        canvasContextRef.current.onUnassignGuest(assignedGuest.id);
        setLiveAnnouncement(`${assignedGuest.guestName} unassigned from ${table.name} Seat ${seatNumber}`);
      }
    },
    []
  );

  // HTML5 Drag and Drop Handlers for Dropzones
  const isTableBlockedForDrop = (targetTable: SeatingTableDTO | undefined): boolean => {
    if (!targetTable) return false;
    if (isLandmarkTable(targetTable)) return true;
    return getGuestsHeadcount(targetTable.invitationCodes || []) >= targetTable.capacity;
  };

  const handleTableDragEnter = useCallback((e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = canvasContextRef.current.tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    setActiveDropTarget((prev) =>
      prev?.type === 'table' && prev.tableId === tableId ? prev : { type: 'table', tableId }
    );
  }, []);

  const handleTableDragOver = useCallback((e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = canvasContextRef.current.tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    setActiveDropTarget((prev) =>
      prev?.type === 'table' && prev.tableId === tableId ? prev : { type: 'table', tableId }
    );
  }, []);

  const handleTableDragLeave = useCallback((e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setActiveDropTarget((prev) => (prev?.tableId === tableId ? null : prev));
  }, []);

  const handleSeatDragEnter = useCallback(
    (e: React.DragEvent, tableId: string, seatNumber: number) => {
      e.preventDefault();
      e.stopPropagation();
      const targetTable = canvasContextRef.current.tables.find((t) => t.id === tableId);
      const blocked = isTableBlockedForDrop(targetTable);
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
      }
      setActiveDropTarget((prev) =>
        prev?.type === 'seat' && prev.tableId === tableId && prev.seatNumber === seatNumber
          ? prev
          : { type: 'seat', tableId, seatNumber }
      );
    },
    []
  );

  const handleSeatDragOver = useCallback(
    (e: React.DragEvent, tableId: string, seatNumber: number) => {
      e.preventDefault();
      e.stopPropagation();
      const targetTable = canvasContextRef.current.tables.find((t) => t.id === tableId);
      const blocked = isTableBlockedForDrop(targetTable);
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
      }
      setActiveDropTarget((prev) =>
        prev?.type === 'seat' && prev.tableId === tableId && prev.seatNumber === seatNumber
          ? prev
          : { type: 'seat', tableId, seatNumber }
      );
    },
    []
  );

  const handleSeatDragLeave = useCallback(
    (e: React.DragEvent, tableId: string, seatNumber: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
        return;
      }
      if (
        e.relatedTarget &&
        (e.relatedTarget as HTMLElement).closest?.(`[data-table-id="${tableId}"]`) &&
        !(e.relatedTarget as HTMLElement).closest?.('[data-seat-number]')
      ) {
        setActiveDropTarget((prev) =>
          prev?.type === 'table' && prev.tableId === tableId ? prev : { type: 'table', tableId }
        );
      } else {
        setActiveDropTarget((prev) =>
          prev?.tableId === tableId && prev?.seatNumber === seatNumber ? null : prev
        );
      }
    },
    []
  );

  const handleDropOnTable = useCallback(
    (e: React.DragEvent, tableId: string, seatNumber?: number) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveDropTarget(null);
      const rawData = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (!rawData) return;

      const {
        tables: currentTables,
        guestLookupById: currentGuestLookup,
        onDropGuestOnTable: dropSingle,
        onDropGuestsOnTable: dropBatch,
      } = canvasContextRef.current;

      const targetTable = currentTables.find((t) => t.id === tableId);
      if (targetTable && isLandmarkTable(targetTable)) {
        setLiveAnnouncement(`Cannot assign guests to landmark "${targetTable.name}".`);
        return;
      }

      if (rawData.startsWith('household:')) {
        const guestIds = rawData
          .slice('household:'.length)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
        if (guestIds.length === 0) return;

        if (targetTable) {
          const currentSeatedIds = new Set((targetTable.invitationCodes || []).map((g) => g.id));
          const seatedHeadcount = getGuestsHeadcount(targetTable.invitationCodes || []);
          const incomingHeadcount = guestIds
            .filter((id) => !currentSeatedIds.has(id))
            .reduce((sum, id) => {
              const g = currentGuestLookup.get(id);
              return sum + (g ? getGuestPartySize(g) : 1);
            }, 0);
          const availableSeats = Math.max(0, targetTable.capacity - seatedHeadcount);
          if (incomingHeadcount > availableSeats) {
            setLiveAnnouncement(
              `Table "${targetTable.name}" only has ${availableSeats} open seat${availableSeats === 1 ? '' : 's'} for ${incomingHeadcount} household members.`
            );
            return;
          }
        }

        if (dropBatch) {
          dropBatch(guestIds, tableId);
        } else {
          guestIds.forEach((id) => dropSingle(id, tableId));
        }
        return;
      }

      const guestId = rawData;
      if (targetTable) {
        const isGuestAlreadyAtTable = targetTable.invitationCodes?.some((g) => g.id === guestId);
        if (!isGuestAlreadyAtTable) {
          const otherSeatedHeadcount = getGuestsHeadcount(
            (targetTable.invitationCodes || []).filter((g) => g.id !== guestId)
          );
          const availableSeats = Math.max(0, targetTable.capacity - otherSeatedHeadcount);
          const draggedGuest = currentGuestLookup.get(guestId);
          const requiredChairs = draggedGuest ? getGuestPartySize(draggedGuest) : 1;

          if (availableSeats <= 0) {
            setLiveAnnouncement(
              `Table "${targetTable.name}" has reached its maximum capacity of ${targetTable.capacity}.`
            );
            return;
          }

          if (requiredChairs > availableSeats) {
            setLiveAnnouncement(
              `Table "${targetTable.name}" only has ${availableSeats} open seat${availableSeats === 1 ? '' : 's'} for ${draggedGuest?.guestName || 'Guest'} (${requiredChairs} chairs needed).`
            );
            return;
          }
        }
      }

      dropSingle(guestId, tableId, seatNumber);
    },
    []
  );

  // Zero-state view when no tables exist
  if (tables.length === 0) {
    return (
      <div
        ref={canvasRef}
        className="relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner select-none flex flex-col items-center justify-center p-6 text-center print:border-none print:bg-[var(--print-bg)]"
        style={{
          backgroundColor: 'var(--canvas-bg, #f8fafc)',
          border: 'var(--canvas-border, 2px dashed #cbd5e1)',
          backgroundImage: 'radial-gradient(circle, var(--canvas-grid-dot, #cbd5e1) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        aria-label="Interactive 2D Reception Floorplan Canvas"
        role="region"
      >
        <div className="max-w-md flex flex-col items-center justify-center p-8 bg-card/80 backdrop-blur-sm rounded-2xl border border-card-border shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 dark:bg-primary/20 text-primary flex items-center justify-center mb-1">
            <svg
              className="w-8 h-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
              data-testid="empty-floorplan-icon"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <Heading
            as={emptyHeadingLevel}
            variant="none"
            unstyledColor
            className="text-lg font-bold text-heading"
          >
            No Tables Created Yet
          </Heading>
          <p className="text-xs text-muted max-w-sm">
            Get started by adding your first reception table to the floorplan. You can configure table shape, capacity, and position.
          </p>
          {onAddTable && (
            <button
              type="button"
              onClick={onAddTable}
              className="px-4 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add First Table
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={canvasRef}
      onPointerDown={() => {
        suppressCanvasClickRef.current = false;
      }}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      onPointerCancel={handleCanvasPointerCancel}
      onMouseDown={() => {
        suppressCanvasClickRef.current = false;
      }}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
          setActiveDropTarget(null);
        }
      }}
      onDragEnd={() => setActiveDropTarget(null)}
      onClick={(e) => {
        if (suppressCanvasClickRef.current) {
          suppressCanvasClickRef.current = false;
          return;
        }
        if (isPlacementMode && selectedTableId) {
          const targetTable = tables.find((t) => t.id === selectedTableId);
          if (targetTable) {
            const stagePoint = clientToStagePoint(e.clientX, e.clientY);
            const { width: scaledW, height: scaledH } = getTableScaledBounds(targetTable);
            const { minX, minY } = getTableMinBounds(targetTable);
            const { width: canvasWidth, height: canvasHeight } = getEffectiveStageBounds();
            const maxX = Math.max(minX, canvasWidth - scaledW);
            const maxY = Math.max(minY, canvasHeight - scaledH);
            const newX = Math.round(Math.max(minX, Math.min(maxX, stagePoint.x - scaledW / 2)));
            const newY = Math.round(Math.max(minY, Math.min(maxY, stagePoint.y - scaledH / 2)));
            onUpdateTablePosition(targetTable.id, newX, newY);
            setLiveAnnouncement(`${targetTable.name} moved to X ${newX}, Y ${newY}`);
            return;
          }
        }
        onSelectTable(null);
      }}
      className={`relative w-full h-[650px] rounded-xl overflow-auto shadow-inner select-none print:border-none print:bg-[var(--print-bg)] ${
        isPlacementMode ? 'cursor-crosshair' : ''
      }`}
      style={{
        backgroundColor: 'var(--canvas-bg, #f8fafc)',
        border: 'var(--canvas-border, 2px dashed #cbd5e1)',
        backgroundImage: 'radial-gradient(circle, var(--canvas-grid-dot, #cbd5e1) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
      aria-label="Interactive 2D Reception Floorplan Canvas"
      role="region"
    >
      {/* Live Region for Screen Reader Announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Scrollable Inner Stage Sized to Floorplan Bounds */}
      <div
        ref={stageRef}
        data-testid="floorplan-stage"
        className="relative"
        style={{
          minWidth: `${stageDimensions.width}px`,
          minHeight: `${stageDimensions.height}px`,
          width: '100%',
          height: '100%',
        }}
      >
        {/* Canvas Header Banner */}
        <div
          className="absolute top-3 left-3 pointer-events-none backdrop-blur border px-3 py-1.5 font-medium shadow-sm z-10 flex items-center gap-2 text-xs"
          style={{
            backgroundColor: 'var(--floorplan-table-bg, #ffffff)',
            borderColor: 'var(--floorplan-table-border, #e5e7eb)',
            borderRadius: 'var(--floorplan-table-radius, 0.5rem)',
            color: 'var(--color-foreground, #374151)',
          }}
        >
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          {isPlacementMode ? (
            <span>
              Placement mode active: Click any open spot on the floorplan to move the selected table, or press Escape to exit.
            </span>
          ) : isSearching ? (
            totalSeatedMatches > 0 ? (
              <span>
                Searching &ldquo;{searchQuery}&rdquo;: <strong className="text-amber-800 dark:text-amber-300">{totalSeatedMatches} seated match{totalSeatedMatches === 1 ? '' : 'es'}</strong> highlighted on floorplan
              </span>
            ) : (
              <span>Searching &ldquo;{searchQuery}&rdquo;: No matching seated guests on floorplan.</span>
            )
          ) : (
            <span>Drag tables to arrange floorplan, or select a table for nudge and placement controls. Drag guests onto table seats to assign.</span>
          )}
        </div>

        {tables.map((table) => {
          const isSelected = selectedTableId === table.id;
          const isActiveGestureTable = activeGesture?.tableId === table.id;
          const gestureMode = isActiveGestureTable ? activeGesture.mode : null;
          const previewX =
            isActiveGestureTable && activeGesture.mode === 'drag'
              ? activeGesture.previewX
              : undefined;
          const previewY =
            isActiveGestureTable && activeGesture.mode === 'drag'
              ? activeGesture.previewY
              : undefined;
          const previewRotation =
            isActiveGestureTable && activeGesture.mode === 'rotate'
              ? activeGesture.previewRotation
              : undefined;
          const gestureHandleFlipped =
            isActiveGestureTable && activeGesture.mode === 'rotate'
              ? activeGesture.handleFlipped
              : undefined;
          const isTableDropTarget =
            activeDropTarget?.tableId === table.id && activeDropTarget.type === 'table';
          const dropTargetSeatNumber =
            activeDropTarget?.tableId === table.id && activeDropTarget.type === 'seat'
              ? (activeDropTarget.seatNumber ?? null)
              : null;

          return (
            <FloorplanTableNode
              key={table.id}
              table={table}
              isSelected={isSelected}
              isPlacementMode={isSelected && isPlacementMode}
              isSearching={isSearching}
              hasMatchingGuest={isSearching && matchingTableIds.has(table.id)}
              matchingGuestIdsKey={
                isSearching ? (matchingGuestIdsKeyByTable.get(table.id) ?? '') : ''
              }
              isTableDropTarget={isTableDropTarget}
              dropTargetSeatNumber={dropTargetSeatNumber}
              gestureMode={gestureMode}
              previewX={previewX}
              previewY={previewY}
              previewRotation={previewRotation}
              gestureHandleFlipped={gestureHandleFlipped}
              stageWidth={renderStageBounds.width}
              stageHeight={renderStageBounds.height}
              onTablePointerDown={handleTablePointerDown}
              onTableMouseDown={handleTableMouseDown}
              onRotationPointerDown={handleRotationPointerDown}
              onRotationMouseDown={handleRotationMouseDown}
              onCanvasPointerMove={handleCanvasPointerMove}
              onCanvasPointerUp={handleCanvasPointerUp}
              onCanvasPointerCancel={handleCanvasPointerCancel}
              onSelectTable={handleSelectTableById}
              onTableKeyDown={handleTableKeyDown}
              onTableDragEnter={handleTableDragEnter}
              onTableDragOver={handleTableDragOver}
              onTableDragLeave={handleTableDragLeave}
              onSeatDragEnter={handleSeatDragEnter}
              onSeatDragOver={handleSeatDragOver}
              onSeatDragLeave={handleSeatDragLeave}
              onDropOnTable={handleDropOnTable}
              onSeatClick={handleSeatClick}
              onSeatDoubleClick={handleSeatDoubleClick}
              onSeatKeyDown={handleSeatKeyDown}
              onNudgeTable={nudgeTableBy}
              onRotateTableBy={rotateTableBy}
              onTogglePlacementMode={handleTogglePlacementModeForTable}
              onExitPlacementMode={handleExitPlacementModeForTable}
            />
          );
        })}
      </div>
    </div>
  );
}

export const FloorplanCanvas = React.memo(function FloorplanCanvas(props: FloorplanCanvasProps) {
  return (
    <EnsureToastProvider>
      <FloorplanCanvasContent {...props} />
    </EnsureToastProvider>
  );
});

