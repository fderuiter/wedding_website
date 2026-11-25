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

        if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ items: [mockGuest1, mockGuest2, mockGuest3], total: 3, page: 1, limit: 1000, totalPages: 1 }),
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

    it('unwraps withApiMiddleware { success: true, data: { items } } catalog response envelope', async () => {
      fetchMock.mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: [mockTable1, mockTable2] }),
          } as Response);
        }
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  items: [mockGuest1, mockGuest2, mockGuest3],
                  total: 3,
                  page: 1,
                  limit: 1000,
                  totalPages: 1,
                },
              }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

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
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
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
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
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
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
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
        if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
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
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
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
        if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
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

    it('fetches all pages of invitations (>1000 catalog records) and tables (>50 records) without truncation', async () => {
      const all1050Guests: InvitationCodeDTO[] = Array.from({ length: 1050 }, (_, idx) => ({
        id: `g-page-${idx + 1}`,
        code: `CODE-P-${String(idx + 1).padStart(4, '0')}`,
        guestName: `Guest ${idx + 1}`,
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        plusOneAllocations: 0,
        partyTags: [],
        isSample: false,
        used: true,
        extraFields: { attending: true },
      }));

      const all60Tables = Array.from({ length: 60 }, (_, idx) => ({
        id: `tbl-page-${idx + 1}`,
        name: `Table ${idx + 1}`,
        shape: 'round',
        capacity: 8,
        x: 50,
        y: 50,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      })) as SeatingTableDTO[];

      fetchMock.mockImplementation((url: string | URL | Request) => {
        const parsed = new URL(url.toString(), 'http://localhost:3000');

        if (parsed.pathname === '/api/admin/seating-tables') {
          const skip = Number(parsed.searchParams.get('skip') || '0');
          const limit = Number(parsed.searchParams.get('limit') || '50');
          const slice = all60Tables.slice(skip, skip + limit);
          return Promise.resolve({
            ok: true,
            headers: new Headers({
              'X-Total-Count': String(all60Tables.length),
              'X-Has-Next-Page': String(skip + slice.length < all60Tables.length),
            }),
            json: () => Promise.resolve(slice),
          } as Response);
        }

        if (parsed.pathname === '/api/admin/invitation-codes/catalog') {
          const page = Number(parsed.searchParams.get('page') || '1');
          const limit = Number(parsed.searchParams.get('limit') || '1000');
          const skip = (page - 1) * limit;
          const slice = all1050Guests.slice(skip, skip + limit);
          const totalPages = Math.ceil(all1050Guests.length / limit);
          return Promise.resolve({
            ok: true,
            headers: new Headers({
              'X-Total-Count': String(all1050Guests.length),
              'X-Page': String(page),
              'X-Limit': String(limit),
              'X-Total-Pages': String(totalPages),
            }),
            json: () =>
              Promise.resolve({
                items: slice,
                total: all1050Guests.length,
                page,
                limit,
                totalPages,
              }),
          } as Response);
        }

        return Promise.reject(new Error(`Unhandled URL: ${url.toString()}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.tables).toHaveLength(60);
      expect(result.current.allGuests).toHaveLength(1050);
      expect(result.current.unassignedGuests).toHaveLength(1050);
    });

    it('blocks multi-chair plus-one overflow and rejects assigning guests to zero-capacity landmarks', async () => {
      const partyOfThree: InvitationCodeDTO = {
        id: 'g-party-3',
        code: 'PARTY3',
        guestName: 'Primary Host',
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        plusOneAllocations: 2,
        partyTags: [],
        isSample: false,
        used: true,
        extraFields: { attending: true, plusOneNames: ['Plus One A', 'Plus One B'] },
      };

      const landmarkDanceFloor: SeatingTableDTO = {
        id: 'tbl-dance',
        name: 'Main Dance Floor',
        shape: 'dance-floor',
        capacity: 0,
        x: 300,
        y: 300,
        width: 220,
        height: 180,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      };

      fetchMock.mockImplementation((url: string | URL | Request) => {
        const parsed = new URL(url.toString(), 'http://localhost:3000');
        if (parsed.pathname === '/api/admin/seating-tables') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockTable1, landmarkDanceFloor]),
          } as Response);
        }
        if (parsed.pathname === '/api/admin/invitation-codes/catalog') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                items: [partyOfThree],
                total: 1,
                page: 1,
                limit: 1000,
                totalPages: 1,
              }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled URL: ${url.toString()}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      fetchMock.mockClear();

      // 1. Party of 3 cannot fit onto Table 1 (capacity 2)
      let overflowOk = true;
      await act(async () => {
        overflowOk = await result.current.assignGuestToTable('g-party-3', 'table-1');
      });
      expect(overflowOk).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith(
        'Table "Table 1" has reached its maximum capacity of 2.',
        'error'
      );
      expect(fetchMock).not.toHaveBeenCalled();

      mockAddToast.mockClear();

      // 2. Zero-capacity landmark rejects guest drop
      let landmarkOk = true;
      await act(async () => {
        landmarkOk = await result.current.assignGuestToTable('g-party-3', 'tbl-dance');
      });
      expect(landmarkOk).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith(
        'Cannot assign guests to landmark "Main Dance Floor".',
        'error'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches all catalog pages beyond 50 invitations and merges seated table occupants into state', async () => {
      const page1Guests = Array.from({ length: 50 }, (_, idx) => ({
        id: `inv-${idx + 1}`,
        code: `CODE-${idx + 1}`,
        guestName: `Guest ${idx + 1}`,
        tableId: idx === 0 ? 'table-1' : null,
        seatNumber: idx === 0 ? 1 : null,
        used: true,
        extraFields: { attending: true },
        partyTags: [],
      })) as unknown as InvitationCodeDTO[];

      const page2Guests = Array.from({ length: 15 }, (_, idx) => ({
        id: `inv-${51 + idx}`,
        code: `CODE-${51 + idx}`,
        guestName: `Guest ${51 + idx}`,
        tableId: idx === 0 ? 'table-2' : null,
        seatNumber: idx === 0 ? 1 : null,
        used: false,
        partyTags: [],
      })) as unknown as InvitationCodeDTO[];

      const tableOnlyGuest = {
        id: 'inv-table-only',
        code: 'CODE-TBL',
        guestName: 'Table Embedded Guest',
        tableId: 'table-1',
        seatNumber: 2,
        used: true,
        extraFields: { attending: true },
        partyTags: [],
      } as unknown as InvitationCodeDTO;

      fetchMock.mockImplementation((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'X-Total-Pages': '1' }),
            json: () =>
              Promise.resolve([
                { ...mockTable1, capacity: 4, invitationCodes: [page1Guests[0], tableOnlyGuest] },
                { ...mockTable2, capacity: 4, invitationCodes: [page2Guests[0]] },
              ]),
          } as Response);
        }
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
          if (urlStr.includes('page=2')) {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'X-Total-Pages': '2' }),
              json: () =>
                Promise.resolve({
                  data: page2Guests,
                  meta: { page: 2, limit: 50, total: 65, totalPages: 2 },
                }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'X-Total-Pages': '2' }),
            json: () =>
              Promise.resolve({
                data: page1Guests,
                meta: { page: 1, limit: 50, total: 65, totalPages: 2 },
              }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // 50 (page 1) + 15 (page 2) + 1 (embedded on table-1) = 66 total guests
      expect(result.current.allGuests).toHaveLength(66);
      // 3 guests seated (inv-1, inv-table-only, inv-51), 63 unassigned
      expect(result.current.unassignedGuests).toHaveLength(63);
      expect(result.current.tables.find((t) => t.id === 'table-1')?.invitationCodes).toHaveLength(2);
      expect(result.current.tables.find((t) => t.id === 'table-2')?.invitationCodes).toHaveLength(1);
    });

    it('pushes undo snapshot on single-guest unassign, prunes deleted tableId from undoStack, and repacks seats on UPDATE_TABLE', async () => {
      const table8: SeatingTableDTO = {
        ...mockTable1,
        id: 'table-8',
        name: 'Table Eight',
        capacity: 8,
      };
      const seatedHighGuest: InvitationCodeDTO = {
        ...mockGuest1,
        id: 'g-high',
        guestName: 'High Seat Guest',
        tableId: 'table-8',
        seatNumber: 8,
      };
      const seatedTable2Guest: InvitationCodeDTO = {
        ...mockGuest2,
        id: 'g-t2',
        guestName: 'Table Two Guest',
        tableId: 'table-2',
        seatNumber: 1,
      };

      fetchMock.mockImplementation((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([table8, mockTable2]),
          } as Response);
        }
        if (urlStr.includes('/api/admin/invitation-codes/catalog') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([seatedHighGuest, seatedTable2Guest]),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating/assign') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          if (body.assignments) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  success: true,
                  data: {
                    updatedGuests: body.assignments.map((a: any) => ({
                      id: a.invitationCodeId,
                      tableId: a.tableId,
                      seatNumber: a.seatNumber,
                    })),
                  },
                }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: body.invitationCodeId,
                tableId: body.tableId,
                seatNumber: body.seatNumber ?? null,
              }),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating-tables/table-8') && init?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...table8, capacity: 6 }),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating-tables/table-2') && init?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      // 1. Shrink table-8 capacity from 8 to 6 -> g-high seatNumber 8 repacks into 1..6
      await act(async () => {
        await result.current.saveTable({ id: 'table-8', capacity: 6 });
      });
      const repackedGuest = result.current.allGuests.find((g) => g.id === 'g-high');
      expect(repackedGuest?.seatNumber).toBe(1);

      // 2. Single-guest unassign of g-t2 pushes onto undoStack so Undo is enabled
      expect(result.current.canUndo).toBe(false);
      await act(async () => {
        await result.current.unassignGuest('g-t2');
      });
      expect(result.current.canUndo).toBe(true);
      expect(result.current.undoLabel).toContain('Unassign Table Two Guest');

      // 3. Deleting table-2 prunes table-2 snapshots from undoStack so Undo cannot reference deleted tableId
      await act(async () => {
        await result.current.deleteTable('table-2');
      });
      expect(result.current.canUndo).toBe(false);
      expect(result.current.undoLabel).toBeNull();
    });

    it('excludes isSample: true tables and guests while tracking hiddenSampleTableCount/hiddenSampleGuestCount and records undo snapshots on direct seat moves', async () => {
      const sampleTable: SeatingTableDTO = {
        ...mockTable1,
        id: 'sample-table',
        name: 'Sample Table',
        isSample: true,
      };
      const realTableA: SeatingTableDTO = {
        ...mockTable1,
        id: 'real-table-a',
        name: 'Real Table A',
        capacity: 4,
        isSample: false,
      };
      const realTableB: SeatingTableDTO = {
        ...mockTable2,
        id: 'real-table-b',
        name: 'Real Table B',
        capacity: 4,
        isSample: false,
      };

      const realSeatedGuest: InvitationCodeDTO = {
        ...mockGuest1,
        id: 'real-g-1',
        guestName: 'Seated Mover',
        tableId: 'real-table-a',
        seatNumber: 1,
        isSample: false,
      };
      const sampleGuest: InvitationCodeDTO = {
        ...mockGuest2,
        id: 'sample-g-1',
        guestName: 'Hidden Sample Guest',
        tableId: null,
        seatNumber: null,
        isSample: true,
      };

      global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables') && (!init || !init.method || init.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([sampleTable, realTableA, realTableB]),
          } as Response);
        }
        if (urlStr.includes('/api/admin/invitation-codes/catalog')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ items: [realSeatedGuest, sampleGuest] }),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating/assign') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                ...realSeatedGuest,
                tableId: body.tableId,
                seatNumber: body.seatNumber ?? null,
              }),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/seating/assign-batch') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                updatedGuests: (body.assignments || []).map((a: any) => ({
                  id: a.invitationCodeId,
                  tableId: a.tableId,
                  seatNumber: a.seatNumber,
                })),
              }),
          } as Response);
        }
        return Promise.reject(new Error(`Unhandled mock: ${urlStr}`));
      });

      const { result } = renderHook(() => useSeatingState());

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.tables.map((t) => t.id)).toEqual(['real-table-a', 'real-table-b']);
      expect(result.current.allGuests.map((g) => g.id)).toEqual(['real-g-1']);
      expect(result.current.hiddenSampleTableCount).toBe(1);
      expect(result.current.hiddenSampleGuestCount).toBe(1);
      expect(result.current.canUndo).toBe(false);

      // Direct move of already-seated guest to Real Table B Seat 2 records Move undo snapshot
      await act(async () => {
        await result.current.assignGuestToTable('real-g-1', 'real-table-b', 2);
      });

      expect(result.current.allGuests[0].tableId).toBe('real-table-b');
      expect(result.current.allGuests[0].seatNumber).toBe(2);
      expect(result.current.canUndo).toBe(true);
      expect(result.current.undoLabel).toBe('Move Seated Mover');

      // Undoing restores guest back to Real Table A Seat 1
      await act(async () => {
        await result.current.undoLastBatchAction();
      });
      expect(result.current.allGuests[0].tableId).toBe('real-table-a');
      expect(result.current.allGuests[0].seatNumber).toBe(1);
    });
  });
});
