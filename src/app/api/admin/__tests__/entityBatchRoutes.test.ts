/** @jest-environment node */

import { POST, PUT, PATCH, DELETE } from '../[entity]/batch/route';
import { NextRequest } from 'next/server';
import { getEntityService } from '@/features/admin';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/features/admin', () => ({
  getEntityService: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockGetEntityService = getEntityService as jest.MockedFunction<typeof getEntityService>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('Dedicated Admin [entity]/batch Route', () => {
  let mockService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockService = {
      updateBatch: jest.fn(),
      deleteBatch: jest.fn(),
      batchDelete: jest.fn(),
    };
    mockGetEntityService.mockResolvedValue({ service: mockService });
    mockIsAdminRequest.mockResolvedValue(true);
  });

  describe('Authorization and routing', () => {
    test('returns 401 if request is unauthorized', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['1'], isVisible: false }),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(401);
    });

    test('returns 404 if entity service is not registered', async () => {
      mockGetEntityService.mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/admin/unknown-entity/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['1'], isVisible: false }),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'unknown-entity' }) });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Entity not found');
    });
  });

  describe('Batch update validation and execution (POST, PUT, PATCH)', () => {
    test('successfully updates entities via POST and returns 200 with count', async () => {
      const updated = [
        { id: '1', isVisible: false },
        { id: '2', isVisible: false },
      ];
      mockService.updateBatch.mockResolvedValue(updated);

      const payload = { ids: ['1', '2'], isVisible: false };
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        count: 2,
        updatedCount: 2,
        records: updated,
      });
      expect(mockService.updateBatch).toHaveBeenCalledWith(['1', '2'], { isVisible: false });
    });

    test('supports nested payload property in request body', async () => {
      const updated = [{ id: '1', name: 'Updated' }];
      mockService.updateBatch.mockResolvedValue(updated);

      const payload = { ids: ['1'], payload: { name: 'Updated' } };
      const req = new NextRequest('http://localhost/api/admin/wedding-party/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await PUT(req, { params: Promise.resolve({ entity: 'wedding-party' }) });
      expect(res.status).toBe(200);
      expect(mockService.updateBatch).toHaveBeenCalledWith(['1'], { name: 'Updated' });
    });

    test('successfully updates entities via PATCH', async () => {
      const updated = [{ id: '1', status: 'archived' }];
      mockService.updateBatch.mockResolvedValue(updated);

      const payload = { ids: ['1'], status: 'archived' };
      const req = new NextRequest('http://localhost/api/admin/content-nodes/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await PATCH(req, { params: Promise.resolve({ entity: 'content-nodes' }) });
      expect(res.status).toBe(200);
      expect(mockService.updateBatch).toHaveBeenCalledWith(['1'], { status: 'archived' });
    });

    test('returns 400 when ids array is empty', async () => {
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [], isVisible: false }),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('At least one record identifier is required');
    });

    test('returns 400 when ids array exceeds 100 items', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `item-${i}`);
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, isVisible: false }),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Maximum of 100 record identifiers allowed per batch request');
    });

    test('returns 400 for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json',
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid JSON payload');
    });

    test('returns 400 when service throws validation error', async () => {
      mockService.updateBatch.mockRejectedValue(
        new Error('Validation Error: Target property is invalid')
      );

      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['1'], name: '' }),
      });

      const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Target property is invalid');
    });
  });

  describe('Batch delete (DELETE)', () => {
    test('successfully executes batch delete using service.batchDelete if available', async () => {
      mockService.batchDelete.mockResolvedValue({ success: true, count: 2 });

      const req = new NextRequest('http://localhost/api/admin/invitation-codes/batch', {
        method: 'DELETE',
        body: JSON.stringify({ ids: ['1', '2'] }),
      });

      const res = await DELETE(req, { params: Promise.resolve({ entity: 'invitation-codes' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, count: 2 });
      expect(mockService.batchDelete).toHaveBeenCalledWith(['1', '2']);
    });

    test('successfully executes batch delete using service.deleteBatch fallback', async () => {
      mockService.batchDelete = undefined;
      mockService.deleteBatch.mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'DELETE',
        body: JSON.stringify({ ids: ['1', '2'] }),
      });

      const res = await DELETE(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, count: 2 });
      expect(mockService.deleteBatch).toHaveBeenCalledWith(['1', '2']);
    });

    test('returns 400 when ids array is empty for DELETE', async () => {
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [] }),
      });

      const res = await DELETE(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('At least one record identifier is required');
    });

    test('returns 400 when ids array exceeds 100 items for DELETE', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `item-${i}`);
      const req = new NextRequest('http://localhost/api/admin/attractions/batch', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      });

      const res = await DELETE(req, { params: Promise.resolve({ entity: 'attractions' }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Maximum of 100 record identifiers allowed per batch request');
    });
  });
});
