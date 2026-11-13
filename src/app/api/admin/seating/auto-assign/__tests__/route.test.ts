/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { SeatingTableAdminService } from '@/features/seating/admin.service';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/utils/rateLimit', () => ({
  rateLimit: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/features/seating/admin.service');

describe('POST /api/admin/seating/auto-assign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isAdminRequest as jest.Mock).mockResolvedValue(true);
  });

  it('should execute auto-assignment successfully and return assigned statistics', async () => {
    const mockAutoAssign = jest.fn().mockResolvedValue({
      assignedCount: 4,
      unassignedCount: 0,
      assignedGuests: [
        { id: 'guest-1', guestName: 'Alice Smith', tableId: 'table-1', seatNumber: 1 },
        { id: 'guest-2', guestName: 'Bob Smith', tableId: 'table-1', seatNumber: 2 },
        { id: 'guest-3', guestName: 'Charlie Doe', tableId: 'table-2', seatNumber: 1 },
        { id: 'guest-4', guestName: 'David Doe', tableId: 'table-2', seatNumber: 2 },
      ],
    });
    (SeatingTableAdminService as jest.MockedClass<typeof SeatingTableAdminService>).prototype.autoAssignSeats = mockAutoAssign;

    const req = new NextRequest('http://localhost/api/admin/seating/auto-assign', {
      method: 'POST',
      body: JSON.stringify({ author: 'WeddingPlanner' }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      assignedCount: 4,
      unassignedCount: 0,
      assignedGuests: expect.arrayContaining([
        expect.objectContaining({ id: 'guest-1', tableId: 'table-1' }),
      ]),
    });
    expect(mockAutoAssign).toHaveBeenCalledWith('WeddingPlanner');
  });

  it('should default author to "Admin" when no request body is passed', async () => {
    const mockAutoAssign = jest.fn().mockResolvedValue({
      assignedCount: 0,
      unassignedCount: 0,
      assignedGuests: [],
    });
    (SeatingTableAdminService as jest.MockedClass<typeof SeatingTableAdminService>).prototype.autoAssignSeats = mockAutoAssign;

    const req = new NextRequest('http://localhost/api/admin/seating/auto-assign', {
      method: 'POST',
    });

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    expect(mockAutoAssign).toHaveBeenCalledWith('Admin');
  });

  it('should return 401 Unauthorized when request is not from an authenticated admin', async () => {
    (isAdminRequest as jest.Mock).mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/admin/seating/auto-assign', {
      method: 'POST',
    });

    const res = await POST(req, {});
    expect(res.status).toBe(401);
  });

  it('should return 500 when auto-assignment service encounters a fatal database error', async () => {
    const mockAutoAssign = jest.fn().mockRejectedValue(new Error('Database transaction connection lost'));
    (SeatingTableAdminService as jest.MockedClass<typeof SeatingTableAdminService>).prototype.autoAssignSeats = mockAutoAssign;

    const req = new NextRequest('http://localhost/api/admin/seating/auto-assign', {
      method: 'POST',
    });

    const res = await POST(req, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
