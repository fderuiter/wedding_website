import { renderHook, act } from '@testing-library/react';
import {
  seatingReducer,
  useSeatingState,
  initialSeatingState,
  SeatingState,
} from '../useSeatingState';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

const mockAddToast = jest.fn();
let mockUseToastError: Error | null = null;

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => {
    if (mockUseToastError) {
      throw mockUseToastError;
    }
    return {
      addToast: mockAddToast,
      confirm: jest.fn(),
      removeToast: jest.fn(),
      toasts: [],
    };
  },
}));

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
    isSample: false,
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
    isSample: false,
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
      mockAddToast.mockClear();
      mockUseToastError = null;
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
      expect(mockAddToast).toHaveBeenCalledWith(
        'Table "Table 1" has reached its maximum capacity of 2.',
        'error'
      );
      expect(window.alert).not.toHaveBeenCalled();
      // No POST request made
      expect(fetchMock).not.toHaveBeenCalled();
      // Guest 3 remains unassigned
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-3');
    });

    it('falls back cleanly without throwing when running hook outside ToastProvider', async () => {
      mockUseToastError = new Error('useToast must be used within a ToastProvider');

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

      let assignResult = true;
      await act(async () => {
        assignResult = await result.current.assignGuestToTable('g-3', 'table-1');
      });

      expect(assignResult).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.unassignedGuests).toHaveLength(1);
    });

    it('allows moving guests between seats at the same full table', async () => {
      fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
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
              ]),
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
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      fetchMock.mockClear();

      let assignResult = false;
      await act(async () => {
        assignResult = await result.current.assignGuestToTable('g-1', 'table-1', 2);
      });

      expect(assignResult).toBe(true);
      expect(mockAddToast).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
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

      expect(mockAddToast).toHaveBeenCalledWith('Failed to assign guest seat', 'error');
      expect(window.alert).not.toHaveBeenCalled();

      // Guest 3 must be reverted to unassigned
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-3');

      // Crucial: Guest 1 and Guest 2 on Table 1 must be COMPLETELY UNTOUCHED!
      expect(result.current.tables[0].invitationCodes).toHaveLength(2);
      expect(result.current.tables[0].invitationCodes![0].id).toBe('g-1');
      expect(result.current.tables[0].invitationCodes![1].id).toBe('g-2');
    });

    it('dispatches error toast instead of window.alert when saveTable fails on create and update', async () => {
      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // 1. Fail table creation (POST /api/admin/seating-tables)
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      let createResult = true;
      await act(async () => {
        createResult = await result.current.saveTable({ name: 'New Table', capacity: 8 });
      });

      expect(createResult).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith('Failed to create table', 'error');
      expect(window.alert).not.toHaveBeenCalled();
      expect(result.current.tables).toHaveLength(2);

      mockAddToast.mockClear();

      // 2. Fail table update (PUT /api/admin/seating-tables/table-1)
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      let updateResult = true;
      await act(async () => {
        updateResult = await result.current.saveTable({ id: 'table-1', name: 'Renamed Table 1' });
      });

      expect(updateResult).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith('Failed to update table', 'error');
      expect(window.alert).not.toHaveBeenCalled();
      expect(result.current.tables.find((t) => t.id === 'table-1')?.name).toBe('Table 1');
    });

    it('reverts optimistic table deletion and dispatches error toast instead of window.alert when deleteTable fails', async () => {
      fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
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
            json: () =>
              Promise.resolve([
                { ...mockGuest1, tableId: 'table-1', seatNumber: 1 },
                mockGuest2,
              ]),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating-tables/table-1') && init?.method === 'DELETE') {
          return Promise.resolve({
            ok: false,
            status: 500,
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.tables).toHaveLength(2);
      expect(result.current.tables.find((t) => t.id === 'table-1')?.invitationCodes).toHaveLength(1);

      let deleteResult = true;
      await act(async () => {
        deleteResult = await result.current.deleteTable('table-1');
      });

      expect(deleteResult).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith('Failed to delete table', 'error');
      expect(window.alert).not.toHaveBeenCalled();

      // Table 1 and its seated guest must be restored after failure
      const restoredTable1 = result.current.tables.find((t) => t.id === 'table-1');
      expect(restoredTable1).toBeDefined();
      expect(restoredTable1?.invitationCodes).toHaveLength(1);
      expect(restoredTable1?.invitationCodes![0].id).toBe('g-1');
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-2');
    });

    it('handles mutation rejections cleanly without throwing when rendered outside ToastProvider', async () => {
      mockUseToastError = new Error('useToast must be used within a ToastProvider');

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // Fail assignGuestToTable, saveTable, and deleteTable outside ToastProvider
      fetchMock
        .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response))
        .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 } as Response))
        .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 } as Response));

      let assignOk = true;
      let saveOk = true;
      let deleteOk = true;

      await act(async () => {
        assignOk = await result.current.assignGuestToTable('g-1', 'table-1', 1);
        saveOk = await result.current.saveTable({ name: 'Table 3' });
        deleteOk = await result.current.deleteTable('table-1');
      });

      expect(assignOk).toBe(false);
      expect(saveOk).toBe(false);
      expect(deleteOk).toBe(false);
      expect(mockAddToast).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
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

    it('shows error toasts via useOptionalToast and reverts position and rotation on PUT failure', async () => {
      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      mockAddToast.mockClear();

      // 1. Position PUT failure shows error toast and reverts coordinates
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      let posOk = true;
      await act(async () => {
        posOk = await result.current.updateTablePosition('table-1', 320, 240);
      });

      expect(posOk).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith('Failed to update table position', 'error');
      expect(result.current.tables.find((t) => t.id === 'table-1')?.x).toBe(50);
      expect(result.current.tables.find((t) => t.id === 'table-1')?.y).toBe(50);

      mockAddToast.mockClear();

      // 2. Rotation PUT failure shows error toast and reverts angle
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      let rotOk = true;
      await act(async () => {
        rotOk = await result.current.updateTableRotation('table-1', 135);
      });

      expect(rotOk).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith('Failed to update table rotation', 'error');
      expect(result.current.tables.find((t) => t.id === 'table-1')?.rotation).toBe(0);

      // 3. Outside ToastProvider, failures revert cleanly without throwing
      mockUseToastError = new Error('useToast must be used within a ToastProvider');
      mockAddToast.mockClear();

      const { result: standaloneResult } = renderHook(() => useSeatingState());
      await act(async () => {
        await Promise.resolve();
      });

      fetchMock
        .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 } as Response))
        .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 } as Response));

      await act(async () => {
        expect(await standaloneResult.current.updateTablePosition('table-1', 200, 200)).toBe(false);
        expect(await standaloneResult.current.updateTableRotation('table-1', 90)).toBe(false);
      });
      expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('excludes declined RSVPs and address-collection records from unassignedGuests', async () => {
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
                { ...mockGuest1, used: true, extraFields: { attending: true } },
                { ...mockGuest2, used: true, extraFields: { attending: false } },
                { ...mockGuest3, used: false, partyTags: ['address-collection'] },
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.allGuests).toHaveLength(3);
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.unassignedGuests[0].id).toBe('g-1');
    });

    it('supports assignGuestsToTable, clearTableSeats, and undoLastBatchAction snapshots', async () => {
      fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
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
          if (body.invitationCodeIds) {
            const updatedGuests = body.invitationCodeIds.map((id: string, idx: number) => ({
              id,
              tableId: body.tableId,
              seatNumber: body.tableId ? idx + 1 : null,
            }));
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, data: { updatedGuests } }),
            } as Response);
          }
          if (body.assignments) {
            const updatedGuests = body.assignments.map((a: any) => ({
              id: a.invitationCodeId,
              tableId: a.tableId,
              seatNumber: a.seatNumber,
            }));
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ success: true, data: { updatedGuests } }),
            } as Response);
          }
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.canUndo).toBe(false);

      // 1. Batch-assign household [g-1, g-2] to Table 2
      let batchOk = false;
      await act(async () => {
        batchOk = await result.current.assignGuestsToTable(['g-1', 'g-2'], 'table-2');
      });

      expect(batchOk).toBe(true);
      expect(result.current.tables.find((t) => t.id === 'table-2')?.invitationCodes).toHaveLength(2);
      expect(result.current.unassignedGuests).toHaveLength(1);
      expect(result.current.canUndo).toBe(true);

      // 2. Clear Seats on Table 2 (table remains, guests become unassigned)
      let clearOk = false;
      await act(async () => {
        clearOk = await result.current.clearTableSeats('table-2');
      });

      expect(clearOk).toBe(true);
      expect(result.current.tables.find((t) => t.id === 'table-2')).toBeDefined();
      expect(result.current.tables.find((t) => t.id === 'table-2')?.invitationCodes).toHaveLength(0);
      expect(result.current.unassignedGuests).toHaveLength(3);
      expect(result.current.canUndo).toBe(true);

      // 3. Undo Clear Seats -> [g-1, g-2] return to Table 2
      let undoClearOk = false;
      await act(async () => {
        undoClearOk = await result.current.undoLastBatchAction();
      });

      expect(undoClearOk).toBe(true);
      expect(result.current.tables.find((t) => t.id === 'table-2')?.invitationCodes).toHaveLength(2);
      expect(result.current.unassignedGuests).toHaveLength(1);

      // 4. Undo household batch assignment -> all 3 return to unassigned
      let undoHouseholdOk = false;
      await act(async () => {
        undoHouseholdOk = await result.current.undoLastBatchAction();
      });

      expect(undoHouseholdOk).toBe(true);
      expect(result.current.unassignedGuests).toHaveLength(3);
      expect(result.current.canUndo).toBe(false);
    });
  });
});
