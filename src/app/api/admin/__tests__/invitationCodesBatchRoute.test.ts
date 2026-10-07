/** @jest-environment node */

import { POST } from '../invitation-codes/batch/route';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { InvitationCodeAdminService } from '@/features/registry/invitation-code.admin.service';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/features/registry/invitation-code.admin.service');

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const MockInvitationCodeAdminService = InvitationCodeAdminService as jest.MockedClass<
  typeof InvitationCodeAdminService
>;

describe('POST /api/admin/invitation-codes/batch', () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockServiceInstance = {
      importBatch: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(() => mockServiceInstance);
  });

  test('returns 401 if request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        records: [{ guestName: 'John Doe', code: 'JOHN100' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('returns 400 for invalid body schema', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        records: [],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('At least one record is required');
  });

  test('successfully executes multi-column batch import and returns 201', async () => {
    const mockResult = {
      success: true,
      count: 2,
      imported: 2,
      skipped: 0,
      updated: 0,
    };
    mockServiceInstance.importBatch.mockResolvedValue(mockResult);

    const payload = {
      records: [
        {
          guestName: 'Alice',
          code: 'ALICE100',
          email: 'alice@example.com',
          dietaryNotes: 'Gluten Free',
          plusOneAllocations: 1,
          extraFields: { Table: 'VIP' },
        },
        { guestName: 'Bob', code: '' },
      ],
      collisionStrategy: 'skip' as const,
    };

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual(mockResult);
    expect(mockServiceInstance.importBatch).toHaveBeenCalledWith(
      payload.records,
      'skip',
      'Admin'
    );
  });

  test('handles duplicate error with 400 status', async () => {
    mockServiceInstance.importBatch.mockRejectedValue(
      new Error('Duplicate invitation code found: ALICE100')
    );

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        records: [{ guestName: 'Alice', code: 'ALICE100' }],
        collisionStrategy: 'reject',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Duplicate invitation code found: ALICE100');
  });
});
