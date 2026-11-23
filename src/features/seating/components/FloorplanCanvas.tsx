'use client';

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { SeatingTableDTO } from '../schemas';
import {
  InvitationCodeDTO,
  formatGuestCustomAnswers,
  formatGuestMealSelections,
  formatGuestPlusOneNames,
} from '@/features/registry';
import { computeSeatPosition, resolveDetailedSeatAssignments } from '../seatLayout';
import {
  getGuestPartySize,
  getGuestPlusOneNamesList,
  getGuestsHeadcount,
  getSeatingShapeLabel,
  isLandmarkTable,
  isOneSidedTableShape,
} from '../utils/seatingHelpers';

const EMPTY_SET = new Set<string>();
const DEFAULT_STAGE_WIDTH = 800;
const DEFAULT_STAGE_HEIGHT = 650;
const STAGE_PADDING = 48;

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

export const FloorplanCanvas = React.memo(function FloorplanCanvas({
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
}: FloorplanCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeGesture, setActiveGesture] = useState<ActivePointerGesture | null>(null);
  const activeGestureRef = useRef<ActivePointerGesture | null>(null);
  const usedPointerEventRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const suppressClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);

  const callbacksRef = useRef({ onUpdateTablePosition, onUpdateTableRotation });
  callbacksRef.current = { onUpdateTablePosition, onUpdateTableRotation };

  // Compute scrollable inner stage dimensions so off-screen tables remain reachable on narrow viewports
  const stageDimensions = useMemo(() => {
    let maxRight = DEFAULT_STAGE_WIDTH;
    let maxBottom = DEFAULT_STAGE_HEIGHT;
    for (const t of tables) {
      const w = t.width || 120;
      const h = t.height || 120;
      maxRight = Math.max(maxRight, t.x + w + STAGE_PADDING);
      maxBottom = Math.max(maxBottom, t.y + h + STAGE_PADDING);
    }
    return { width: maxRight, height: maxBottom };
  }, [tables]);

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

  // Compute search match counts and lookup Sets with memoization
  const { totalSeatedMatches, matchingGuestIds, matchingTableIds } = useMemo(() => {
    if (!isSearching) {
      return {
        totalSeatedMatches: 0,
        matchingGuestIds: EMPTY_SET,
        matchingTableIds: EMPTY_SET,
      };
    }

    let count = 0;
    const guestIds = new Set<string>();
    const tableIds = new Set<string>();

    for (const table of tables) {
      if (!table.invitationCodes) continue;
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
          guestIds.add(guest.id);
          tableIds.add(table.id);
        }
      }
    }

    return {
      totalSeatedMatches: count,
      matchingGuestIds: guestIds,
      matchingTableIds: tableIds,
    };
  }, [tables, isSearching, normalizedQuery]);

  // Rotate table by relative degree delta with normalization to 0-359
  const rotateTableBy = (table: SeatingTableDTO, delta: number) => {
    const current = table.rotation || 0;
    let next = Math.round((current + delta) % 360);
    if (next < 0) next += 360;
    if (next === 360) next = 0;
    onUpdateTableRotation?.(table.id, next);
    setLiveAnnouncement(`${table.name} rotated to ${next} degrees`);
  };

  // Handle table keyboard navigation, repositioning & rotation
  const handleTableKeyDown = (e: React.KeyboardEvent, table: SeatingTableDTO) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectTable(table.id);
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

      const tableWidth = table.width || 120;
      const tableHeight = table.height || 120;
      const { width: canvasWidth, height: canvasHeight } = getEffectiveStageBounds();

      const maxX = Math.max(0, canvasWidth - tableWidth);
      const maxY = Math.max(0, canvasHeight - tableHeight);

      const newX = Math.max(0, Math.min(maxX, table.x + dx));
      const newY = Math.max(0, Math.min(maxY, table.y + dy));

      onUpdateTablePosition(table.id, Math.round(newX), Math.round(newY));
      setLiveAnnouncement(`${table.name} moved to X ${Math.round(newX)}, Y ${Math.round(newY)}`);
    }
  };

  const updateGestureFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const gesture = activeGestureRef.current;
    if (!gesture || !canvasRef.current) return;

    if (!gesture.hasMoved && clientX === gesture.pointerStartX && clientY === gesture.pointerStartY) {
      return;
    }

    const stagePoint = clientToStagePoint(clientX, clientY);

    if (gesture.mode === 'rotate') {
      const centerX = gesture.x + gesture.width / 2;
      const centerY = gesture.y + gesture.height / 2;

      const dx = stagePoint.x - centerX;
      const dy = stagePoint.y - centerY;

      const deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
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

    const { width: canvasWidth, height: canvasHeight } = getEffectiveStageBounds();
    const maxX = Math.max(0, canvasWidth - gesture.width);
    const maxY = Math.max(0, canvasHeight - gesture.height);

    const newX = Math.round(Math.max(0, Math.min(maxX, stagePoint.x - gesture.offsetX)));
    const newY = Math.round(Math.max(0, Math.min(maxY, stagePoint.y - gesture.offsetY)));

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
  }, [clientToStagePoint, getEffectiveStageBounds]);

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

    if (gesture.previewX !== gesture.startX || gesture.previewY !== gesture.startY) {
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

  const startRotateGesture = (
    clientX: number,
    clientY: number,
    table: SeatingTableDTO,
    pointerId?: number,
    captureElement?: HTMLElement | null
  ) => {
    onSelectTable(table.id);

    const startRotation = table.rotation || 0;
    const nextGesture: ActivePointerGesture = {
      mode: 'rotate',
      tableId: table.id,
      tableName: table.name,
      startRotation,
      previewRotation: startRotation,
      x: table.x,
      y: table.y,
      width: table.width || 120,
      height: table.height || 120,
      pointerStartX: clientX,
      pointerStartY: clientY,
      pointerId,
      captureElement,
      hasMoved: false,
    };
    activeGestureRef.current = nextGesture;
    setActiveGesture(nextGesture);
    attachWindowListeners();
  };

  const startDragGesture = (
    clientX: number,
    clientY: number,
    table: SeatingTableDTO,
    pointerId?: number,
    captureElement?: HTMLElement | null
  ) => {
    onSelectTable(table.id);

    let offsetX = 0;
    let offsetY = 0;
    if (canvasRef.current) {
      const stagePoint = clientToStagePoint(clientX, clientY);
      offsetX = stagePoint.x - table.x;
      offsetY = stagePoint.y - table.y;
    }

    const nextGesture: ActivePointerGesture = {
      mode: 'drag',
      tableId: table.id,
      tableName: table.name,
      startX: table.x,
      startY: table.y,
      previewX: table.x,
      previewY: table.y,
      offsetX,
      offsetY,
      width: table.width || 120,
      height: table.height || 120,
      pointerStartX: clientX,
      pointerStartY: clientY,
      pointerId,
      captureElement,
      hasMoved: false,
    };
    activeGestureRef.current = nextGesture;
    setActiveGesture(nextGesture);
    attachWindowListeners();
  };

  // Handle rotation pointer / mouse drag start
  const handleRotationPointerDown = (e: React.PointerEvent, table: SeatingTableDTO) => {
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
  };

  const handleRotationMouseDown = (e: React.MouseEvent, table: SeatingTableDTO) => {
    e.stopPropagation();
    e.preventDefault();
    if (usedPointerEventRef.current) {
      usedPointerEventRef.current = false;
      return;
    }
    if (e.button !== 0) return;
    startRotateGesture(e.clientX, e.clientY, table);
  };

  // Handle table pointer / mouse drag start
  const handleTablePointerDown = (e: React.PointerEvent, table: SeatingTableDTO) => {
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
  };

  const handleTableMouseDown = (e: React.MouseEvent, table: SeatingTableDTO) => {
    e.stopPropagation();
    if (usedPointerEventRef.current) {
      usedPointerEventRef.current = false;
      return;
    }
    if (e.button !== 0) return; // Only primary click
    startDragGesture(e.clientX, e.clientY, table);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;
    if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
    updateGestureFromClientPoint(e.clientX, e.clientY);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;
    if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
    commitActiveGesture();
  };

  const handleCanvasPointerCancel = (e: React.PointerEvent) => {
    const gesture = activeGestureRef.current;
    if (!gesture) return;
    if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
    cancelActiveGesture();
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (activeGestureRef.current?.pointerId !== undefined) return;
    updateGestureFromClientPoint(e.clientX, e.clientY);
  };

  const handleCanvasMouseUp = () => {
    if (activeGestureRef.current?.pointerId !== undefined) return;
    commitActiveGesture();
  };

  // Seat circle keyboard events
  const handleSeatKeyDown = (
    e: React.KeyboardEvent,
    table: SeatingTableDTO,
    seatNumber: number,
    assignedGuest?: InvitationCodeDTO
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (assignedGuest) {
        onUnassignGuest(assignedGuest.id);
        setLiveAnnouncement(`${assignedGuest.guestName} unassigned from ${table.name} Seat ${seatNumber}`);
      } else {
        onOpenSeatAssignModal?.(table.id, seatNumber);
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && assignedGuest) {
      e.preventDefault();
      e.stopPropagation();
      onUnassignGuest(assignedGuest.id);
      setLiveAnnouncement(`${assignedGuest.guestName} unassigned from ${table.name} Seat ${seatNumber}`);
    }
  };

  // HTML5 Drag and Drop Handlers for Dropzones
  const isTableBlockedForDrop = (targetTable: SeatingTableDTO | undefined): boolean => {
    if (!targetTable) return false;
    if (isLandmarkTable(targetTable)) return true;
    return getGuestsHeadcount(targetTable.invitationCodes || []) >= targetTable.capacity;
  };

  const handleTableDragEnter = (e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    setActiveDropTarget({ type: 'table', tableId });
  };

  const handleTableDragOver = (e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    if (!activeDropTarget || activeDropTarget.type !== 'table' || activeDropTarget.tableId !== tableId) {
      setActiveDropTarget({ type: 'table', tableId });
    }
  };

  const handleTableDragLeave = (e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setActiveDropTarget((prev) => (prev?.tableId === tableId ? null : prev));
  };

  const handleSeatDragEnter = (e: React.DragEvent, tableId: string, seatNumber: number) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    setActiveDropTarget({ type: 'seat', tableId, seatNumber });
  };

  const handleSeatDragOver = (e: React.DragEvent, tableId: string, seatNumber: number) => {
    e.preventDefault();
    e.stopPropagation();
    const targetTable = tables.find((t) => t.id === tableId);
    const blocked = isTableBlockedForDrop(targetTable);
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    }
    if (
      !activeDropTarget ||
      activeDropTarget.type !== 'seat' ||
      activeDropTarget.tableId !== tableId ||
      activeDropTarget.seatNumber !== seatNumber
    ) {
      setActiveDropTarget({ type: 'seat', tableId, seatNumber });
    }
  };

  const handleSeatDragLeave = (e: React.DragEvent, tableId: string, seatNumber: number) => {
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
      setActiveDropTarget({ type: 'table', tableId });
    } else {
      setActiveDropTarget((prev) =>
        prev?.tableId === tableId && prev?.seatNumber === seatNumber ? null : prev
      );
    }
  };

  const handleDropOnTable = (e: React.DragEvent, tableId: string, seatNumber?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDropTarget(null);
    const rawData = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
    if (!rawData) return;

    const targetTable = tables.find((t) => t.id === tableId);
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
            const g = guestLookupById.get(id);
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

      if (onDropGuestsOnTable) {
        onDropGuestsOnTable(guestIds, tableId);
      } else {
        guestIds.forEach((id) => onDropGuestOnTable(id, tableId));
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
        const draggedGuest = guestLookupById.get(guestId);
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

    onDropGuestOnTable(guestId, tableId, seatNumber);
  };

  // Helper to render seat positions around table
  const renderSeats = (table: SeatingTableDTO) => {
    if (isLandmarkTable(table)) {
      return null;
    }

    const seats = [];
    const capacity = table.capacity;
    const detailedSeatMap = resolveDetailedSeatAssignments(table.invitationCodes, capacity);
    const tableSeatedHeadcount = getGuestsHeadcount(table.invitationCodes || []);
    const isRound = table.shape === 'round';
    const isOneSided = isOneSidedTableShape(table.shape);
    const width = table.width || 120;
    const height = table.height || 120;
    const seatOffset = isRound || isOneSided ? 18 : 16;

    for (let i = 1; i <= capacity; i++) {
      const occupant = detailedSeatMap.get(i);
      const assignedGuest = occupant?.guest;
      const isCompanionSeat = Boolean(occupant?.isCompanion);
      const seatDisplayLabel = occupant ? occupant.displayName : '';
      const dietaryBadges = occupant ? occupant.dietaryBadges : [];
      const dietarySummary = dietaryBadges.map((b) => b.label).join(', ');
      const isMatch = assignedGuest ? matchingGuestIds.has(assignedGuest.id) : false;
      const isSeatDropTarget =
        activeDropTarget?.tableId === table.id &&
        activeDropTarget?.type === 'seat' &&
        activeDropTarget?.seatNumber === i;
      const isSeatDropDisabled = isSeatDropTarget && tableSeatedHeadcount >= table.capacity;

      const { x: seatX, y: seatY } = computeSeatPosition({
        seatNumber: i,
        capacity,
        shape: table.shape,
        width,
        height,
        offset: seatOffset,
      });

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
            onDragEnter={(e) => handleSeatDragEnter(e, table.id, i)}
            onDragOver={(e) => handleSeatDragOver(e, table.id, i)}
            onDragLeave={(e) => handleSeatDragLeave(e, table.id, i)}
            onDrop={(e) => handleDropOnTable(e, table.id, i)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (assignedGuest) {
                onSelectTable(table.id);
              } else {
                onOpenSeatAssignModal?.(table.id, i);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (assignedGuest) {
                onUnassignGuest(assignedGuest.id);
                setLiveAnnouncement(`${assignedGuest.guestName} unassigned from ${table.name} Seat ${i}`);
              }
            }}
            onKeyDown={(e) => handleSeatKeyDown(e, table, i, assignedGuest)}
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
            className={`absolute pointer-events-auto transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border text-xs font-semibold flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-primary ${
              isSeatDropTarget
                ? isSeatDropDisabled
                  ? 'scale-125 bg-red-100 dark:bg-red-950/40 border-red-500 ring-2 ring-red-500 z-30 font-bold shadow-lg cursor-not-allowed'
                  : 'scale-125 bg-primary/20 border-primary ring-2 ring-primary z-30 font-bold shadow-lg'
                : assignedGuest
                  ? isMatch
                    ? 'bg-amber-500 text-white border-amber-600 ring-4 ring-amber-300 dark:ring-amber-500/50 shadow-lg scale-125 z-30 animate-pulse font-bold'
                    : isSearching
                      ? 'opacity-60 shadow-sm'
                      : 'shadow-sm hover:scale-110'
                  : 'hover:border-primary hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]'
            }`}
            style={
              assignedGuest
                ? isMatch
                  ? {
                    left: `${seatX}px`,
                    top: `${seatY}px`,
                  }
                  : {
                    left: `${seatX}px`,
                    top: `${seatY}px`,
                    backgroundColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
                    color: 'var(--floorplan-seat-assigned-text, #ffffff)',
                    borderColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
                  }
                : {
                  left: `${seatX}px`,
                  top: `${seatY}px`,
                  backgroundColor: 'var(--floorplan-table-bg, #ffffff)',
                  color: 'color-mix(in srgb, var(--color-foreground, #1f2937) 75%, transparent)',
                  borderColor: 'var(--floorplan-table-border, #9ca3af)',
                  borderStyle: 'dashed',
                }
            }
          >
            {assignedGuest ? (
              <span
                className="truncate px-0.5 text-[10px] before:content-[attr(data-initials)]"
                data-initials={getSeatInitials(seatDisplayLabel, isCompanionSeat)}
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
          <h3 className="text-lg font-bold text-heading">
            No Tables Created Yet
          </h3>
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
      onClick={() => {
        if (suppressCanvasClickRef.current) {
          suppressCanvasClickRef.current = false;
          return;
        }
        onSelectTable(null);
      }}
      className="relative w-full h-[650px] rounded-xl overflow-auto shadow-inner select-none print:border-none print:bg-[var(--print-bg)]"
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
          className="absolute top-3 left-3 backdrop-blur border px-3 py-1.5 font-medium shadow-sm z-10 flex items-center gap-2 text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--floorplan-table-bg, #ffffff) 90%, transparent)',
            borderColor: 'var(--floorplan-table-border, #e5e7eb)',
            borderRadius: 'var(--floorplan-table-radius, 0.5rem)',
            color: 'var(--color-foreground, #374151)',
          }}
        >
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          {isSearching ? (
            totalSeatedMatches > 0 ? (
              <span>
                Searching &ldquo;{searchQuery}&rdquo;: <strong className="text-amber-600 dark:text-amber-400">{totalSeatedMatches} seated match{totalSeatedMatches === 1 ? '' : 'es'}</strong> highlighted on floorplan
              </span>
            ) : (
              <span>Searching &ldquo;{searchQuery}&rdquo;: No matching seated guests on floorplan.</span>
            )
          ) : (
            <span>Drag tables to arrange floorplan. Drag guests onto table seats to assign.</span>
          )}
        </div>

        {tables.map((table) => {
          const isLandmark = isLandmarkTable(table);
          const assignedCount = isLandmark ? 0 : getGuestsHeadcount(table.invitationCodes || []);
          const isSelected = selectedTableId === table.id;
          const isOverCapacity = !isLandmark && assignedCount > table.capacity;
          const isFull = !isLandmark && assignedCount >= table.capacity;
          const hasMatchingGuest = isSearching && matchingTableIds.has(table.id);
          const isTableDropTarget = activeDropTarget?.tableId === table.id && activeDropTarget?.type === 'table';
          const isDropDisabled = isTableDropTarget && (isLandmark || isFull);
          const isDraggingThisTable = activeGesture?.mode === 'drag' && activeGesture.tableId === table.id;
          const isRotatingThisTable = activeGesture?.mode === 'rotate' && activeGesture.tableId === table.id;
          const isGestureActiveOnTable = isDraggingThisTable || isRotatingThisTable;
          const renderedX = isDraggingThisTable ? activeGesture.previewX : table.x;
          const renderedY = isDraggingThisTable ? activeGesture.previewY : table.y;
          const renderedRotation = isRotatingThisTable ? activeGesture.previewRotation : (table.rotation || 0);
          const isCircularSurface = table.shape === 'round' || table.shape === 'cake';

          return (
            <React.Fragment key={table.id}>
              <div
                data-table-id={table.id}
                data-table-landmark={isLandmark ? 'true' : undefined}
                data-is-drop-target={isTableDropTarget ? 'true' : undefined}
                data-drop-disabled={isDropDisabled ? 'true' : undefined}
                aria-disabled={isDropDisabled ? 'true' : undefined}
                onPointerDown={(e) => handleTablePointerDown(e, table)}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerCancel}
                onMouseDown={(e) => handleTableMouseDown(e, table)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTable(table.id);
                }}
                onKeyDown={(e) => handleTableKeyDown(e, table)}
                onDragEnter={(e) => handleTableDragEnter(e, table.id)}
                onDragOver={(e) => handleTableDragOver(e, table.id)}
                onDragLeave={(e) => handleTableDragLeave(e, table.id)}
                onDrop={(e) => handleDropOnTable(e, table.id)}
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
                  width: `${table.width || 120}px`,
                  height: `${table.height || 120}px`,
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
                      ? 'var(--floorplan-status-overcapacity-border, #991b1b)'
                      : 'var(--color-foreground, #1f2937)',
                  }}
                >
                  <span className="font-bold text-xs truncate max-w-[90%]">{table.name}</span>
                  {!isLandmark &&
                    isOneSidedTableShape(table.shape) &&
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
                  width: `${table.width || 120}px`,
                  height: `${table.height || 120}px`,
                  transform: `rotate(${renderedRotation}deg)`,
                }}
              >
                <div className="w-full h-full flex flex-col items-center justify-center pt-4 text-center relative">
                  {isLandmark ? (
                    <span
                      data-testid="table-landmark-badge"
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        color: 'color-mix(in srgb, var(--color-foreground, #1f2937) 75%, transparent)',
                      }}
                    >
                      {getSeatingShapeLabel(table.shape)}
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-medium"
                      style={{
                        color: isOverCapacity
                          ? 'var(--floorplan-status-overcapacity-border, #991b1b)'
                          : 'color-mix(in srgb, var(--color-foreground, #1f2937) 65%, transparent)',
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
                      className="absolute -top-2 -left-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md flex items-center gap-1 animate-pulse z-30"
                    >
                      🔍 Match
                    </span>
                  )}
                </div>

                {/* Individual Seat Circles around table (omitted on landmarks) */}
                {!isLandmark && renderSeats(table)}

                {/* Rotation Controls and Handle for Selected Table */}
                {isSelected && (
                  <>
                    {/* Floating Quick Rotation Controls */}
                    <div
                      data-testid="rotation-controls"
                      className="absolute pointer-events-auto -top-[104px] left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md px-2 py-1 z-40 text-xs font-semibold select-none"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          rotateTableBy(table, -45);
                        }}
                        className="min-w-7 min-h-6 inline-flex items-center justify-center px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary"
                        title="Rotate -45°"
                        aria-label={`Rotate ${table.name} -45 degrees`}
                      >
                        -45°
                      </button>
                      <span className="px-1 font-mono text-[11px] text-primary" data-testid="table-rotation-display">
                        {renderedRotation}°
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          rotateTableBy(table, 45);
                        }}
                        className="min-w-7 min-h-6 inline-flex items-center justify-center px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary"
                        title="Rotate +45°"
                        aria-label={`Rotate ${table.name} +45 degrees`}
                      >
                        +45°
                      </button>
                    </div>

                    {/* Floating Handle Stem and Knob */}
                    <div
                      data-testid="rotation-handle"
                      className="absolute pointer-events-auto -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none z-40"
                      onPointerDown={(e) => handleRotationPointerDown(e, table)}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={handleCanvasPointerCancel}
                      onMouseDown={(e) => handleRotationMouseDown(e, table)}
                      title={`Rotate ${table.name} (drag pointer or press 'r', Alt+Arrows)`}
                    >
                      <button
                        type="button"
                        tabIndex={0}
                        aria-label={`Rotate handle for ${table.name}`}
                        className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:scale-110 touch-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                        onPointerDown={(e) => handleRotationPointerDown(e, table)}
                        onMouseDown={(e) => handleRotationMouseDown(e, table)}
                        onKeyDown={(e) => handleTableKeyDown(e, table)}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                      <div className="w-0.5 h-3 bg-primary" />
                    </div>
                  </>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
});

