/** @jest-environment node */

import { SeatingTableAdminService } from '../admin.service';
import { createAuditSnapshot } from '@/lib/audit';

const mockTxSeatingTableCreate = jest.fn();
const mockTxSeatingTableUpdate = jest.fn();
const mockTxSeatingTableDelete = jest.fn();
const mockTxSeatingTableFindUnique = jest.fn();
const mockTxInvitationCodeUpdate = jest.fn();
const mockTxInvitationCodeUpdateMany = jest.fn();
const mockTxInvitationCodeFindFirst = jest.fn();

jest.mock('@/lib/prisma', () => {
  const mockTx = {
    seatingTable: {
      create: (...args: any[]) => mockTxSeatingTableCreate(...args),
      update: (...args: any[]) => mockTxSeatingTableUpdate(...args),
      delete: (...args: any[]) => mockTxSeatingTableDelete(...args),
      findUnique: (...args: any[]) => mockTxSeatingTableFindUnique(...args),
    },
    invitationCode: {
      update: (...args: any[]) => mockTxInvitationCodeUpdate(...args),
      updateMany: (...args: any[]) => mockTxInvitationCodeUpdateMany(...args),
      findFirst: (...args: any[]) => mockTxInvitationCodeFindFirst(...args),
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
      },
      invitationCode: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
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
});
