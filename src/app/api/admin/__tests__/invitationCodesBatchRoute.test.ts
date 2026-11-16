/** @jest-environment node */

import { POST, PUT, PATCH, DELETE } from '../invitation-codes/batch/route';
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
      updateBatch: jest.fn(),
      batchDelete: jest.fn(),
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

  test('returns 400 for malformed JSON body', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: 'invalid-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON payload.');
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
      payload.records.map((r) => ({ partyTags: [], ...r })),
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

describe('DELETE /api/admin/invitation-codes/batch', () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockServiceInstance = {
      batchDelete: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(() => mockServiceInstance);
  });

  test('returns 401 if request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['id-1', 'id-2'] }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  test('returns 400 for invalid body schema when ids is empty or missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [] }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('At least one invitation code ID is required');
  });

  test('returns 400 for malformed JSON body', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'DELETE',
      body: 'invalid-json',
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON payload.');
  });

  test('successfully executes batch deletion and returns 200 with count', async () => {
    const mockResult = { success: true, count: 2 };
    mockServiceInstance.batchDelete.mockResolvedValue(mockResult);

    const payload = { ids: ['id-1', 'id-2'] };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'DELETE',
      body: JSON.stringify(payload),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockResult);
    expect(mockServiceInstance.batchDelete).toHaveBeenCalledWith(['id-1', 'id-2'], 'Admin');
  });
});

describe('Batch Update on /api/admin/invitation-codes/batch (POST, PUT, PATCH)', () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockServiceInstance = {
      updateBatch: jest.fn(),
      importBatch: jest.fn(),
      batchDelete: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(() => mockServiceInstance);
  });

  test('successfully executes batch update via POST and returns 200 with count', async () => {
    const updatedRecords = [
      { id: 'code-1', used: true },
      { id: 'code-2', used: true },
    ];
    mockServiceInstance.updateBatch.mockResolvedValue(updatedRecords);

    const payload = { ids: ['code-1', 'code-2'], used: true };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      count: 2,
      updatedCount: 2,
      records: updatedRecords,
    });
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1', 'code-2'],
      { used: true },
      'Admin'
    );
  });

  test('delegates batch update via POST using req.clone()', async () => {
    const updatedRecords = [{ id: 'code-1', used: true }];
    mockServiceInstance.updateBatch.mockResolvedValue(updatedRecords);

    const payload = { ids: ['code-1'], used: true };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const cloneSpy = jest.fn(() => ({
      json: () => Promise.resolve(payload),
    }));
    (req as any).clone = cloneSpy;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(cloneSpy).toHaveBeenCalled();
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: true },
      'Admin'
    );
  });

  test('successfully executes batch update via PUT', async () => {
    const updatedRecords = [{ id: 'code-1', used: false }];
    mockServiceInstance.updateBatch.mockResolvedValue(updatedRecords);

    const payload = { ids: ['code-1'], used: false };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: false },
      'Admin'
    );
  });

  test('successfully executes batch update via PATCH', async () => {
    const updatedRecords = [{ id: 'code-1', used: true }];
    mockServiceInstance.updateBatch.mockResolvedValue(updatedRecords);

    const payload = { ids: ['code-1'], payload: { used: true } };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: true },
      'Admin'
    );
  });

  test('returns 400 when ids array is empty', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({ ids: [], used: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('At least one record identifier is required');
  });

  test('returns 400 when ids exceeds 100 items', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, used: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Maximum of 100 record identifiers allowed per batch request');
  });

  test('reverts and returns error when service throws validation error', async () => {
    mockServiceInstance.updateBatch.mockRejectedValue(
      new Error('Validation Error: Invalid guest identifier.')
    );

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({ ids: ['invalid-id'], used: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid guest identifier.');
  });
});
