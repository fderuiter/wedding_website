'use client';

import { useReducer, useEffect, useCallback, useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { useToast } from '@/components/ui/ToastProvider';
import { resolveSeatAssignments } from '../seatLayout';
import {
  getAttendingPlusOneCount,
  getDefaultShapeDimensions,
  getRequiredChairCount,
  getTableOccupiedChairCount,
  isGuestEligibleForSeating,
  isLandmarkTable,
  isLandmarkTableShape,
} from '../utils/seatingHelpers';

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

export interface GuestSeatSnapshot {
  invitationCodeId: string;
  tableId: string | null;
  seatNumber: number | null;
  plusOneSeatNumbers?: number[];
}

export interface SeatingUndoSnapshot {
  label: string;
  assignments: GuestSeatSnapshot[];
}

export interface SeatingState {
  tables: SeatingTableDTO[];
  guests: InvitationCodeDTO[];
  isLoading: boolean;
  error: string | null;
  undoStack?: SeatingUndoSnapshot[];
}

export type SeatingAction =
  | { type: 'INIT_DATA'; payload: { tables: SeatingTableDTO[]; guests: InvitationCodeDTO[] } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | {
    type: 'ASSIGN_GUEST_OPTIMISTIC';
    payload: {
      guestId: string;
      tableId: string | null;
      seatNumber: number | null;
      plusOneSeatNumbers?: number[];
    };
  }
  | { type: 'CONFIRM_ASSIGN_GUEST'; payload: InvitationCodeDTO }
  | {
    type: 'REVERT_ASSIGN_GUEST';
    payload: {
      guestId: string;
      tableId?: string | null;
      seatNumber?: number | null;
      plusOneSeatNumbers?: number[];
      displacedGuest?: {
        guestId: string;
        seatNumber?: number | null;
      } | null;
    };
  }
  | {
    type: 'APPLY_AUTO_ASSIGN';
    payload: {
      assignedGuests: Array<{
        id: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
        [key: string]: any;
      }>;
    };
  }
  | {
    type: 'ASSIGN_BATCH_OPTIMISTIC';
    payload: {
      updates: GuestSeatSnapshot[];
      snapshotLabel: string;
      pushUndo?: boolean;
    };
  }
  | {
    type: 'CONFIRM_BATCH_ASSIGN';
    payload: {
      updatedGuests: Array<{
        id: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
        [key: string]: any;
      }>;
    };
  }
  | {
    type: 'REVERT_BATCH_ASSIGN';
    payload: {
      previousAssignments: GuestSeatSnapshot[];
      popUndo?: boolean;
      restoreUndoSnapshot?: SeatingUndoSnapshot | null;
    };
  }
  | {
    type: 'APPLY_UNDO_OPTIMISTIC';
  }
  | { type: 'CREATE_TABLE'; payload: SeatingTableDTO }
  | { type: 'UPDATE_TABLE'; payload: SeatingTableDTO }
  | { type: 'UPDATE_TABLE_POSITION'; payload: { tableId: string; x: number; y: number } }
  | { type: 'REVERT_TABLE_POSITION'; payload: { tableId: string; x: number; y: number } }
  | { type: 'UPDATE_TABLE_ROTATION'; payload: { tableId: string; rotation: number } }
  | { type: 'REVERT_TABLE_ROTATION'; payload: { tableId: string; rotation: number } }
  | { type: 'DELETE_TABLE'; payload: { tableId: string } }
  | {
    type: 'REVERT_DELETE_TABLE';
    payload: {
      table: SeatingTableDTO;
      affectedGuests: Array<{
        id: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
      }>;
    };
  };

function extractArrayPayload<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === 'object') {
    const record = json as { items?: unknown; data?: unknown };
    if (Array.isArray(record.items)) {
      return record.items as T[];
    }
    if (
      record.data &&
      typeof record.data === 'object' &&
      Array.isArray((record.data as { items?: unknown }).items)
    ) {
      return (record.data as { items: T[] }).items;
    }
    if (Array.isArray(record.data)) {
      return record.data as T[];
    }
  }
  return [];
}

function dedupeById<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (item && typeof item.id === 'string') {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    result.push(item);
  }
  return result;
}

function extractNumericMeta(json: unknown, key: 'total' | 'totalPages' | 'limit'): number | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const direct = (json as Record<string, unknown>)[key];
  if (typeof direct === 'number' && Number.isInteger(direct)) {
    return direct;
  }
  const nestedData = (json as { data?: unknown }).data;
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    const nested = (nestedData as Record<string, unknown>)[key];
    if (typeof nested === 'number' && Number.isInteger(nested)) {
      return nested;
    }
  }
  return null;
}

function detectRemainingPageCount(
  res: Response,
  json: unknown,
  firstBatchLength: number
): {
  needsPagination: boolean;
  totalCount: number | null;
} {
  const hasHeaders = Boolean(res.headers && typeof res.headers.get === 'function');
  const rawTotal = hasHeaders ? res.headers.get('X-Total-Count') : null;
  const parsedHeaderTotal = rawTotal !== null ? Number(rawTotal) : NaN;
  const bodyTotal = extractNumericMeta(json, 'total');
  const resolvedTotal = Number.isInteger(parsedHeaderTotal) ? parsedHeaderTotal : bodyTotal;

  if (resolvedTotal !== null) {
    if (resolvedTotal > firstBatchLength) {
      return { needsPagination: true, totalCount: resolvedTotal };
    }
    if (resolvedTotal >= firstBatchLength && firstBatchLength > 0) {
      return { needsPagination: false, totalCount: resolvedTotal };
    }
    if (resolvedTotal === 0 && firstBatchLength === 0) {
      return { needsPagination: false, totalCount: 0 };
    }
  }

  if (hasHeaders && res.headers.get('X-Has-Next-Page') === 'true') {
    return { needsPagination: true, totalCount: null };
  }

  const rawTotalPages = hasHeaders ? res.headers.get('X-Total-Pages') : null;
  const parsedTotalPages = rawTotalPages !== null ? Number(rawTotalPages) : NaN;
  const bodyTotalPages = extractNumericMeta(json, 'totalPages');
  const resolvedTotalPages = Number.isInteger(parsedTotalPages)
    ? parsedTotalPages
    : bodyTotalPages;
  if (resolvedTotalPages !== null && resolvedTotalPages > 1) {
    return { needsPagination: true, totalCount: null };
  }

  return { needsPagination: false, totalCount: null };
}

async function fetchRemainingPages<T extends { id?: string }>(
  endpoint: string,
  firstBatch: T[],
  totalCount: number | null
): Promise<T[]> {
  const PAGE_LIMIT = 100;

  // Re-fetch from skip=0 with deterministic primary-key ordering (`orderBy=id&orderDir=asc`)
  // so records sharing identical `createdAt` timestamps in PostgreSQL cannot shift across pages.
  if (totalCount !== null && totalCount > firstBatch.length) {
    const offsets: number[] = [];
    for (let skip = 0; skip < totalCount; skip += PAGE_LIMIT) {
      offsets.push(skip);
    }
    const pageResponses = await Promise.all(
      offsets.map((skip, idx) =>
        fetch(
          `${endpoint}?page=${idx + 1}&skip=${skip}&limit=${PAGE_LIMIT}&orderBy=id&orderDir=asc`
        )
      )
    );
    for (const r of pageResponses) {
      if (!r.ok) {
        throw new Error('Failed to load seating chart data.');
      }
    }
    const pagePayloads = await Promise.all(pageResponses.map((r) => r.json()));
    const combined: T[] = [];
    for (const payload of pagePayloads) {
      combined.push(...extractArrayPayload<T>(payload));
    }
    combined.push(...firstBatch);
    return dedupeById(combined);
  }

  const combined: T[] = [];
  let skip = 0;
  let page = 1;
  // Sequential fallback when X-Has-Next-Page is present without X-Total-Count
  while (true) {
    const nextRes = await fetch(
      `${endpoint}?page=${page}&skip=${skip}&limit=${PAGE_LIMIT}&orderBy=id&orderDir=asc`
    );
    if (!nextRes.ok) {
      throw new Error('Failed to load seating chart data.');
    }
    const nextJson = await nextRes.json();
    const nextBatch = extractArrayPayload<T>(nextJson);
    if (nextBatch.length === 0) break;
    combined.push(...nextBatch);
    skip += nextBatch.length;
    page += 1;
    const stillHasNext =
      nextRes.headers && typeof nextRes.headers.get === 'function'
        ? nextRes.headers.get('X-Has-Next-Page') === 'true'
        : false;
    if (!stillHasNext || nextBatch.length < PAGE_LIMIT) {
      break;
    }
  }
  combined.push(...firstBatch);
  return dedupeById(combined);
}

async function fetchRemainingCatalogPages<T extends { id?: string }>(
  endpoint: string,
  firstBatch: T[],
  totalCount: number | null,
  initialLimit: number
): Promise<T[]> {
  const pageLimit = Math.min(1000, Math.max(1, initialLimit));

  // Re-fetch catalog pages ordered deterministically by unique `code` (`orderBy=code&orderDir=asc`)
  if (totalCount !== null && totalCount > firstBatch.length) {
    const totalPages = Math.ceil(totalCount / pageLimit);
    const pages = Array.from({ length: totalPages }, (_, idx) => idx + 1);
    const pageResponses = await Promise.all(
      pages.map((page) =>
        fetch(`${endpoint}?page=${page}&limit=${pageLimit}&orderBy=code&orderDir=asc`)
      )
    );
    for (const r of pageResponses) {
      if (!r.ok) {
        throw new Error('Failed to load seating chart data.');
      }
    }
    const pagePayloads = await Promise.all(pageResponses.map((r) => r.json()));
    const combined: T[] = [];
    for (const payload of pagePayloads) {
      combined.push(...extractArrayPayload<T>(payload));
    }
    combined.push(...firstBatch);
    return dedupeById(combined);
  }

  const combined: T[] = [];
  let page = 1;
  while (true) {
    const nextRes = await fetch(
      `${endpoint}?page=${page}&limit=${pageLimit}&orderBy=code&orderDir=asc`
    );
    if (!nextRes.ok) {
      throw new Error('Failed to load seating chart data.');
    }
    const nextJson = await nextRes.json();
    const nextBatch = extractArrayPayload<T>(nextJson);
    if (nextBatch.length === 0) break;
    combined.push(...nextBatch);
    const bodyTotalPages = extractNumericMeta(nextJson, 'totalPages');
    const headerTotalPages =
      nextRes.headers && typeof nextRes.headers.get === 'function'
        ? Number(nextRes.headers.get('X-Total-Pages'))
        : NaN;
    const resolvedTotalPages = Number.isInteger(headerTotalPages)
      ? headerTotalPages
      : bodyTotalPages;
    if (
      (resolvedTotalPages !== null && page >= resolvedTotalPages) ||
      nextBatch.length < pageLimit
    ) {
      break;
    }
    page += 1;
  }
  combined.push(...firstBatch);
  return dedupeById(combined);
}

/**
 * Synchronizes tables' nested invitationCodes with guest assignments in a single pass O(G + T).
 */
export function syncTablesWithGuests(
  tablesList: SeatingTableDTO[],
  guestsList: InvitationCodeDTO[]
): SeatingTableDTO[] {
  const guestsByTableMap = new Map<string, InvitationCodeDTO[]>();
  for (const guest of guestsList) {
    if (guest.tableId) {
      const existing = guestsByTableMap.get(guest.tableId);
      if (existing) {
        existing.push(guest);
      } else {
        guestsByTableMap.set(guest.tableId, [guest]);
      }
    }
  }

  return tablesList.map((t) => {
    const assigned = guestsByTableMap.get(t.id) ? [...guestsByTableMap.get(t.id)!] : [];
    assigned.sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
    return {
      ...t,
      invitationCodes: assigned,
    };
  });
}

export const initialSeatingState: SeatingState = {
  tables: [],
  guests: [],
  isLoading: true,
  error: null,
  undoStack: [],
};

/**
 * Pure state reducer governing all seating transitions, table updates, and granular assignment rollbacks.
 */
export function seatingReducer(state: SeatingState, action: SeatingAction): SeatingState {
  switch (action.type) {
    case 'INIT_DATA': {
      const nextTables = syncTablesWithGuests(action.payload.tables, action.payload.guests);
      return {
        ...state,
        tables: nextTables,
        guests: action.payload.guests,
        isLoading: false,
        error: null,
      };
    }

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    case 'ASSIGN_GUEST_OPTIMISTIC': {
      const { guestId, tableId, seatNumber, plusOneSeatNumbers } = action.payload;
      const nextGuests = state.guests.map((g) => {
        if (g.id === guestId) {
          return {
            ...g,
            tableId,
            seatNumber,
            ...(plusOneSeatNumbers !== undefined
              ? { plusOneSeatNumbers }
              : !tableId
                ? { plusOneSeatNumbers: [] }
                : {}),
          };
        }
        if (
          tableId &&
          seatNumber &&
          g.tableId === tableId &&
          g.seatNumber === seatNumber
        ) {
          return { ...g, seatNumber: null };
        }
        return g;
      });

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
      };
    }

    case 'CONFIRM_ASSIGN_GUEST': {
      const returnedGuest = action.payload;
      const nextGuests = state.guests.map((g) =>
        g.id === returnedGuest.id ? { ...g, ...returnedGuest } : g
      );
      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
      };
    }

    case 'REVERT_ASSIGN_GUEST': {
      const { guestId, tableId, seatNumber, plusOneSeatNumbers, displacedGuest } = action.payload;
      const nextGuests = state.guests.map((g) => {
        if (g.id === guestId) {
          return {
            ...g,
            tableId: tableId ?? null,
            seatNumber: seatNumber ?? null,
            ...(plusOneSeatNumbers !== undefined ? { plusOneSeatNumbers } : {}),
          };
        }
        if (displacedGuest && g.id === displacedGuest.guestId) {
          return { ...g, seatNumber: displacedGuest.seatNumber ?? null };
        }
        return g;
      });

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
      };
    }

    case 'APPLY_AUTO_ASSIGN': {
      const assignedMap = new Map<string, any>();
      for (const item of action.payload.assignedGuests) {
        if (item && item.id) {
          assignedMap.set(item.id, item);
        }
      }

      const previousAssignments: GuestSeatSnapshot[] = [];
      for (const guest of state.guests) {
        if (assignedMap.has(guest.id)) {
          previousAssignments.push({
            invitationCodeId: guest.id,
            tableId: guest.tableId ?? null,
            seatNumber: guest.seatNumber ?? null,
            ...(Array.isArray(guest.plusOneSeatNumbers) && guest.plusOneSeatNumbers.length > 0
              ? { plusOneSeatNumbers: guest.plusOneSeatNumbers }
              : {}),
          });
        }
      }

      const nextGuests = state.guests.map((guest) => {
        const update = assignedMap.get(guest.id);
        if (update) {
          return {
            ...guest,
            ...update,
            tableId: update.tableId !== undefined ? update.tableId : guest.tableId,
            seatNumber: update.seatNumber !== undefined ? update.seatNumber : guest.seatNumber,
            ...(update.plusOneSeatNumbers !== undefined
              ? { plusOneSeatNumbers: update.plusOneSeatNumbers }
              : {}),
          };
        }
        return guest;
      });

      const currentStack = state.undoStack || [];
      const nextUndoStack =
        previousAssignments.length > 0
          ? [...currentStack, { label: 'Auto-Assign', assignments: previousAssignments }]
          : currentStack;

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
        undoStack: nextUndoStack,
      };
    }

    case 'ASSIGN_BATCH_OPTIMISTIC': {
      const { updates, snapshotLabel, pushUndo = true } = action.payload;
      const updateMap = new Map<string, GuestSeatSnapshot>();
      for (const u of updates) {
        updateMap.set(u.invitationCodeId, u);
      }

      const previousAssignments: GuestSeatSnapshot[] = [];
      for (const guest of state.guests) {
        if (updateMap.has(guest.id)) {
          previousAssignments.push({
            invitationCodeId: guest.id,
            tableId: guest.tableId ?? null,
            seatNumber: guest.seatNumber ?? null,
            ...(Array.isArray(guest.plusOneSeatNumbers) && guest.plusOneSeatNumbers.length > 0
              ? { plusOneSeatNumbers: guest.plusOneSeatNumbers }
              : {}),
          });
        }
      }

      const nextGuests = state.guests.map((guest) => {
        const upd = updateMap.get(guest.id);
        if (upd) {
          return {
            ...guest,
            tableId: upd.tableId,
            seatNumber: upd.seatNumber,
            plusOneSeatNumbers: upd.tableId ? (upd.plusOneSeatNumbers ?? []) : [],
          };
        }
        return guest;
      });

      const currentStack = state.undoStack || [];
      const nextUndoStack =
        pushUndo && previousAssignments.length > 0
          ? [...currentStack, { label: snapshotLabel, assignments: previousAssignments }]
          : currentStack;

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
        undoStack: nextUndoStack,
      };
    }

    case 'CONFIRM_BATCH_ASSIGN': {
      const updatedMap = new Map<string, any>();
      for (const item of action.payload.updatedGuests) {
        if (item && item.id) {
          updatedMap.set(item.id, item);
        }
      }
      const nextGuests = state.guests.map((guest) => {
        const upd = updatedMap.get(guest.id);
        if (upd) {
          return {
            ...guest,
            ...upd,
            tableId: upd.tableId !== undefined ? upd.tableId : guest.tableId,
            seatNumber: upd.seatNumber !== undefined ? upd.seatNumber : guest.seatNumber,
            ...(upd.plusOneSeatNumbers !== undefined
              ? { plusOneSeatNumbers: upd.plusOneSeatNumbers }
              : {}),
          };
        }
        return guest;
      });

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
      };
    }

    case 'REVERT_BATCH_ASSIGN': {
      const { previousAssignments, popUndo, restoreUndoSnapshot } = action.payload;
      const prevMap = new Map<string, GuestSeatSnapshot>(
        previousAssignments.map((p) => [p.invitationCodeId, p])
      );

      const nextGuests = state.guests.map((guest) => {
        const prev = prevMap.get(guest.id);
        if (prev) {
          return {
            ...guest,
            tableId: prev.tableId,
            seatNumber: prev.seatNumber,
            plusOneSeatNumbers: prev.plusOneSeatNumbers ?? [],
          };
        }
        return guest;
      });

      let nextUndoStack = state.undoStack || [];
      if (popUndo && nextUndoStack.length > 0) {
        nextUndoStack = nextUndoStack.slice(0, -1);
      }
      if (restoreUndoSnapshot) {
        nextUndoStack = [...nextUndoStack, restoreUndoSnapshot];
      }

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
        undoStack: nextUndoStack,
      };
    }

    case 'APPLY_UNDO_OPTIMISTIC': {
      const currentStack = state.undoStack || [];
      if (currentStack.length === 0) {
        return state;
      }

      const snapshot = currentStack[currentStack.length - 1];
      const nextUndoStack = currentStack.slice(0, -1);
      const restoreMap = new Map<string, GuestSeatSnapshot>(
        snapshot.assignments.map((a) => [a.invitationCodeId, a])
      );

      // Track restored seats per table so any non-restored occupant on that seat gets displaced cleanly
      const claimedSeatsByTable = new Map<string, Set<number>>();
      for (const a of snapshot.assignments) {
        if (a.tableId) {
          if (!claimedSeatsByTable.has(a.tableId)) {
            claimedSeatsByTable.set(a.tableId, new Set());
          }
          const tableSet = claimedSeatsByTable.get(a.tableId)!;
          if (typeof a.seatNumber === 'number') {
            tableSet.add(a.seatNumber);
          }
          if (Array.isArray(a.plusOneSeatNumbers)) {
            for (const ps of a.plusOneSeatNumbers) {
              if (typeof ps === 'number') tableSet.add(ps);
            }
          }
        }
      }

      const nextGuests = state.guests.map((guest) => {
        const restored = restoreMap.get(guest.id);
        if (restored) {
          return {
            ...guest,
            tableId: restored.tableId,
            seatNumber: restored.seatNumber,
            plusOneSeatNumbers: restored.tableId ? (restored.plusOneSeatNumbers ?? []) : [],
          };
        }
        if (
          guest.tableId &&
          typeof guest.seatNumber === 'number' &&
          claimedSeatsByTable.get(guest.tableId)?.has(guest.seatNumber)
        ) {
          return {
            ...guest,
            seatNumber: null,
          };
        }
        return guest;
      });

      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(state.tables, nextGuests),
        undoStack: nextUndoStack,
      };
    }

    case 'CREATE_TABLE': {
      const newTable = { ...action.payload, invitationCodes: action.payload.invitationCodes || [] };
      const nextTables = syncTablesWithGuests([...state.tables, newTable], state.guests);
      return {
        ...state,
        tables: nextTables,
      };
    }

    case 'UPDATE_TABLE': {
      const updatedTable = action.payload;
      const nextTablesList = state.tables.map((t) =>
        t.id === updatedTable.id ? { ...t, ...updatedTable } : t
      );
      return {
        ...state,
        tables: syncTablesWithGuests(nextTablesList, state.guests),
      };
    }

    case 'UPDATE_TABLE_POSITION': {
      const { tableId, x, y } = action.payload;
      const nextTables = state.tables.map((t) => (t.id === tableId ? { ...t, x, y } : t));
      return {
        ...state,
        tables: nextTables,
      };
    }

    case 'REVERT_TABLE_POSITION': {
      const { tableId, x, y } = action.payload;
      const nextTables = state.tables.map((t) => (t.id === tableId ? { ...t, x, y } : t));
      return {
        ...state,
        tables: nextTables,
      };
    }

    case 'UPDATE_TABLE_ROTATION': {
      const { tableId, rotation } = action.payload;
      const nextTables = state.tables.map((t) => (t.id === tableId ? { ...t, rotation } : t));
      return {
        ...state,
        tables: nextTables,
      };
    }

    case 'REVERT_TABLE_ROTATION': {
      const { tableId, rotation } = action.payload;
      const nextTables = state.tables.map((t) => (t.id === tableId ? { ...t, rotation } : t));
      return {
        ...state,
        tables: nextTables,
      };
    }

    case 'DELETE_TABLE': {
      const { tableId } = action.payload;
      const nextGuests = state.guests.map((g) =>
        g.tableId === tableId
          ? { ...g, tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
          : g
      );
      const nextTables = state.tables.filter((t) => t.id !== tableId);
      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(nextTables, nextGuests),
      };
    }

    case 'REVERT_DELETE_TABLE': {
      const { table, affectedGuests } = action.payload;
      const affectedMap = new Map(affectedGuests.map((g) => [g.id, g]));
      const nextGuests = state.guests.map((g) => {
        const prev = affectedMap.get(g.id);
        if (prev) {
          return {
            ...g,
            tableId: prev.tableId,
            seatNumber: prev.seatNumber,
            ...(prev.plusOneSeatNumbers !== undefined
              ? { plusOneSeatNumbers: prev.plusOneSeatNumbers }
              : {}),
          };
        }
        return g;
      });
      const restoredTables = [...state.tables, table];
      return {
        ...state,
        guests: nextGuests,
        tables: syncTablesWithGuests(restoredTables, nextGuests),
      };
    }

    default:
      return state;
  }
}

export interface UseSeatingStateOptions {
  autoFetch?: boolean;
}

export interface UseSeatingStateReturn {
  tables: SeatingTableDTO[];
  allGuests: InvitationCodeDTO[];
  unassignedGuests: InvitationCodeDTO[];
  isLoading: boolean;
  errorMsg: string | null;
  dispatch: React.Dispatch<SeatingAction>;
  fetchData: () => Promise<void>;
  assignGuestToTable: (
    guestId: string,
    tableId: string | null,
    seatNumber?: number | null
  ) => Promise<boolean>;
  assignGuestsToTable: (
    guestIds: string[],
    tableId: string | null,
    snapshotLabel?: string
  ) => Promise<boolean>;
  clearTableSeats: (tableId: string) => Promise<boolean>;
  undoLastBatchAction: () => Promise<boolean>;
  canUndo: boolean;
  undoLabel: string | null;
  unassignGuest: (guestId: string) => Promise<boolean>;
  applyAutoAssignResult: (payload: {
    assignedGuests: Array<{
      id: string;
      tableId?: string | null;
      seatNumber?: number | null;
      plusOneSeatNumbers?: number[];
      [key: string]: any;
    }>;
    assignedCount?: number;
    unassignedCount?: number;
  }) => void;
  saveTable: (tableData: Partial<SeatingTableDTO>) => Promise<boolean>;
  deleteTable: (tableId: string) => Promise<boolean>;
  updateTablePosition: (tableId: string, x: number, y: number) => Promise<boolean>;
  updateTableRotation: (tableId: string, rotation: number) => Promise<boolean>;
}

export function useSeatingState(options: UseSeatingStateOptions = {}): UseSeatingStateReturn {
  const { autoFetch = true } = options;
  const [state, dispatch] = useReducer(seatingReducer, initialSeatingState);
  const toast = useOptionalToast();

  // Derived synchronous unassigned guests collection (excludes declined RSVPs and address-collection rows)
  const unassignedGuests = useMemo(() => {
    return state.guests.filter((g) => !g.tableId && isGuestEligibleForSeating(g));
  }, [state.guests]);

  // Fetch all pages of tables and invitation codes without dropping records past row 50
  const fetchData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const [tablesRes, guestsRes] = await Promise.all([
        fetch('/api/admin/seating-tables'),
        fetch('/api/admin/invitation-codes/catalog?limit=1000'),
      ]);

      if (!tablesRes.ok || !guestsRes.ok) {
        throw new Error('Failed to load seating chart data.');
      }

      const tablesData = await tablesRes.json();
      const guestsData = await guestsRes.json();

      let rawTables = extractArrayPayload<SeatingTableDTO>(tablesData);
      let rawGuests = extractArrayPayload<InvitationCodeDTO>(guestsData);

      const tablesPageInfo = detectRemainingPageCount(tablesRes, tablesData, rawTables.length);
      const guestsPageInfo = detectRemainingPageCount(guestsRes, guestsData, rawGuests.length);

      if (tablesPageInfo.needsPagination || guestsPageInfo.needsPagination) {
        const rawCatalogLimitHeader =
          guestsRes.headers && typeof guestsRes.headers.get === 'function'
            ? Number(guestsRes.headers.get('X-Limit'))
            : NaN;
        const catalogLimit = Number.isInteger(rawCatalogLimitHeader) && rawCatalogLimitHeader > 0
          ? rawCatalogLimitHeader
          : extractNumericMeta(guestsData, 'limit') ?? (rawGuests.length || 1000);

        const [fullTables, fullGuests] = await Promise.all([
          tablesPageInfo.needsPagination
            ? fetchRemainingPages<SeatingTableDTO>(
              '/api/admin/seating-tables',
              rawTables,
              tablesPageInfo.totalCount
            )
            : Promise.resolve(rawTables),
          guestsPageInfo.needsPagination
            ? fetchRemainingCatalogPages<InvitationCodeDTO>(
              '/api/admin/invitation-codes/catalog',
              rawGuests,
              guestsPageInfo.totalCount,
              catalogLimit
            )
            : Promise.resolve(rawGuests),
        ]);
        rawTables = fullTables;
        rawGuests = fullGuests;
      }

      dispatch({
        type: 'INIT_DATA',
        payload: {
          tables: rawTables,
          guests: rawGuests,
        },
      });
    } catch (err: any) {
      dispatch({
        type: 'SET_ERROR',
        payload: err.message || 'An error occurred while loading data.',
      });
    }
  }, []);

  useEffect(() => {
    if (autoFetch) {
      fetchData();
    }
  }, [autoFetch, fetchData]);

  // Synchronously processes auto-assignment results into both table and guest collections
  const applyAutoAssignResult = useCallback(
    (payload: {
      assignedGuests: Array<{
        id: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
        [key: string]: any;
      }>;
      assignedCount?: number;
      unassignedCount?: number;
    }) => {
      dispatch({
        type: 'APPLY_AUTO_ASSIGN',
        payload: {
          assignedGuests: payload.assignedGuests || [],
        },
      });
    },
    []
  );

  // Seat assignment with party chair capacity checks, landmark guards, and granular rollback on failure
  const assignGuestToTable = useCallback(
    async (
      guestId: string,
      tableId: string | null,
      seatNumber?: number | null
    ): Promise<boolean> => {
      const targetTableId = tableId || null;
      const targetSeatNumber = targetTableId ? (seatNumber ?? null) : null;

      const currentGuest = state.guests.find((g) => g.id === guestId);
      const requiredChairs = currentGuest ? getRequiredChairCount(currentGuest) : 1;
      const plusOneCount = currentGuest ? getAttendingPlusOneCount(currentGuest) : 0;

      let optimisticPrimarySeat: number | null = targetSeatNumber;
      let optimisticPlusOneSeats: number[] | undefined = targetTableId ? undefined : [];

      // Landmark & table capacity validation prior to optimistic dispatch
      if (targetTableId) {
        const targetTable = state.tables.find((t) => t.id === targetTableId);
        if (targetTable) {
          if (isLandmarkTable(targetTable)) {
            toast?.addToast(
              `Cannot assign guests to landmark "${targetTable.name}".`,
              'error'
            );
            return false;
          }

          const otherGuests = state.guests.filter(
            (g) => g.tableId === targetTableId && g.id !== guestId
          );
          const existingOccupiedChairs = getTableOccupiedChairCount(otherGuests);
          if (existingOccupiedChairs + requiredChairs > targetTable.capacity) {
            toast?.addToast(
              `Table "${targetTable.name}" has reached its maximum capacity of ${targetTable.capacity}.`,
              'error'
            );
            return false;
          }

          if (plusOneCount > 0) {
            const resolved = resolveSeatAssignments(otherGuests, targetTable.capacity);
            const usedSeats = new Set<number>(resolved.keys());
            if (
              typeof optimisticPrimarySeat === 'number' &&
              optimisticPrimarySeat >= 1 &&
              optimisticPrimarySeat <= targetTable.capacity &&
              !usedSeats.has(optimisticPrimarySeat)
            ) {
              usedSeats.add(optimisticPrimarySeat);
            } else {
              for (let s = 1; s <= targetTable.capacity; s++) {
                if (!usedSeats.has(s)) {
                  usedSeats.add(s);
                  optimisticPrimarySeat = s;
                  break;
                }
              }
            }

            optimisticPlusOneSeats = [];
            for (let i = 0; i < plusOneCount; i++) {
              for (let s = 1; s <= targetTable.capacity; s++) {
                if (!usedSeats.has(s)) {
                  usedSeats.add(s);
                  optimisticPlusOneSeats.push(s);
                  break;
                }
              }
            }
          }
        }
      }

      if (!currentGuest) {
        return false;
      }

      // Snapshot granular previous state of affected entities only
      const previousGuestAssignment = {
        guestId: currentGuest.id,
        tableId: currentGuest.tableId,
        seatNumber: currentGuest.seatNumber,
        plusOneSeatNumbers: currentGuest.plusOneSeatNumbers,
      };

      let displacedGuest: { guestId: string; seatNumber?: number | null } | null = null;
      if (targetTableId && targetSeatNumber) {
        const existingOccupant = state.guests.find(
          (g) =>
            g.id !== guestId &&
            g.tableId === targetTableId &&
            g.seatNumber === targetSeatNumber
        );
        if (existingOccupant) {
          displacedGuest = {
            guestId: existingOccupant.id,
            seatNumber: existingOccupant.seatNumber,
          };
        }
      }

      // Optimistic update
      dispatch({
        type: 'ASSIGN_GUEST_OPTIMISTIC',
        payload: {
          guestId,
          tableId: targetTableId,
          seatNumber: optimisticPrimarySeat,
          ...(optimisticPlusOneSeats !== undefined
            ? { plusOneSeatNumbers: optimisticPlusOneSeats }
            : {}),
        },
      });

      try {
        const res = await fetch('/api/admin/seating/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitationCodeId: guestId,
            tableId: targetTableId,
            seatNumber: targetSeatNumber,
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          if (errorData.error && res.status === 400) {
            throw new Error(errorData.error);
          }
          throw new Error('Failed to assign guest seat');
        }

        const rawJson = await res.json();
        const returnedGuest: InvitationCodeDTO = rawJson?.data ?? rawJson;
        if (returnedGuest && returnedGuest.id) {
          dispatch({
            type: 'CONFIRM_ASSIGN_GUEST',
            payload: returnedGuest,
          });
        }
        return true;
      } catch (err: unknown) {
        // Granular entity rollback: reverts only the affected guest and displaced seat occupant
        dispatch({
          type: 'REVERT_ASSIGN_GUEST',
          payload: {
            guestId: previousGuestAssignment.guestId,
            tableId: previousGuestAssignment.tableId,
            seatNumber: previousGuestAssignment.seatNumber,
            plusOneSeatNumbers: previousGuestAssignment.plusOneSeatNumbers,
            displacedGuest,
          },
        });
        const message =
          err instanceof Error && err.message ? err.message : 'Error assigning guest seat';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables, state.guests, toast]
  );

  const unassignGuest = useCallback(
    async (guestId: string): Promise<boolean> => {
      return assignGuestToTable(guestId, null);
    },
    [assignGuestToTable]
  );

  // Atomic batch assignment for households and Clear Seats, with undo snapshot and rollback
  const assignGuestsToTable = useCallback(
    async (
      guestIds: string[],
      tableId: string | null,
      snapshotLabel?: string
    ): Promise<boolean> => {
      const uniqueIds = Array.from(new Set((guestIds || []).filter(Boolean)));
      if (uniqueIds.length === 0) {
        return false;
      }

      const targetTableId = tableId || null;
      const batchIdSet = new Set(uniqueIds);
      const affectedGuests = state.guests.filter((g) => batchIdSet.has(g.id));
      if (affectedGuests.length === 0) {
        return false;
      }

      if (targetTableId) {
        const targetTable = state.tables.find((t) => t.id === targetTableId);
        if (targetTable) {
          if (isLandmarkTable(targetTable)) {
            toast?.addToast(
              `Cannot assign guests to landmark "${targetTable.name}".`,
              'error'
            );
            return false;
          }

          const existingOtherChairs = getTableOccupiedChairCount(
            state.guests.filter((g) => g.tableId === targetTableId && !batchIdSet.has(g.id))
          );
          const incomingBatchChairs = getTableOccupiedChairCount(affectedGuests);

          if (existingOtherChairs + incomingBatchChairs > targetTable.capacity) {
            toast?.addToast(
              `Table "${targetTable.name}" has reached its maximum capacity of ${targetTable.capacity}.`,
              'error'
            );
            return false;
          }
        }
      }

      const previousAssignments: GuestSeatSnapshot[] = affectedGuests.map((g) => ({
        invitationCodeId: g.id,
        tableId: g.tableId ?? null,
        seatNumber: g.seatNumber ?? null,
        ...(Array.isArray(g.plusOneSeatNumbers) && g.plusOneSeatNumbers.length > 0
          ? { plusOneSeatNumbers: g.plusOneSeatNumbers }
          : {}),
      }));

      const plannedUpdates: GuestSeatSnapshot[] = [];
      if (targetTableId) {
        const targetTable = state.tables.find((t) => t.id === targetTableId);
        const cap = targetTable?.capacity ?? 50;
        const otherGuestsAtTable = state.guests.filter(
          (g) => g.tableId === targetTableId && !batchIdSet.has(g.id)
        );
        const usedSeats = new Set<number>(
          resolveSeatAssignments(otherGuestsAtTable, cap).keys()
        );
        const nextSeat = () => {
          for (let i = 1; i <= cap; i++) {
            if (!usedSeats.has(i)) {
              usedSeats.add(i);
              return i;
            }
          }
          return null;
        };

        for (const id of uniqueIds) {
          const existing = state.guests.find((g) => g.id === id);
          if (!existing) continue;
          const plusOneCount = getAttendingPlusOneCount(existing);
          let seat: number | null = null;
          if (
            existing.tableId === targetTableId &&
            typeof existing.seatNumber === 'number' &&
            existing.seatNumber >= 1 &&
            existing.seatNumber <= cap &&
            !usedSeats.has(existing.seatNumber)
          ) {
            usedSeats.add(existing.seatNumber);
            seat = existing.seatNumber;
          } else {
            seat = nextSeat();
          }

          const plusOneSeats: number[] = [];
          const prevPlusOneSeats =
            existing.tableId === targetTableId && Array.isArray(existing.plusOneSeatNumbers)
              ? existing.plusOneSeatNumbers
              : [];

          for (let i = 0; i < plusOneCount; i++) {
            const candidate = prevPlusOneSeats[i];
            if (
              typeof candidate === 'number' &&
              candidate >= 1 &&
              candidate <= cap &&
              !usedSeats.has(candidate)
            ) {
              usedSeats.add(candidate);
              plusOneSeats.push(candidate);
            } else {
              const s = nextSeat();
              if (s !== null) plusOneSeats.push(s);
            }
          }

          plannedUpdates.push({
            invitationCodeId: id,
            tableId: targetTableId,
            seatNumber: seat,
            ...(plusOneSeats.length > 0 ? { plusOneSeatNumbers: plusOneSeats } : {}),
          });
        }
      } else {
        for (const id of uniqueIds) {
          if (!state.guests.some((g) => g.id === id)) continue;
          plannedUpdates.push({
            invitationCodeId: id,
            tableId: null,
            seatNumber: null,
          });
        }
      }

      const resolvedLabel =
        snapshotLabel || (targetTableId ? 'Household Assignment' : 'Clear Seats');

      dispatch({
        type: 'ASSIGN_BATCH_OPTIMISTIC',
        payload: {
          updates: plannedUpdates,
          snapshotLabel: resolvedLabel,
          pushUndo: true,
        },
      });

      try {
        const res = await fetch('/api/admin/seating/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitationCodeIds: uniqueIds,
            tableId: targetTableId,
            action: targetTableId ? 'assignBatch' : 'clearTable',
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          if (errorData.error && res.status === 400) {
            throw new Error(errorData.error);
          }
          throw new Error(
            targetTableId ? 'Failed to assign household seats' : 'Failed to clear table seats'
          );
        }

        const json = await res.json().catch(() => ({}));
        const payload = json?.data ?? json;
        if (Array.isArray(payload?.updatedGuests)) {
          dispatch({
            type: 'CONFIRM_BATCH_ASSIGN',
            payload: {
              updatedGuests: payload.updatedGuests,
            },
          });
        }
        return true;
      } catch (err: unknown) {
        dispatch({
          type: 'REVERT_BATCH_ASSIGN',
          payload: {
            previousAssignments,
            popUndo: true,
          },
        });
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Error updating seat assignments';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables, state.guests, toast]
  );

  const clearTableSeats = useCallback(
    async (tableId: string): Promise<boolean> => {
      const targetTable = state.tables.find((t) => t.id === tableId);
      const seatedGuestIds = state.guests
        .filter((g) => g.tableId === tableId)
        .map((g) => g.id);
      if (seatedGuestIds.length === 0) {
        return true;
      }
      return assignGuestsToTable(
        seatedGuestIds,
        null,
        targetTable ? `Clear ${targetTable.name}` : 'Clear Seats'
      );
    },
    [state.tables, state.guests, assignGuestsToTable]
  );

  const undoLastBatchAction = useCallback(async (): Promise<boolean> => {
    const currentStack = state.undoStack || [];
    if (currentStack.length === 0) {
      return false;
    }

    const snapshot = currentStack[currentStack.length - 1];
    const restoreIds = new Set(snapshot.assignments.map((a) => a.invitationCodeId));

    // Capture current assignments before applying undo so we can revert if network fails
    const claimedSeatsByTable = new Map<string, Set<number>>();
    for (const a of snapshot.assignments) {
      if (a.tableId) {
        if (!claimedSeatsByTable.has(a.tableId)) {
          claimedSeatsByTable.set(a.tableId, new Set());
        }
        const tableSet = claimedSeatsByTable.get(a.tableId)!;
        if (typeof a.seatNumber === 'number') {
          tableSet.add(a.seatNumber);
        }
        if (Array.isArray(a.plusOneSeatNumbers)) {
          for (const ps of a.plusOneSeatNumbers) {
            if (typeof ps === 'number') tableSet.add(ps);
          }
        }
      }
    }

    const preUndoAssignments: GuestSeatSnapshot[] = state.guests
      .filter(
        (g) =>
          restoreIds.has(g.id) ||
          Boolean(
            g.tableId &&
              typeof g.seatNumber === 'number' &&
              claimedSeatsByTable.get(g.tableId)?.has(g.seatNumber)
          )
      )
      .map((g) => ({
        invitationCodeId: g.id,
        tableId: g.tableId ?? null,
        seatNumber: g.seatNumber ?? null,
        ...(Array.isArray(g.plusOneSeatNumbers) && g.plusOneSeatNumbers.length > 0
          ? { plusOneSeatNumbers: g.plusOneSeatNumbers }
          : {}),
      }));

    dispatch({ type: 'APPLY_UNDO_OPTIMISTIC' });

    try {
      const res = await fetch('/api/admin/seating/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: snapshot.assignments,
          action: 'undo',
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (errorData.error && res.status === 400) {
          throw new Error(errorData.error);
        }
        throw new Error('Failed to undo seat assignments');
      }

      const json = await res.json().catch(() => ({}));
      const payload = json?.data ?? json;
      if (Array.isArray(payload?.updatedGuests)) {
        dispatch({
          type: 'CONFIRM_BATCH_ASSIGN',
          payload: {
            updatedGuests: payload.updatedGuests,
          },
        });
      }
      toast?.addToast(`Restored seats prior to ${snapshot.label}.`, 'success');
      return true;
    } catch (err: unknown) {
      dispatch({
        type: 'REVERT_BATCH_ASSIGN',
        payload: {
          previousAssignments: preUndoAssignments,
          restoreUndoSnapshot: snapshot,
        },
      });
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Error undoing seat assignments';
      toast?.addToast(message, 'error');
      return false;
    }
  }, [state.undoStack, state.guests, toast]);

  // Table CRUD handlers
  const saveTable = useCallback(
    async (tableData: Partial<SeatingTableDTO>): Promise<boolean> => {
      try {
        if (tableData.id) {
          const res = await fetch(`/api/admin/seating-tables/${tableData.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tableData),
          });
          if (!res.ok) throw new Error('Failed to update table');
          const rawJson = await res.json();
          const updatedTable: SeatingTableDTO = rawJson?.data ?? rawJson;
          dispatch({
            type: 'UPDATE_TABLE',
            payload: updatedTable,
          });
          return true;
        } else {
          const defaultX = (state.tables.length % 4) * 180 + 40;
          const defaultY = Math.floor(state.tables.length / 4) * 180 + 40;
          const resolvedShape = tableData.shape ?? 'round';
          const shapeDefaults = getDefaultShapeDimensions(resolvedShape);
          const isLandmark = isLandmarkTableShape(resolvedShape);
          const res = await fetch('/api/admin/seating-tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: defaultX,
              y: defaultY,
              shape: resolvedShape,
              capacity: isLandmark ? 0 : shapeDefaults.defaultCapacity,
              width: shapeDefaults.width,
              height: shapeDefaults.height,
              rotation: 0,
              ...tableData,
              ...(isLandmark ? { capacity: 0 } : {}),
            }),
          });
          if (!res.ok) throw new Error('Failed to create table');
          const rawJson = await res.json();
          const createdTable: SeatingTableDTO = rawJson?.data ?? rawJson;
          dispatch({
            type: 'CREATE_TABLE',
            payload: createdTable,
          });
          return true;
        }
      } catch (err: unknown) {
        const message = err instanceof Error && err.message ? err.message : 'Error saving table';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables.length, toast]
  );

  const deleteTable = useCallback(
    async (tableId: string): Promise<boolean> => {
      const tableToDelete = state.tables.find((t) => t.id === tableId);
      if (!tableToDelete) return false;

      const affectedGuests = state.guests
        .filter((g) => g.tableId === tableId)
        .map((g) => ({
          id: g.id,
          tableId: g.tableId,
          seatNumber: g.seatNumber,
          plusOneSeatNumbers: g.plusOneSeatNumbers,
        }));

      dispatch({
        type: 'DELETE_TABLE',
        payload: { tableId },
      });

      try {
        const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete table');
        return true;
      } catch (err: unknown) {
        dispatch({
          type: 'REVERT_DELETE_TABLE',
          payload: {
            table: tableToDelete,
            affectedGuests,
          },
        });
        const message = err instanceof Error && err.message ? err.message : 'Error deleting table';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables, state.guests, toast]
  );

  const updateTablePosition = useCallback(
    async (tableId: string, x: number, y: number): Promise<boolean> => {
      const targetTable = state.tables.find((t) => t.id === tableId);
      const prevX = targetTable?.x ?? 0;
      const prevY = targetTable?.y ?? 0;

      dispatch({
        type: 'UPDATE_TABLE_POSITION',
        payload: { tableId, x, y },
      });

      try {
        const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x, y }),
        });
        if (!res.ok) throw new Error('Failed to update table position');
        return true;
      } catch (err: unknown) {
        dispatch({
          type: 'REVERT_TABLE_POSITION',
          payload: { tableId, x: prevX, y: prevY },
        });
        const message =
          err &&
          typeof err === 'object' &&
          'message' in err &&
          typeof (err as { message: unknown }).message === 'string' &&
          (err as { message: string }).message
            ? (err as { message: string }).message
            : 'Error updating table position';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables, toast]
  );

  const updateTableRotation = useCallback(
    async (tableId: string, rotation: number): Promise<boolean> => {
      const targetTable = state.tables.find((t) => t.id === tableId);
      const prevRotation = targetTable?.rotation ?? 0;

      dispatch({
        type: 'UPDATE_TABLE_ROTATION',
        payload: { tableId, rotation },
      });

      try {
        const res = await fetch(`/api/admin/seating-tables/${tableId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotation }),
        });
        if (!res.ok) throw new Error('Failed to update table rotation');
        return true;
      } catch (err: unknown) {
        dispatch({
          type: 'REVERT_TABLE_ROTATION',
          payload: { tableId, rotation: prevRotation },
        });
        const message =
          err &&
          typeof err === 'object' &&
          'message' in err &&
          typeof (err as { message: unknown }).message === 'string' &&
          (err as { message: string }).message
            ? (err as { message: string }).message
            : 'Error updating table rotation';
        toast?.addToast(message, 'error');
        return false;
      }
    },
    [state.tables, toast]
  );

  const undoStack = state.undoStack || [];
  const canUndo = undoStack.length > 0;
  const undoLabel = canUndo ? undoStack[undoStack.length - 1].label : null;

  return {
    tables: state.tables,
    allGuests: state.guests,
    unassignedGuests,
    isLoading: state.isLoading,
    errorMsg: state.error,
    dispatch,
    fetchData,
    assignGuestToTable,
    assignGuestsToTable,
    clearTableSeats,
    undoLastBatchAction,
    canUndo,
    undoLabel,
    unassignGuest,
    applyAutoAssignResult,
    saveTable,
    deleteTable,
    updateTablePosition,
    updateTableRotation,
  };
}

export const useSeatingChartState = useSeatingState;
