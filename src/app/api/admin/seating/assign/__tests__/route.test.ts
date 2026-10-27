/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { SeatingTableAdminService } from '@/features/seating/admin.service';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/utils/rateLimit', () => ({
  rateLimit: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/features/seating/admin.service');

describe('POST /api/admin/seating/assign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should assign seat successfully and return guest object', async () => {
    const mockAssignSeat = jest.fn().mockResolvedValue({
      id: 'guest-1',
      tableId: 'table-1',
      seatNumber: 2,
    });
    (SeatingTableAdminService as jest.MockedClass<typeof SeatingTableAdminService>).prototype.assignSeat = mockAssignSeat;

    const req = new NextRequest('http://localhost/api/admin/seating/assign', {
      method: 'POST',
      body: JSON.stringify({
        invitationCodeId: 'guest-1',
        tableId: 'table-1',
        seatNumber: 2,
      }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      id: 'guest-1',
      tableId: 'table-1',
      seatNumber: 2,
    });
    expect(mockAssignSeat).toHaveBeenCalledWith('guest-1', 'table-1', 2);
  });

  it('should return 400 Bad Request when table reaches maximum capacity', async () => {
    const mockAssignSeat = jest.fn().mockRejectedValue(
      new Error('Validation Error: Table "Table 1" has reached its maximum capacity of 8.')
    );
    (SeatingTableAdminService as jest.MockedClass<typeof SeatingTableAdminService>).prototype.assignSeat = mockAssignSeat;

    const req = new NextRequest('http://localhost/api/admin/seating/assign', {
      method: 'POST',
      body: JSON.stringify({
        invitationCodeId: 'guest-9',
        tableId: 'table-1',
        seatNumber: null,
      }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation Error: Table "Table 1" has reached its maximum capacity of 8.');
  });

  it('should return 400 Bad Request on invalid payload', async () => {
    const req = new NextRequest('http://localhost/api/admin/seating/assign', {
      method: 'POST',
      body: JSON.stringify({
        invitationCodeId: '',
        tableId: 'table-1',
      }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid payload');
  });
});
