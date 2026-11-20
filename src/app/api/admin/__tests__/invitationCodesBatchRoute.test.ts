/** @jest-environment node */

import { POST, PUT, PATCH, DELETE } from '../invitation-codes/batch/route';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getEntityService } from '@/features/admin';
import { InvitationCodeAdminService } from '@/features/registry';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/features/admin', () => ({
  getEntityService: jest.fn(),
}));

jest.mock('@/features/registry/invitation-code.admin.service');

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGetEntityService = getEntityService as jest.MockedFunction<typeof getEntityService>;
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
      batchUpdateTags: jest.fn(),
      importBatch: jest.fn(),
      batchDelete: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(() => mockServiceInstance);
    mockGetEntityService.mockResolvedValue({ service: mockServiceInstance });
  });

  test('dispatches POST tag updates for >100 IDs to batchUpdateTags and returns 200', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `code-${i + 1}`);
    const updatedRecords = ids.map((id, i) => ({
      id,
      code: `CODE${i + 1}`,
      guestName: `Guest ${i + 1}`,
      partyTags: ['VIP'],
    }));
    mockServiceInstance.batchUpdateTags.mockResolvedValue(updatedRecords);

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        ids: [...ids, 'code-1', '  code-2  '],
        tags: ['  VIP  ', '', 'VIP'],
        action: 'add',
      }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      count: 120,
      updatedCount: 120,
      records: updatedRecords,
    });
    expect(mockServiceInstance.batchUpdateTags).toHaveBeenCalledWith(
      ids,
      ['VIP'],
      'add',
      'Admin'
    );
    expect(mockGetEntityService).not.toHaveBeenCalled();
    expect(mockServiceInstance.updateBatch).not.toHaveBeenCalled();
  });

  test('rejects empty normalized tags on add or remove with 400 and allows empty tags on replace', async () => {
    for (const action of ['add', 'remove'] as const) {
      const badReq = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
        method: 'POST',
        body: JSON.stringify({
          ids: ['code-1'],
          tags: ['   ', ''],
          action,
        }),
      });
      const badRes = await POST(badReq, {});
      expect(badRes.status).toBe(400);
      const badBody = await badRes.json();
      expect(badBody.error).toContain('At least one non-empty tag is required');
    }
    expect(mockServiceInstance.batchUpdateTags).not.toHaveBeenCalled();

    mockServiceInstance.batchUpdateTags.mockResolvedValue([
      { id: 'code-1', code: 'CODE1', guestName: 'Guest 1', partyTags: [] },
    ]);
    const replaceReq = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        ids: ['code-1'],
        tags: [],
        action: 'replace',
      }),
    });
    const replaceRes = await POST(replaceReq, {});
    expect(replaceRes.status).toBe(200);
    expect(mockServiceInstance.batchUpdateTags).toHaveBeenCalledWith(
      ['code-1'],
      [],
      'replace',
      'Admin'
    );
  });

  test('rejects batch tag updates exceeding 5000 IDs with 400', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `code-${i}`);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({
        ids,
        tags: ['VIP'],
        action: 'add',
      }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Maximum of 5000 invitation code IDs allowed per batch request');
    expect(mockServiceInstance.batchUpdateTags).not.toHaveBeenCalled();
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

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      count: 2,
      updatedCount: 2,
      records: updatedRecords,
    });
    expect(mockGetEntityService).toHaveBeenCalledWith('invitation-codes');
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1', 'code-2'],
      { used: true }
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

    const res = await POST(req, {});
    expect(res.status).toBe(200);
    expect(cloneSpy).toHaveBeenCalled();
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockGetEntityService).toHaveBeenCalledWith('invitation-codes');
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: true }
    );
  });

  test('forwards mixed POST payloads lacking records to batch update handler', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({ used: true }),
    });

    const res = await POST(req, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(mockGetEntityService).toHaveBeenCalledWith('invitation-codes');
    expect(mockServiceInstance.importBatch).not.toHaveBeenCalled();
  });

  test('successfully executes batch update via PUT', async () => {
    const updatedRecords = [{ id: 'code-1', used: false }];
    mockServiceInstance.updateBatch.mockResolvedValue(updatedRecords);

    const payload = { ids: ['code-1'], used: false };
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const res = await PUT(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockGetEntityService).toHaveBeenCalledWith('invitation-codes');
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: false }
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

    const res = await PATCH(req, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(mockGetEntityService).toHaveBeenCalledWith('invitation-codes');
    expect(mockServiceInstance.updateBatch).toHaveBeenCalledWith(
      ['code-1'],
      { used: true }
    );
  });

  test('returns 400 when ids array is empty', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
      method: 'POST',
      body: JSON.stringify({ ids: [], used: true }),
    });

    const res = await POST(req, {});
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

    const res = await POST(req, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Maximum of 100 record identifiers allowed per batch request');
  });

  test.each(['POST', 'PUT', 'PATCH'] as const)(
    'returns 400 when service throws validation error via %s',
    async (method) => {
      mockServiceInstance.updateBatch.mockRejectedValue(
        new Error('Validation Error: Invalid guest identifier.')
      );

      const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
        method,
        body: JSON.stringify({ ids: ['invalid-id'], used: true }),
      });

      const handler = method === 'POST' ? POST : method === 'PUT' ? PUT : PATCH;
      const res = await handler(req, {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid guest identifier.');
    }
  );
});
