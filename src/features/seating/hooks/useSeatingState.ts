'use client';

import { useReducer, useEffect, useCallback, useMemo } from 'react';
import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { useToast } from '@/components/ui/ToastProvider';

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

export interface SeatingState {
  tables: SeatingTableDTO[];
  guests: InvitationCodeDTO[];
  isLoading: boolean;
  error: string | null;
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
    };
  }
  | { type: 'CONFIRM_ASSIGN_GUEST'; payload: InvitationCodeDTO }
  | {
    type: 'REVERT_ASSIGN_GUEST';
    payload: {
      guestId: string;
      tableId?: string | null;
      seatNumber?: number | null;
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
        [key: string]: any;
      }>;
    };
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
      }>;
    };
  };

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
      const { guestId, tableId, seatNumber } = action.payload;
      const nextGuests = state.guests.map((g) => {
        if (g.id === guestId) {
          return { ...g, tableId, seatNumber };
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
      const { guestId, tableId, seatNumber, displacedGuest } = action.payload;
      const nextGuests = state.guests.map((g) => {
        if (g.id === guestId) {
          return { ...g, tableId: tableId ?? null, seatNumber: seatNumber ?? null };
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

      const nextGuests = state.guests.map((guest) => {
        const update = assignedMap.get(guest.id);
        if (update) {
          return {
            ...guest,
            ...update,
            tableId: update.tableId !== undefined ? update.tableId : guest.tableId,
            seatNumber: update.seatNumber !== undefined ? update.seatNumber : guest.seatNumber,
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
        g.tableId === tableId ? { ...g, tableId: null, seatNumber: null } : g
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
          return { ...g, tableId: prev.tableId, seatNumber: prev.seatNumber };
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
  unassignGuest: (guestId: string) => Promise<boolean>;
  applyAutoAssignResult: (payload: {
    assignedGuests: Array<{
      id: string;
      tableId?: string | null;
      seatNumber?: number | null;
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

  // Derived synchronous unassigned guests collection
  const unassignedGuests = useMemo(() => {
    return state.guests.filter((g) => !g.tableId);
  }, [state.guests]);

  // Fetch tables and invitation codes
  const fetchData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const [tablesRes, guestsRes] = await Promise.all([
        fetch('/api/admin/seating-tables'),
        fetch('/api/admin/invitation-codes'),
      ]);

      if (!tablesRes.ok || !guestsRes.ok) {
        throw new Error('Failed to load seating chart data.');
      }

      const tablesData = await tablesRes.json();
      const guestsData = await guestsRes.json();

      const rawTables = Array.isArray(tablesData) ? tablesData : (Array.isArray(tablesData?.data) ? tablesData.data : []);
      const rawGuests = Array.isArray(guestsData) ? guestsData : (Array.isArray(guestsData?.data) ? guestsData.data : []);

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

  // Seat assignment with granular rollback on failure
  const assignGuestToTable = useCallback(
    async (
      guestId: string,
      tableId: string | null,
      seatNumber?: number | null
    ): Promise<boolean> => {
      const targetTableId = tableId || null;
      const targetSeatNumber = targetTableId ? (seatNumber ?? null) : null;

      // Table capacity validation prior to optimistic dispatch
      if (targetTableId) {
        const targetTable = state.tables.find((t) => t.id === targetTableId);
        if (targetTable) {
          const existingCount = state.guests.filter(
            (g) => g.tableId === targetTableId && g.id !== guestId
          ).length;
          if (existingCount >= targetTable.capacity) {
            toast?.addToast(
              `Table "${targetTable.name}" has reached its maximum capacity of ${targetTable.capacity}.`,
              'error'
            );
            return false;
          }
        }
      }

      const currentGuest = state.guests.find((g) => g.id === guestId);
      if (!currentGuest) {
        return false;
      }

      // Snapshot granular previous state of affected entities only
      const previousGuestAssignment = {
        guestId: currentGuest.id,
        tableId: currentGuest.tableId,
        seatNumber: currentGuest.seatNumber,
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
          seatNumber: targetSeatNumber,
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

        const returnedGuest: InvitationCodeDTO = await res.json();
        if (returnedGuest && returnedGuest.id) {
          dispatch({
            type: 'CONFIRM_ASSIGN_GUEST',
            payload: returnedGuest,
          });
        }
        return true;
      } catch (err: any) {
        // Granular entity rollback: reverts only the affected guest and displaced seat occupant
        dispatch({
          type: 'REVERT_ASSIGN_GUEST',
          payload: {
            guestId: previousGuestAssignment.guestId,
            tableId: previousGuestAssignment.tableId,
            seatNumber: previousGuestAssignment.seatNumber,
            displacedGuest,
          },
        });
        alert(err.message || 'Error assigning guest seat');
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
          const updatedTable: SeatingTableDTO = await res.json();
          dispatch({
            type: 'UPDATE_TABLE',
            payload: updatedTable,
          });
          return true;
        } else {
          const defaultX = (state.tables.length % 4) * 180 + 40;
          const defaultY = Math.floor(state.tables.length / 4) * 180 + 40;
          const res = await fetch('/api/admin/seating-tables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: defaultX,
              y: defaultY,
              shape: 'round',
              capacity: 8,
              width: 120,
              height: 120,
              rotation: 0,
              ...tableData,
            }),
          });
          if (!res.ok) throw new Error('Failed to create table');
          const createdTable: SeatingTableDTO = await res.json();
          dispatch({
            type: 'CREATE_TABLE',
            payload: createdTable,
          });
          return true;
        }
      } catch (err: any) {
        alert(err.message || 'Error saving table');
        return false;
      }
    },
    [state.tables.length]
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
      } catch (err: any) {
        dispatch({
          type: 'REVERT_DELETE_TABLE',
          payload: {
            table: tableToDelete,
            affectedGuests,
          },
        });
        alert(err.message || 'Error deleting table');
        return false;
      }
    },
    [state.tables, state.guests]
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
      } catch {
        dispatch({
          type: 'REVERT_TABLE_POSITION',
          payload: { tableId, x: prevX, y: prevY },
        });
        return false;
      }
    },
    [state.tables]
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
      } catch {
        dispatch({
          type: 'REVERT_TABLE_ROTATION',
          payload: { tableId, rotation: prevRotation },
        });
        return false;
      }
    },
    [state.tables]
  );

  return {
    tables: state.tables,
    allGuests: state.guests,
    unassignedGuests,
    isLoading: state.isLoading,
    errorMsg: state.error,
    dispatch,
    fetchData,
    assignGuestToTable,
    unassignGuest,
    applyAutoAssignResult,
    saveTable,
    deleteTable,
    updateTablePosition,
    updateTableRotation,
  };
}

export const useSeatingChartState = useSeatingState;
