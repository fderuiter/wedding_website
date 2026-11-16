import { renderHook, act } from '@testing-library/react';
import {
  seatingReducer,
  useSeatingState,
  initialSeatingState,
  SeatingState,
} from '../useSeatingState';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

describe('useSeatingState & seatingReducer', () => {
  const mockTable1: SeatingTableDTO = {
    id: 'table-1',
    name: 'Table 1',
    shape: 'round',
    capacity: 2,
    x: 50,
    y: 50,
    width: 120,
    height: 120,
    rotation: 0,
    invitationCodes: [],
  };

  const mockTable2: SeatingTableDTO = {
    id: 'table-2',
    name: 'Table 2',
    shape: 'round',
    capacity: 4,
    x: 200,
    y: 50,
    width: 120,
    height: 120,
    rotation: 0,
    invitationCodes: [],
  };

  const mockGuest1: InvitationCodeDTO = {
    id: 'g-1',
    code: 'CODE-1',
    guestName: 'Guest 1',
    tableId: null,
    seatNumber: null,
  } as InvitationCodeDTO;

  const mockGuest2: InvitationCodeDTO = {
    id: 'g-2',
    code: 'CODE-2',
    guestName: 'Guest 2',
    tableId: null,
    seatNumber: null,
  } as InvitationCodeDTO;

  const mockGuest3: InvitationCodeDTO = {
    id: 'g-3',
    code: 'CODE-3',
    guestName: 'Guest 3',
    tableId: null,
    seatNumber: null,
  } as InvitationCodeDTO;

  describe('seatingReducer pure state transitions', () => {
    it('handles INIT_DATA and computes synchronized table occupants', () => {
      const seatedGuest: InvitationCodeDTO = {
        ...mockGuest1,
        tableId: 'table-1',
        seatNumber: 1,
      };

      const nextState = seatingReducer(initialSeatingState, {
        type: 'INIT_DATA',
        payload: {
          tables: [mockTable1, mockTable2],
          guests: [seatedGuest, mockGuest2],
        },
      });

      expect(nextState.isLoading).toBe(false);
      expect(nextState.error).toBeNull();
      expect(nextState.guests).toHaveLength(2);
      expect(nextState.tables[0].invitationCodes).toHaveLength(1);
      expect(nextState.tables[0].invitationCodes![0].id).toBe('g-1');
      expect(nextState.tables[1].invitationCodes).toHaveLength(0);
    });

    it('handles ASSIGN_GUEST_OPTIMISTIC and handles seat swap side effects', () => {
      const stateWithGuest1: SeatingState = {
        ...initialSeatingState,
        tables: [mockTable1],
        guests: [{ ...mockGuest1, tableId: 'table-1', seatNumber: 1 }, mockGuest2],
      };

      // Assign Guest 2 to seat 1 on Table 1 (occupied by Guest 1)
      const nextState = seatingReducer(stateWithGuest1, {
        type: 'ASSIGN_GUEST_OPTIMISTIC',
        payload: {
          guestId: 'g-2',
          tableId: 'table-1',
          seatNumber: 1,
        },
      });

      const g1 = nextState.guests.find((g) => g.id === 'g-1')!;
      const g2 = nextState.guests.find((g) => g.id === 'g-2')!;

      expect(g2.tableId).toBe('table-1');
      expect(g2.seatNumber).toBe(1);
      // Displaced guest has seatNumber set to null
      expect(g1.tableId).toBe('table-1');
      expect(g1.seatNumber).toBeNull();
    });

    it('handles REVERT_ASSIGN_GUEST with granular entity-level rollback', () => {
      // Suppose Guest 1 and Guest 2 were auto-assigned to Table 1
      // Guest 3 attempted assignment to Table 2 optimistically
      const stateWithOptimisticGuest3: SeatingState = {
        ...initialSeatingState,
        tables: [{ ...mockTable1 }, { ...mockTable2 }],
        guests: [
          { ...mockGuest1, tableId: 'table-1', seatNumber: 1 },
          { ...mockGuest2, tableId: 'table-1', seatNumber: 2 },
          { ...mockGuest3, tableId: 'table-2', seatNumber: 1 },
        ],
      };

      // Network failed for Guest 3; granular rollback of Guest 3 ONLY
      const revertedState = seatingReducer(stateWithOptimisticGuest3, {
        type: 'REVERT_ASSIGN_GUEST',
        payload: {
          guestId: 'g-3',
          tableId: null,
          seatNumber: null,
        },
      });

      // Guest 3 is unassigned
      const g3 = revertedState.guests.find((g) => g.id === 'g-3')!;
      expect(g3.tableId).toBeNull();
      expect(g3.seatNumber).toBeNull();

      // Guest 1 and Guest 2 are untouched!
      const g1 = revertedState.guests.find((g) => g.id === 'g-1')!;
      const g2 = revertedState.guests.find((g) => g.id === 'g-2')!;
      expect(g1.tableId).toBe('table-1');
      expect(g1.seatNumber).toBe(1);
      expect(g2.tableId).toBe('table-1');
      expect(g2.seatNumber).toBe(2);

      // Table 1 still has both guests seated
      const t1 = revertedState.tables.find((t) => t.id === 'table-1')!;
      expect(t1.invitationCodes).toHaveLength(2);
    });

    it('handles APPLY_AUTO_ASSIGN synchronously into both table and guest collections', () => {
      const stateWithUnassigned: SeatingState = {
        ...initialSeatingState,
        tables: [{ ...mockTable1, invitationCodes: [] }],
        guests: [mockGuest1, mockGuest2],
      };

      const autoAssignPayload = {
        assignedGuests: [
          { id: 'g-1', tableId: 'table-1', seatNumber: 1 },
          { id: 'g-2', tableId: 'table-1', seatNumber: 2 },
        ],
      };

      const nextState = seatingReducer(stateWithUnassigned, {
        type: 'APPLY_AUTO_ASSIGN',
        payload: autoAssignPayload,
      });

      // Both guests updated
      expect(nextState.guests[0].tableId).toBe('table-1');
      expect(nextState.guests[0].seatNumber).toBe(1);
      expect(nextState.guests[1].tableId).toBe('table-1');
      expect(nextState.guests[1].seatNumber).toBe(2);

      // Table 1 synchronously updated with occupants
      expect(nextState.tables[0].invitationCodes).toHaveLength(2);
      expect(nextState.tables[0].invitationCodes![0].id).toBe('g-1');
      expect(nextState.tables[0].invitationCodes![1].id).toBe('g-2');
    });

    it('handles DELETE_TABLE and unseats affected guests', () => {
      const stateWithSeatedGuests: SeatingState = {
        ...initialSeatingState,
        tables: [{ ...mockTable1 }, { ...mockTable2 }],
        guests: [
          { ...mockGuest1, tableId: 'table-1', seatNumber: 1 },
          { ...mockGuest2, tableId: 'table-2', seatNumber: 1 },
        ],
      };

      const nextState = seatingReducer(stateWithSeatedGuests, {
        type: 'DELETE_TABLE',
        payload: { tableId: 'table-1' },
      });

      expect(nextState.tables).toHaveLength(1);
      expect(nextState.tables[0].id).toBe('table-2');

      const g1 = nextState.guests.find((g) => g.id === 'g-1')!;
      const g2 = nextState.guests.find((g) => g.id === 'g-2')!;
      expect(g1.tableId).toBeNull();
      expect(g1.seatNumber).toBeNull();
      expect(g2.tableId).toBe('table-2');
    });
  });

  describe('useSeatingState hook', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      jest.clearAllMocks();
      window.alert = jest.fn();

      fetchMock = jest.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();

        if (urlStr.endsWith('/api/admin/seating-tables') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockTable1, mockTable2]),
          } as Response);
        }

        if (urlStr.endsWith('/api/admin/invitation-codes') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockGuest1, mockGuest2, mockGuest3]),
          } as Response);
        }

        if (urlStr.endsWith('/api/admin/seating/assign') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: body.invitationCodeId,
                tableId: body.tableId,
                seatNumber: body.seatNumber,
              }),
          } as Response);
        }

        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      }) as jest.Mock;

      global.fetch = fetchMock;
    });

    it('loads data on mount and computes unassignedGuests derived state', async () => {
      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.tables).toHaveLength(2);
      expect(result.current.allGuests).toHaveLength(3);
      expect(result.current.unassignedGuests).toHaveLength(3);
    });

    it('enforces table capacity validations prior to optimistic assignment dispatch', async () => {
      // Table 1 has capacity 2. Let's seat mockGuest1 and mockGuest2 first.
      fetchMock.mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockTable1]),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/invitation-codes')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { ...mockGuest1, tableId: 'table-1', seatNumber: 1 },
                { ...mockGuest2, tableId: 'table-1', seatNumber: 2 },
                mockGuest3,
              ]),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      fetchMock.mockClear();

      // Attempt to assign Guest 3 to Table 1 (which is at max capacity 2)
      let assignResult = false;
      await act(async () => {
        assignResult = await result.current.assignGuestToTable('g-3', 'table-1');
      });

      expect(assignResult).toBe(false);
      expect(window.alert).toHaveBeenCalledWith(
        'Table "Table 1" has reached its maximum capacity of 2.'
      );
      // No POST request made
      expect(fetchMock).not.toHaveBeenCalled();
      // Guest 3 remains unassigned
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-3');
    });

    it('granularly reverts only failed guest assignment on network error without corrupting other guests', async () => {
      // Start with all 3 unassigned
      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // Synchronously auto-assign Guest 1 and Guest 2 to Table 1
      act(() => {
        result.current.applyAutoAssignResult({
          assignedCount: 2,
          unassignedCount: 1,
          assignedGuests: [
            { id: 'g-1', tableId: 'table-1', seatNumber: 1 },
            { id: 'g-2', tableId: 'table-1', seatNumber: 2 },
          ],
        });
      });

      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-3');
      expect(result.current.tables[0].invitationCodes).toHaveLength(2);

      // Now attempt manual assignment of Guest 3 to Table 2, but simulate server error 500
      fetchMock.mockImplementationOnce((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating/assign')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: 'Server unavailable' }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      await act(async () => {
        await result.current.assignGuestToTable('g-3', 'table-2', 1);
      });

      expect(window.alert).toHaveBeenCalledWith('Failed to assign guest seat');

      // Guest 3 must be reverted to unassigned
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-3');

      // Crucial: Guest 1 and Guest 2 on Table 1 must be COMPLETELY UNTOUCHED!
      expect(result.current.tables[0].invitationCodes).toHaveLength(2);
      expect(result.current.tables[0].invitationCodes![0].id).toBe('g-1');
      expect(result.current.tables[0].invitationCodes![1].id).toBe('g-2');
    });

    it('updates position and rotation optimistically and reverts on network failure', async () => {
      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // Update position failure
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      await act(async () => {
        await result.current.updateTablePosition('table-1', 999, 888);
      });

      // Reverted back to initial position (50, 50)
      const table1 = result.current.tables.find((t) => t.id === 'table-1')!;
      expect(table1.x).toBe(50);
      expect(table1.y).toBe(50);
    });
  });
});
