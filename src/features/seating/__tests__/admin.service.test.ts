/** @jest-environment node */

import { SeatingTableAdminService } from '../admin.service';
import { createAuditSnapshot } from '@/lib/audit';

const mockTxSeatingTableCreate = jest.fn();
const mockTxSeatingTableUpdate = jest.fn();
const mockTxSeatingTableDelete = jest.fn();
const mockTxSeatingTableFindUnique = jest.fn();
const mockTxSeatingTableFindMany = jest.fn();
const mockTxInvitationCodeUpdate = jest.fn();
const mockTxInvitationCodeUpdateMany = jest.fn();
const mockTxInvitationCodeFindFirst = jest.fn();
const mockTxInvitationCodeFindMany = jest.fn();

jest.mock('@/lib/prisma', () => {
  const mockTx = {
    seatingTable: {
      create: (...args: any[]) => mockTxSeatingTableCreate(...args),
      update: (...args: any[]) => mockTxSeatingTableUpdate(...args),
      delete: (...args: any[]) => mockTxSeatingTableDelete(...args),
      findUnique: (...args: any[]) => mockTxSeatingTableFindUnique(...args),
      findMany: (...args: any[]) => mockTxSeatingTableFindMany(...args),
    },
    invitationCode: {
      update: (...args: any[]) => mockTxInvitationCodeUpdate(...args),
      updateMany: (...args: any[]) => mockTxInvitationCodeUpdateMany(...args),
      findFirst: (...args: any[]) => mockTxInvitationCodeFindFirst(...args),
      findMany: (...args: any[]) => mockTxInvitationCodeFindMany(...args),
    },
    snapshotVersion: {
      create: jest.fn(),
    },
  };

  return {
    prisma: {
      seatingTable: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      invitationCode: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockTx)),
    },
  };
});

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
}));

describe('SeatingTableAdminService', () => {
  let service: SeatingTableAdminService;

  beforeEach(() => {
    service = new SeatingTableAdminService();
    jest.clearAllMocks();
  });

  it('should validate table fields on creation', async () => {
    await expect(service.create({ name: '', capacity: 8 }, 'Admin')).rejects.toThrow(
      'Validation Error: Table name is required.'
    );

    await expect(service.create({ name: 'Table 1', capacity: 0 }, 'Admin')).rejects.toThrow(
      'Validation Error: Capacity must be at least 1.'
    );

    await expect(
      service.create({ name: 'Table 1', capacity: 8, shape: 'triangle' as any }, 'Admin')
    ).rejects.toThrow('Validation Error: Shape must be round, rectangular, or square.');
  });

  it('should create a seating table and create an audit snapshot', async () => {
    const input = {
      name: 'Table 1',
      shape: 'round',
      capacity: 8,
      x: 100,
      y: 150,
      width: 120,
      height: 120,
      rotation: 0,
    };

    mockTxSeatingTableCreate.mockResolvedValue({
      id: 'table-123',
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create(input, 'Coordinator');

    expect(result.id).toBe('table-123');
    expect(mockTxSeatingTableCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Table 1',
        shape: 'round',
        capacity: 8,
        x: 100,
        y: 150,
      }),
    });
    expect(createAuditSnapshot).toHaveBeenCalledWith(
      'SeatingTable',
      'table-123',
      expect.any(Object),
      'Coordinator',
      expect.any(Object)
    );
  });

  it('should clear associated invitation codes when deleting a table', async () => {
    mockTxInvitationCodeUpdateMany.mockResolvedValue({ count: 2 });
    mockTxSeatingTableDelete.mockResolvedValue({
      id: 'table-123',
      name: 'Table 1',
    });

    const result = await service.delete('table-123', 'Admin');

    expect(result.id).toBe('table-123');
    expect(mockTxInvitationCodeUpdateMany).toHaveBeenCalledWith({
      where: { tableId: 'table-123' },
      data: { tableId: null, seatNumber: null },
    });
    expect(mockTxSeatingTableDelete).toHaveBeenCalledWith({
      where: { id: 'table-123' },
    });
  });

  it('should assign a guest to a table and seat number', async () => {
    mockTxSeatingTableFindUnique.mockResolvedValue({
      id: 'table-100',
      capacity: 8,
      invitationCodes: [],
    });

    mockTxInvitationCodeFindFirst.mockResolvedValue(null);

    mockTxInvitationCodeUpdate.mockResolvedValue({
      id: 'guest-1',
      guestName: 'John Doe',
      tableId: 'table-100',
      seatNumber: 1,
    });

    const result = await service.assignSeat('guest-1', 'table-100', 1, 'Coordinator');

    expect(result.tableId).toBe('table-100');
    expect(result.seatNumber).toBe(1);
    expect(mockTxInvitationCodeUpdate).toHaveBeenCalledWith({
      where: { id: 'guest-1' },
      data: {
        tableId: 'table-100',
        seatNumber: 1,
      },
    });
    expect(createAuditSnapshot).toHaveBeenCalledWith(
      'InvitationCode',
      'guest-1',
      expect.objectContaining({ tableId: 'table-100', seatNumber: 1 }),
      'Coordinator',
      expect.any(Object)
    );
  });

  it('should throw a validation error when assigning a guest to a full table', async () => {
    mockTxSeatingTableFindUnique.mockResolvedValue({
      id: 'table-100',
      name: 'Table 1',
      capacity: 2,
      invitationCodes: [
        { id: 'guest-1', guestName: 'Alice' },
        { id: 'guest-2', guestName: 'Bob' },
      ],
    });

    await expect(service.assignSeat('guest-3', 'table-100', 3, 'Coordinator')).rejects.toThrow(
      'Validation Error: Table "Table 1" has reached its maximum capacity of 2.'
    );
  });

  it('should allow seat re-assignment within the same table even if table is at capacity', async () => {
    mockTxSeatingTableFindUnique.mockResolvedValue({
      id: 'table-100',
      name: 'Table 1',
      capacity: 2,
      invitationCodes: [
        { id: 'guest-1', guestName: 'Alice', seatNumber: 1 },
        { id: 'guest-2', guestName: 'Bob', seatNumber: 2 },
      ],
    });

    mockTxInvitationCodeFindFirst.mockResolvedValue({
      id: 'guest-2',
      seatNumber: 2,
    });

    mockTxInvitationCodeUpdate
      .mockResolvedValueOnce({ id: 'guest-2', seatNumber: null })
      .mockResolvedValueOnce({ id: 'guest-1', tableId: 'table-100', seatNumber: 2 });

    const result = await service.assignSeat('guest-1', 'table-100', 2, 'Coordinator');

    expect(result.tableId).toBe('table-100');
    expect(result.seatNumber).toBe(2);
  });

  it('should unassign a guest when tableId is set to null', async () => {
    mockTxInvitationCodeUpdate.mockResolvedValue({
      id: 'guest-1',
      guestName: 'John Doe',
      tableId: null,
      seatNumber: null,
    });

    const result = await service.assignSeat('guest-1', null, null, 'Coordinator');

    expect(result.tableId).toBeNull();
    expect(result.seatNumber).toBeNull();
    expect(mockTxInvitationCodeUpdate).toHaveBeenCalledWith({
      where: { id: 'guest-1' },
      data: {
        tableId: null,
        seatNumber: null,
      },
    });
  });

  describe('autoAssignSeats', () => {
    it('should preserve household grouping and seat intact households together when capacity permits', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 4, invitationCodes: [] },
        { id: 'table-2', name: 'Table 2', capacity: 6, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Alice Smith', householdName: 'Smith', tableId: null },
        { id: 'g2', guestName: 'Bob Smith', householdName: 'Smith', tableId: null },
        { id: 'g3', guestName: 'Charlie Smith', householdName: 'Smith', tableId: null },
        { id: 'g4', guestName: 'David Johnson', householdName: 'Johnson', tableId: null },
        { id: 'g5', guestName: 'Emma Johnson', householdName: 'Johnson', tableId: null },
        { id: 'g6', guestName: 'Frank Johnson', householdName: 'Johnson', tableId: null },
        { id: 'g7', guestName: 'Grace Johnson', householdName: 'Johnson', tableId: null },
      ]);

      mockTxInvitationCodeUpdate.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(7);
      expect(result.unassignedCount).toBe(0);

      // Johnson group (size 4) best fits Table 1 (capacity 4, leftover 0)
      const johnsonGuests = result.assignedGuests.filter((g) => ['g4', 'g5', 'g6', 'g7'].includes(g.id));
      expect(johnsonGuests).toHaveLength(4);
      expect(johnsonGuests.every((g) => g.tableId === 'table-1')).toBe(true);
      expect(johnsonGuests.map((g) => g.seatNumber).sort()).toEqual([1, 2, 3, 4]);

      // Smith group (size 3) fits Table 2 (capacity 6, leftover 3)
      const smithGuests = result.assignedGuests.filter((g) => ['g1', 'g2', 'g3'].includes(g.id));
      expect(smithGuests).toHaveLength(3);
      expect(smithGuests.every((g) => g.tableId === 'table-2')).toBe(true);
      expect(smithGuests.map((g) => g.seatNumber).sort()).toEqual([1, 2, 3]);

      // Verify audit snapshots created for every updated record
      expect(createAuditSnapshot).toHaveBeenCalledTimes(7);
      expect(createAuditSnapshot).toHaveBeenCalledWith(
        'InvitationCode',
        'g1',
        expect.objectContaining({ tableId: 'table-2', action: 'autoAssign' }),
        'Admin',
        expect.any(Object)
      );
    });

    it('should strictly enforce table capacity and not assign more guests than table capacity', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 2, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Guest 1', householdName: null, tableId: null },
        { id: 'g2', guestName: 'Guest 2', householdName: null, tableId: null },
        { id: 'g3', guestName: 'Guest 3', householdName: null, tableId: null },
      ]);

      mockTxInvitationCodeUpdate.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(1);
      expect(mockTxInvitationCodeUpdate).toHaveBeenCalledTimes(2);
    });

    it('should retain existing manual assignments and only assign unassigned guests', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        {
          id: 'table-1',
          name: 'Table 1',
          capacity: 3,
          invitationCodes: [{ id: 'seated-1', guestName: 'Seated VIP', seatNumber: 1, tableId: 'table-1' }],
        },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Guest 1', householdName: 'Solo', tableId: null },
        { id: 'g2', guestName: 'Guest 2', householdName: 'Solo', tableId: null },
      ]);

      mockTxInvitationCodeUpdate.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(0);
      // Assigned seats should be 2 and 3, not overriding seat 1
      expect(result.assignedGuests.map((g) => g.seatNumber).sort()).toEqual([2, 3]);
    });

    it('should split household members across tables when no single table has sufficient capacity', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 2, invitationCodes: [] },
        { id: 'table-2', name: 'Table 2', capacity: 2, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Fam 1', householdName: 'LargeFamily', tableId: null },
        { id: 'g2', guestName: 'Fam 2', householdName: 'LargeFamily', tableId: null },
        { id: 'g3', guestName: 'Fam 3', householdName: 'LargeFamily', tableId: null },
      ]);

      mockTxInvitationCodeUpdate.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(3);
      expect(result.unassignedCount).toBe(0);
      const table1Guests = result.assignedGuests.filter((g) => g.tableId === 'table-1');
      const table2Guests = result.assignedGuests.filter((g) => g.tableId === 'table-2');
      expect(table1Guests.length).toBeLessThanOrEqual(2);
      expect(table2Guests.length).toBeLessThanOrEqual(2);
      expect(table1Guests.length + table2Guests.length).toBe(3);
    });

    it('should rollback transaction when an error occurs during auto-assignment', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 5, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Guest 1', householdName: 'H1', tableId: null },
        { id: 'g2', guestName: 'Guest 2', householdName: 'H1', tableId: null },
      ]);

      mockTxInvitationCodeUpdate
        .mockResolvedValueOnce({ id: 'g1', tableId: 'table-1', seatNumber: 1 })
        .mockRejectedValueOnce(new Error('Prisma transaction deadlock'));

      await expect(service.autoAssignSeats('Admin')).rejects.toThrow('Prisma transaction deadlock');
    });

    it('should complete autoAssignSeats in under 500ms for up to 500 guest records', async () => {
      const tables = Array.from({ length: 50 }, (_, i) => ({
        id: `table-${i + 1}`,
        name: `Table ${i + 1}`,
        capacity: 10,
        invitationCodes: [],
      }));

      // 500 guests distributed into households of varying sizes (from 1 to 5)
      const guests: any[] = [];
      let householdId = 1;
      let count = 0;
      while (count < 500) {
        const size = Math.min((householdId % 5) + 1, 500 - count);
        const householdName = `Household_${householdId}`;
        for (let j = 0; j < size; j++) {
          count++;
          guests.push({
            id: `guest-${count}`,
            guestName: `Guest ${count}`,
            householdName,
            tableId: null,
          });
        }
        householdId++;
      }

      mockTxSeatingTableFindMany.mockResolvedValue(tables);
      mockTxInvitationCodeFindMany.mockResolvedValue(guests);
      mockTxInvitationCodeUpdate.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const startTime = Date.now();
      const result = await service.autoAssignSeats('Admin');
      const duration = Date.now() - startTime;

      expect(result.assignedCount).toBe(500);
      expect(result.unassignedCount).toBe(0);
      expect(duration).toBeLessThan(500);
    });
  });
});
