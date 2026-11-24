/** @jest-environment node */

import { SeatingTableAdminService } from '../admin.service';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';

const mockTxSeatingTableCreate = jest.fn();
const mockTxSeatingTableUpdate = jest.fn();
const mockTxSeatingTableDelete = jest.fn();
const mockTxSeatingTableFindUnique = jest.fn();
const mockTxSeatingTableFindMany = jest.fn();
const mockTxInvitationCodeUpdate = jest.fn();
const mockTxInvitationCodeUpdateMany = jest.fn();
const mockTxInvitationCodeFindFirst = jest.fn();
const mockTxInvitationCodeFindMany = jest.fn();
const mockTxExecuteRaw = jest.fn();

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
      createMany: jest.fn(),
    },
    $executeRaw: (...args: any[]) => mockTxExecuteRaw(...args),
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
      snapshotVersion: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
      $executeRaw: jest.fn(),
      $transaction: jest.fn((callback) => callback(mockTx)),
    },
  };
});

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
  createBatchAuditSnapshots: jest.fn(),
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
    ).rejects.toThrow('Validation Error:');
  });

  it('should accept head and sweetheart 1-sided table shapes', async () => {
    mockTxSeatingTableCreate
      .mockResolvedValueOnce({ id: 'tbl-head', name: 'Head Table', shape: 'head', capacity: 8 })
      .mockResolvedValueOnce({ id: 'tbl-sweet', name: 'Sweetheart', shape: 'sweetheart', capacity: 2 });

    const head = await service.create({ name: 'Head Table', shape: 'head', capacity: 8 }, 'Admin');
    const sweet = await service.create({ name: 'Sweetheart', shape: 'sweetheart', capacity: 2 }, 'Admin');

    expect(head.shape).toBe('head');
    expect(sweet.shape).toBe('sweetheart');
  });

  it('supports zero-capacity landmarks (dance-floor, bar, dj, buffet, cake) and rejects guest drops onto landmarks', async () => {
    mockTxSeatingTableCreate.mockResolvedValueOnce({
      id: 'lm-dance',
      name: 'Main Dance Floor',
      shape: 'dance-floor',
      capacity: 0,
    });

    const landmark = await service.create(
      { name: 'Main Dance Floor', shape: 'dance-floor', capacity: 0 },
      'Admin'
    );
    expect(landmark.capacity).toBe(0);
    expect(landmark.shape).toBe('dance-floor');

    await expect(
      service.create({ name: 'Invalid Dance Floor', shape: 'dance-floor', capacity: 4 }, 'Admin')
    ).rejects.toThrow('Validation Error: Landmarks must have 0 capacity.');

    mockTxSeatingTableFindUnique.mockResolvedValueOnce({
      id: 'lm-dance',
      name: 'Main Dance Floor',
      shape: 'dance-floor',
      capacity: 0,
      invitationCodes: [],
    });
    mockTxInvitationCodeFindMany.mockResolvedValueOnce([
      {
        id: 'g-1',
        guestName: 'Alice',
        tableId: null,
        seatNumber: null,
      },
    ]);

    await expect(service.assignSeat('g-1', 'lm-dance', 1, 'Admin')).rejects.toThrow(
      'Validation Error: Cannot assign guests to landmark "Main Dance Floor".'
    );
  });

  it('claims distinct plusOneSeatNumbers when seating an invitation with plus-ones and blocks overflow', async () => {
    mockTxSeatingTableFindUnique.mockResolvedValueOnce({
      id: 'tbl-4',
      name: 'Garden Table',
      shape: 'round',
      capacity: 4,
      invitationCodes: [{ id: 'g-existing', guestName: 'Existing Guest', seatNumber: 1, plusOneSeatNumbers: [] }],
    });
    mockTxInvitationCodeFindMany.mockResolvedValueOnce([
      {
        id: 'g-party-3',
        guestName: 'Clara Oswald',
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        used: true,
        extraFields: { attending: true, plusOneNames: ['Danny Pink', 'Rigsy'] },
      },
    ]);
    mockTxInvitationCodeFindFirst.mockResolvedValueOnce(null);
    mockTxInvitationCodeUpdate.mockResolvedValueOnce({
      id: 'g-party-3',
      guestName: 'Clara Oswald',
      tableId: 'tbl-4',
      seatNumber: 2,
      plusOneSeatNumbers: [3, 4],
    });

    const assigned = await service.assignSeat('g-party-3', 'tbl-4', 2, 'Admin');
    expect(assigned.seatNumber).toBe(2);
    expect(mockTxInvitationCodeUpdate).toHaveBeenCalledWith({
      where: { id: 'g-party-3' },
      data: {
        tableId: 'tbl-4',
        seatNumber: 2,
        plusOneSeatNumbers: [3, 4],
      },
    });

    // Overflow: 3-person party cannot fit on a table with only 2 open chairs
    mockTxSeatingTableFindUnique.mockResolvedValueOnce({
      id: 'tbl-tight',
      name: 'Small Table',
      shape: 'round',
      capacity: 3,
      invitationCodes: [{ id: 'g-existing', guestName: 'Existing Guest', seatNumber: 1, plusOneSeatNumbers: [] }],
    });
    mockTxInvitationCodeFindMany.mockResolvedValueOnce([
      {
        id: 'g-party-3',
        guestName: 'Clara Oswald',
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        used: true,
        extraFields: { attending: true, plusOneNames: ['Danny Pink', 'Rigsy'] },
      },
    ]);

    await expect(service.assignSeat('g-party-3', 'tbl-tight', 2, 'Admin')).rejects.toThrow(
      'Validation Error: Table "Small Table" has reached its maximum capacity of 3.'
    );
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

      mockTxExecuteRaw.mockResolvedValue(7);

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

      // Verify batch raw SQL update executed once instead of sequential individual updates
      expect(mockTxInvitationCodeUpdate).not.toHaveBeenCalled();
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      const rawQuery = mockTxExecuteRaw.mock.calls[0][0];
      expect(rawQuery.sql).toContain('UPDATE "public"."InvitationCode" AS t');
      expect(rawQuery.sql).toContain('WHERE t."id" = v."id"');
      expect(rawQuery.values).toContain('g1');
      expect(rawQuery.values).toContain('table-2');

      // Verify single bulk audit snapshot query executed instead of sequential individual snapshots
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'InvitationCode',
        expect.arrayContaining([
          expect.objectContaining({
            entityId: 'g1',
            data: expect.objectContaining({ tableId: 'table-2', action: 'autoAssign' }),
          }),
        ]),
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

      mockTxExecuteRaw.mockResolvedValue(2);

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(1);
      expect(mockTxInvitationCodeUpdate).not.toHaveBeenCalled();
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
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

      mockTxExecuteRaw.mockResolvedValue(2);

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(0);
      // Assigned seats should be 2 and 3, not overriding seat 1
      expect(result.assignedGuests.map((g) => g.seatNumber).sort()).toEqual([2, 3]);
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
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

      mockTxExecuteRaw.mockResolvedValue(3);

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(3);
      expect(result.unassignedCount).toBe(0);
      const table1Guests = result.assignedGuests.filter((g) => g.tableId === 'table-1');
      const table2Guests = result.assignedGuests.filter((g) => g.tableId === 'table-2');
      expect(table1Guests.length).toBeLessThanOrEqual(2);
      expect(table2Guests.length).toBeLessThanOrEqual(2);
      expect(table1Guests.length + table2Guests.length).toBe(3);
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
    });

    it('should rollback transaction when an error occurs during auto-assignment', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 5, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Guest 1', householdName: 'H1', tableId: null },
        { id: 'g2', guestName: 'Guest 2', householdName: 'H1', tableId: null },
      ]);

      mockTxExecuteRaw.mockRejectedValueOnce(new Error('Prisma transaction deadlock'));

      await expect(service.autoAssignSeats('Admin')).rejects.toThrow('Prisma transaction deadlock');
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
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
      mockTxExecuteRaw.mockResolvedValue(500);

      const startTime = Date.now();
      const result = await service.autoAssignSeats('Admin');
      const duration = Date.now() - startTime;

      expect(result.assignedCount).toBe(500);
      expect(result.unassignedCount).toBe(0);
      expect(mockTxInvitationCodeUpdate).not.toHaveBeenCalled();
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledTimes(1);
      expect(duration).toBeLessThan(500);
    });

    it('should not execute raw update or bulk audit when no capacity is available for unassigned guests', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 1, invitationCodes: [{ id: 'seated-1', seatNumber: 1 }] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        { id: 'g1', guestName: 'Guest 1', householdName: null, tableId: null },
      ]);

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(0);
      expect(result.unassignedCount).toBe(1);
      expect(result.assignedGuests).toEqual([]);
      expect(mockTxExecuteRaw).not.toHaveBeenCalled();
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });

    it('should exclude declined RSVPs and address-collection rows from autoAssignSeats', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 6, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        {
          id: 'g-attending',
          guestName: 'Attending Guest',
          householdName: null,
          tableId: null,
          used: true,
          extraFields: JSON.stringify({ attending: 'yes' }),
          partyTags: ['family'],
        },
        {
          id: 'g-pending',
          guestName: 'Pending Guest',
          householdName: null,
          tableId: null,
          used: false,
          extraFields: null,
          partyTags: [],
        },
        {
          id: 'g-declined',
          guestName: 'Declined Guest',
          householdName: null,
          tableId: null,
          used: true,
          extraFields: JSON.stringify({ attending: 'no' }),
          partyTags: [],
        },
        {
          id: 'g-address',
          guestName: 'Address Submission',
          householdName: null,
          tableId: null,
          used: false,
          extraFields: null,
          partyTags: ['address-collection'],
        },
      ]);

      mockTxExecuteRaw.mockResolvedValue(2);

      const result = await service.autoAssignSeats('Admin');

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(0);
      expect(result.assignedGuests.map((g) => g.id).sort()).toEqual(['g-attending', 'g-pending']);
    });

    it('should exclude pending RSVPs when includePending is false', async () => {
      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 6, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValue([
        {
          id: 'g-attending',
          guestName: 'Attending Guest',
          householdName: null,
          tableId: null,
          used: true,
          extraFields: { attending: true },
          partyTags: [],
        },
        {
          id: 'g-pending',
          guestName: 'Pending Guest',
          householdName: null,
          tableId: null,
          used: false,
          extraFields: null,
          partyTags: [],
        },
      ]);

      mockTxExecuteRaw.mockResolvedValue(1);

      const result = await service.autoAssignSeats('Admin', { includePending: false });

      expect(result.assignedCount).toBe(1);
      expect(result.unassignedCount).toBe(0);
      expect(result.assignedGuests).toHaveLength(1);
      expect(result.assignedGuests[0].id).toBe('g-attending');
    });

    it('skips zero-capacity landmarks, counts plus-one chairs, groups by partyGroup/partyTags, and honors keepHouseholdsIntact', async () => {
      mockTxSeatingTableFindMany.mockResolvedValueOnce([
        { id: 'lm-dance', name: 'Dance Floor', shape: 'dance-floor', capacity: 0, invitationCodes: [] },
        { id: 'lm-bar', name: 'Cocktail Bar', shape: 'bar', capacity: 0, invitationCodes: [] },
        { id: 'tbl-college', name: 'Table A', shape: 'round', capacity: 4, invitationCodes: [] },
        { id: 'tbl-small-1', name: 'Table B', shape: 'round', capacity: 2, invitationCodes: [] },
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        // College Friends group via partyGroup + partyTags, where g-c1 has 1 plus-one (2 chairs) + g-c2 (1 chair) = 3 chairs total -> fits on tbl-college (cap 4)
        {
          id: 'g-c1',
          guestName: 'Liam',
          householdName: null,
          partyGroup: 'College Friends',
          partyTags: ['alumni'],
          tableId: null,
          used: true,
          extraFields: { attending: true, plusOneNames: ['Noah'] },
        },
        {
          id: 'g-c2',
          guestName: 'Olivia',
          householdName: null,
          partyGroup: 'College Friends',
          partyTags: ['alumni'],
          tableId: null,
          used: true,
          extraFields: { attending: true },
        },
        // Intact household of 3 invitations (3 chairs total), while remaining open chairs are 1 on Table A + 2 on Table B -> cannot fit intact!
        { id: 'hh-1', guestName: 'Miller 1', householdName: 'Miller Family', tableId: null, used: true, extraFields: { attending: true } },
        { id: 'hh-2', guestName: 'Miller 2', householdName: 'Miller Family', tableId: null, used: true, extraFields: { attending: true } },
        { id: 'hh-3', guestName: 'Miller 3', householdName: 'Miller Family', tableId: null, used: true, extraFields: { attending: true } },
      ]);

      mockTxExecuteRaw.mockResolvedValueOnce(2);

      const result = await service.autoAssignSeats('Admin', { keepHouseholdsIntact: true });

      // College Friends (2 invitations, 3 chairs/attendees) seated together on tbl-college; Miller Family (3 invitations) kept unassigned intact; landmarks untouched
      expect(result.assignedCount).toBe(3);
      expect(result.unassignedCount).toBe(3);
      expect(result.assignedGuests.every((g) => g.tableId === 'tbl-college')).toBe(true);
      const liamAssigned = result.assignedGuests.find((g) => g.id === 'g-c1')!;
      expect(liamAssigned.seatNumber).toBe(1);
      expect(liamAssigned.plusOneSeatNumbers).toEqual([2]);
      const oliviaAssigned = result.assignedGuests.find((g) => g.id === 'g-c2')!;
      expect(oliviaAssigned.seatNumber).toBe(3);
    });
  });

  describe('assignSeatsBatch & restoreSeatAssignments', () => {
    it('assigns a household batch atomically and records batch audit snapshots', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null, used: true, extraFields: { attending: true } },
        { id: 'g2', guestName: 'Bob', tableId: null, seatNumber: null, used: true, extraFields: { attending: true } },
      ]);

      mockTxSeatingTableFindUnique.mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
        invitationCodes: [{ id: 'existing', guestName: 'VIP', seatNumber: 1 }],
      });

      mockTxExecuteRaw.mockResolvedValue(2);

      const result = await service.assignSeatsBatch(['g1', 'g2'], 'table-1', {
        action: 'assignBatch',
        author: 'Admin',
      });

      expect(result.updatedGuests).toHaveLength(2);
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'InvitationCode',
        expect.arrayContaining([
          expect.objectContaining({
            entityId: 'g1',
            data: expect.objectContaining({ tableId: 'table-1', seatNumber: 2, action: 'assignBatch' }),
          }),
          expect.objectContaining({
            entityId: 'g2',
            data: expect.objectContaining({ tableId: 'table-1', seatNumber: 3, action: 'assignBatch' }),
          }),
        ]),
        'Admin',
        expect.any(Object)
      );
    });

    it('rejects assignSeatsBatch when table lacks sufficient open capacity', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null, used: true, extraFields: { attending: true } },
        { id: 'g2', guestName: 'Bob', tableId: null, seatNumber: null, used: true, extraFields: { attending: true } },
      ]);

      mockTxSeatingTableFindUnique.mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 2,
        invitationCodes: [{ id: 'existing', guestName: 'VIP', seatNumber: 1 }],
      });

      await expect(
        service.assignSeatsBatch(['g1', 'g2'], 'table-1', { action: 'assignBatch', author: 'Admin' })
      ).rejects.toThrow('Validation Error: Table "Table 1" has reached its maximum capacity of 2.');

      expect(mockTxExecuteRaw).not.toHaveBeenCalled();
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });

    it('clears table seats in batch and records clearTable batch audit snapshots', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: 'table-1', seatNumber: 1 },
        { id: 'g2', guestName: 'Bob', tableId: 'table-1', seatNumber: 2 },
      ]);

      mockTxExecuteRaw.mockResolvedValue(2);

      const cleared = await service.assignSeatsBatch(['g1', 'g2'], null, {
        action: 'clearTable',
        author: 'Admin',
      });
      expect(cleared.updatedGuests).toHaveLength(2);
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'InvitationCode',
        expect.arrayContaining([
          expect.objectContaining({
            entityId: 'g1',
            data: expect.objectContaining({ tableId: null, seatNumber: null, action: 'clearTable' }),
          }),
        ]),
        'Admin',
        expect.any(Object)
      );
    });

    it('restores prior seat assignments atomically for undo and writes batch audit snapshots', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null },
        { id: 'g2', guestName: 'Bob', tableId: 'table-2', seatNumber: 1 },
      ]);

      mockTxSeatingTableFindMany.mockResolvedValue([
        { id: 'table-1', name: 'Table 1', capacity: 4, invitationCodes: [] },
      ]);

      mockTxExecuteRaw.mockResolvedValue(2);

      const restored = await service.restoreSeatAssignments(
        [
          { invitationCodeId: 'g1', tableId: 'table-1', seatNumber: 1 },
          { invitationCodeId: 'g2', tableId: null, seatNumber: null },
        ],
        { action: 'undo', author: 'Admin' }
      );

      expect(restored.updatedGuests).toHaveLength(2);
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'InvitationCode',
        expect.arrayContaining([
          expect.objectContaining({
            entityId: 'g1',
            data: expect.objectContaining({ tableId: 'table-1', seatNumber: 1, action: 'undo' }),
          }),
          expect.objectContaining({
            entityId: 'g2',
            data: expect.objectContaining({ tableId: null, seatNumber: null, action: 'undo' }),
          }),
        ]),
        'Admin',
        expect.any(Object)
      );
    });

    it('preserves valid existing seat numbers on the target table in assignSeatsBatch before allocating open seats', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: 'table-1', seatNumber: 3, used: true, extraFields: { attending: true } },
        { id: 'g2', guestName: 'Bob', tableId: null, seatNumber: null, used: true, extraFields: { attending: true } },
      ]);

      mockTxSeatingTableFindUnique.mockResolvedValue({
        id: 'table-1',
        name: 'Table 1',
        capacity: 4,
        invitationCodes: [
          { id: 'existing', guestName: 'VIP', seatNumber: 1 },
          { id: 'g1', guestName: 'Alice', seatNumber: 3 },
        ],
      });

      mockTxExecuteRaw.mockResolvedValue(2);

      const result = await service.assignSeatsBatch(['g1', 'g2'], 'table-1', {
        action: 'assignBatch',
        author: 'Admin',
      });

      expect(result.updatedGuests).toEqual([
        expect.objectContaining({ id: 'g1', guestName: 'Alice', tableId: 'table-1', seatNumber: 3 }),
        expect.objectContaining({ id: 'g2', guestName: 'Bob', tableId: 'table-1', seatNumber: 2 }),
      ]);
    });

    it('rejects assignSeatsBatch and restoreSeatAssignments when one or more guests are not found', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null },
      ]);

      await expect(service.assignSeatsBatch(['g1', 'missing-id'], 'table-1')).rejects.toThrow(
        'Validation Error: One or more guests not found.'
      );

      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null },
      ]);

      await expect(
        service.restoreSeatAssignments([
          { invitationCodeId: 'g1', tableId: 'table-1', seatNumber: 1 },
          { invitationCodeId: 'missing-id', tableId: null, seatNumber: null },
        ])
      ).rejects.toThrow('Validation Error: One or more guests not found.');

      expect(mockTxExecuteRaw).not.toHaveBeenCalled();
    });

    it('prepends displaced occupant seat-clearing updates and enforces capacity in restoreSeatAssignments', async () => {
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null },
      ]);

      mockTxSeatingTableFindMany.mockResolvedValueOnce([
        {
          id: 'table-1',
          name: 'Table 1',
          capacity: 3,
          invitationCodes: [{ id: 'occ-1', guestName: 'Occupied Guest', tableId: 'table-1', seatNumber: 2 }],
        },
      ]);

      mockTxExecuteRaw.mockResolvedValue(2);

      const restored = await service.restoreSeatAssignments(
        [{ invitationCodeId: 'g1', tableId: 'table-1', seatNumber: 2 }],
        { action: 'undo', author: 'Admin' }
      );

      expect(restored.updatedGuests).toEqual([
        expect.objectContaining({
          id: 'occ-1',
          guestName: 'Occupied Guest',
          tableId: 'table-1',
          seatNumber: null,
        }),
        expect.objectContaining({
          id: 'g1',
          guestName: 'Alice',
          tableId: 'table-1',
          seatNumber: 2,
        }),
      ]);

      mockTxInvitationCodeFindMany.mockResolvedValueOnce([
        { id: 'g1', guestName: 'Alice', tableId: null, seatNumber: null },
      ]);
      mockTxSeatingTableFindMany.mockResolvedValueOnce([
        {
          id: 'table-1',
          name: 'Table 1',
          capacity: 1,
          invitationCodes: [{ id: 'occ-1', guestName: 'Occupied Guest', tableId: 'table-1', seatNumber: 1 }],
        },
      ]);

      await expect(
        service.restoreSeatAssignments([{ invitationCodeId: 'g1', tableId: 'table-1', seatNumber: 1 }])
      ).rejects.toThrow('Validation Error: Table "Table 1" has reached its maximum capacity of 1.');
    });

    it('seats 4 couples (8 attendees) on an 8-seat table, leaves 4 couples unassigned, and rejects a 5th couple across assign methods', async () => {
      const eightCouples = Array.from({ length: 8 }, (_, idx) => ({
        id: `couple-${idx + 1}`,
        code: `CPL-${idx + 1}`,
        guestName: `Couple ${idx + 1}`,
        tableId: null,
        seatNumber: null,
        used: true,
        plusOneAllocations: 1,
        extraFields: { attending: true, plusOneCount: 1 },
        partyTags: [],
        householdId: null,
      }));

      mockTxInvitationCodeFindMany.mockResolvedValueOnce(eightCouples);
      mockTxSeatingTableFindMany.mockResolvedValueOnce([
        { id: 'table-8', name: 'Round Eight', capacity: 8 },
      ]);
      mockTxExecuteRaw.mockResolvedValueOnce(4);

      const autoResult = await service.autoAssignSeats('Admin');

      // 4 couples = 8 attendees seated on primary seats 1, 3, 5, 7; 4 couples = 8 attendees unassigned
      expect(autoResult.assignedCount).toBe(8);
      expect(autoResult.unassignedCount).toBe(8);
      expect(autoResult.assignedGuests).toHaveLength(4);
      expect(autoResult.assignedGuests.map((g) => g.seatNumber)).toEqual([1, 3, 5, 7]);

      const seatedFourCouples = eightCouples.slice(0, 4).map((c, idx) => ({
        ...c,
        tableId: 'table-8',
        seatNumber: idx * 2 + 1,
      }));
      const fifthCouple = eightCouples[4];

      // Manual single assignSeat rejects 5th couple on full 8-seat table
      mockTxInvitationCodeFindFirst.mockResolvedValueOnce(fifthCouple);
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([fifthCouple]);
      mockTxSeatingTableFindUnique.mockResolvedValueOnce({
        id: 'table-8',
        name: 'Round Eight',
        capacity: 8,
        invitationCodes: seatedFourCouples,
      });

      await expect(service.assignSeat(fifthCouple.id, 'table-8', null, 'Admin')).rejects.toThrow(
        /only has 0 open seats for "Couple 5" \(party of 2\)|reached its maximum capacity of 8/
      );

      // Batch assignSeatsBatch rejects 5th couple on full 8-seat table
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([fifthCouple]);
      mockTxSeatingTableFindUnique.mockResolvedValueOnce({
        id: 'table-8',
        name: 'Round Eight',
        capacity: 8,
        invitationCodes: seatedFourCouples,
      });

      await expect(service.assignSeatsBatch([fifthCouple.id], 'table-8')).rejects.toThrow(
        /only has 0 open seats for 2 guests|maximum capacity of 8/
      );

      // Never splits a single InvitationCode party across two tables with 1 open seat each
      mockTxInvitationCodeFindMany.mockResolvedValueOnce([fifthCouple]);
      mockTxSeatingTableFindMany.mockResolvedValueOnce([
        {
          id: 'tbl-a',
          name: 'Table A',
          capacity: 2,
          invitationCodes: [
            {
              id: 'occ-a',
              guestName: 'Occ A',
              tableId: 'tbl-a',
              seatNumber: 1,
              used: true,
              plusOneAllocations: 0,
              extraFields: { attending: true, plusOneCount: 0 },
              partyTags: [],
            },
          ],
        },
        {
          id: 'tbl-b',
          name: 'Table B',
          capacity: 2,
          invitationCodes: [
            {
              id: 'occ-b',
              guestName: 'Occ B',
              tableId: 'tbl-b',
              seatNumber: 1,
              used: true,
              plusOneAllocations: 0,
              extraFields: { attending: true, plusOneCount: 0 },
              partyTags: [],
            },
          ],
        },
      ]);

      const unsplitResult = await service.autoAssignSeats('Admin');
      expect(unsplitResult.assignedCount).toBe(0);
      expect(unsplitResult.unassignedCount).toBe(2);
      expect(unsplitResult.assignedGuests).toHaveLength(0);
    });

    it('repacks out-of-range seatNumber into 1..capacity when SeatingTableAdminService.update shrinks table capacity', async () => {
      const existingTable = {
        id: 'table-shrink',
        name: 'Shrink Table',
        shape: 'round',
        capacity: 8,
        x: 0,
        y: 0,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-seat-8',
            code: 'S8',
            guestName: 'Seat Eight Guest',
            tableId: 'table-shrink',
            seatNumber: 8,
            plusOneAllocations: 0,
          },
        ],
      };

      mockTxSeatingTableFindUnique
        .mockResolvedValueOnce(existingTable)
        .mockResolvedValueOnce({
          ...existingTable,
          capacity: 6,
          invitationCodes: [
            {
              ...existingTable.invitationCodes[0],
              seatNumber: 1,
            },
          ],
        });
      mockTxSeatingTableUpdate.mockResolvedValueOnce({
        ...existingTable,
        capacity: 6,
      });
      mockTxExecuteRaw.mockResolvedValueOnce(1);

      const updated = await service.update('table-shrink', { capacity: 6 }, 'Admin');
      expect(mockTxExecuteRaw).toHaveBeenCalledTimes(1);
      expect(updated.capacity).toBe(6);
      expect(updated.invitationCodes?.[0]?.seatNumber).toBe(1);
      expect(createBatchAuditSnapshots).toHaveBeenCalled();
    });
  });
});
