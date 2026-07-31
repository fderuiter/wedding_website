/** @jest-environment node */

import { GET, POST, PUT } from '../[entity]/route';
import { GET as GET_ITEM, PUT as PUT_ITEM, DELETE as DELETE_ITEM } from '../[entity]/[id]/route';
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

describe('Dynamic Administration Entity API Routes', () => {
  let mockService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock service implementation
    mockService = {
      findMany: jest.fn(),
      create: jest.fn(),
      reorder: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockGetEntityService.mockResolvedValue({ service: mockService });
    mockIsAdminRequest.mockResolvedValue(true); // Default to authorized
  });

  describe('Collection-level Routes: GET, POST, PUT', () => {
    
    describe('Authorization & Middleware checks', () => {
      test('GET fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions');
        
        const res = await GET(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Unauthorized');
      });

      test('POST fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'POST',
          body: JSON.stringify({ name: 'Central Park' }),
        });
        
        const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(401);
      });

      test('PUT fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: ['1', '2'] }),
        });
        
        const res = await PUT(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(401);
      });
    });

    describe('GET Handler', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown-entity');
        
        const res = await GET(req, { params: Promise.resolve({ entity: 'unknown-entity' }) });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Entity not found');
      });

      test('returns collection with default ordering (createdAt desc)', async () => {
        const mockRecords = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];
        mockService.findMany.mockResolvedValue(mockRecords);

        const req = new NextRequest('http://localhost/api/admin/attractions');
        const res = await GET(req, { params: Promise.resolve({ entity: 'attractions' }) });
        
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, data: mockRecords });
        expect(mockService.findMany).toHaveBeenCalledWith({
          orderBy: { createdAt: 'desc' },
        });
      });

      test('respects custom orderBy and orderDir query parameters', async () => {
        mockService.findMany.mockResolvedValue([]);
        const req = new NextRequest('http://localhost/api/admin/attractions?orderBy=name&orderDir=asc');
        
        await GET(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(mockService.findMany).toHaveBeenCalledWith({
          orderBy: { name: 'asc' },
        });
      });
    });

    describe('POST Handler', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown-entity', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        const res = await POST(req, { params: Promise.resolve({ entity: 'unknown-entity' }) });
        expect(res.status).toBe(404);
      });

      test('creates a record successfully and returns 201', async () => {
        const payload = { title: 'New Member', role: 'Groomsman' };
        const createdRecord = { id: '123', ...payload };
        mockService.create.mockResolvedValue(createdRecord);

        const req = new NextRequest('http://localhost/api/admin/wedding-party', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        const res = await POST(req, { params: Promise.resolve({ entity: 'wedding-party' }) });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toEqual({ success: true, data: createdRecord });
        expect(mockService.create).toHaveBeenCalledWith(payload);
      });

      test('handles custom validation errors from the service with a 400 status', async () => {
        mockService.create.mockRejectedValue(new Error('Validation Error: Invalid date format'));

        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'POST',
          body: JSON.stringify({ invalidField: true }),
        });

        const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid date format');
      });

      test('re-throws other unexpected errors', async () => {
        const unexpectedError = new Error('Database down');
        mockService.create.mockRejectedValue(unexpectedError);

        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        const res = await POST(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe('Database down');
      });
    });

    describe('PUT Handler (Reordering)', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown-entity', {
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: ['1'] }),
        });

        const res = await PUT(req, { params: Promise.resolve({ entity: 'unknown-entity' }) });
        expect(res.status).toBe(404);
      });

      test('reorders items successfully and returns 200', async () => {
        mockService.reorder.mockResolvedValue(undefined);

        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: ['item3', 'item1', 'item2'] }),
        });

        const res = await PUT(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true });
        expect(mockService.reorder).toHaveBeenCalledWith(['item3', 'item1', 'item2']);
      });

      test('returns 400 for invalid action in PUT payload', async () => {
        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'PUT',
          body: JSON.stringify({ action: 'invalid-action' }),
        });

        const res = await PUT(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid action');
      });

      test('returns 400 for invalid reorder payload structure', async () => {
        const req = new NextRequest('http://localhost/api/admin/attractions', {
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: 'not-an-array' }),
        });

        const res = await PUT(req, { params: Promise.resolve({ entity: 'attractions' }) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid reorder payload');
      });
    });
  });

  describe('Item-level Routes: GET, PUT, DELETE', () => {

    describe('Authorization & Middleware checks', () => {
      test('GET fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions/123');
        
        const res = await GET_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(401);
      });

      test('PUT fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions/123', {
          method: 'PUT',
          body: JSON.stringify({ name: 'Updated' }),
        });
        
        const res = await PUT_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(401);
      });

      test('DELETE fails if unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new NextRequest('http://localhost/api/admin/attractions/123', { method: 'DELETE' });
        
        const res = await DELETE_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(401);
      });
    });

    describe('GET Handler', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown/123');

        const res = await GET_ITEM(req, { params: Promise.resolve({ entity: 'unknown', id: '123' }) });
        expect(res.status).toBe(404);
      });

      test('returns record if found', async () => {
        const mockRecord = { id: '123', name: 'Eiffel Tower' };
        mockService.findById.mockResolvedValue(mockRecord);

        const req = new NextRequest('http://localhost/api/admin/attractions/123');
        const res = await GET_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, data: mockRecord });
        expect(mockService.findById).toHaveBeenCalledWith('123');
      });

      test('returns 404 if record is not found', async () => {
        mockService.findById.mockResolvedValue(null);

        const req = new NextRequest('http://localhost/api/admin/attractions/123');
        const res = await GET_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Not found');
      });
    });

    describe('PUT Handler', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown/123', {
          method: 'PUT',
          body: JSON.stringify({}),
        });

        const res = await PUT_ITEM(req, { params: Promise.resolve({ entity: 'unknown', id: '123' }) });
        expect(res.status).toBe(404);
      });

      test('updates record successfully and returns 200', async () => {
        const updatePayload = { name: 'Golden Gate Bridge' };
        const updatedRecord = { id: '123', name: 'Golden Gate Bridge', description: 'Iconic' };
        mockService.update.mockResolvedValue(updatedRecord);

        const req = new NextRequest('http://localhost/api/admin/attractions/123', {
          method: 'PUT',
          body: JSON.stringify(updatePayload),
        });

        const res = await PUT_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, data: updatedRecord });
        expect(mockService.update).toHaveBeenCalledWith('123', updatePayload);
      });

      test('handles validation error from the service with 400', async () => {
        mockService.update.mockRejectedValue(new Error('Validation Error: Invalid coordinates'));

        const req = new NextRequest('http://localhost/api/admin/attractions/123', {
          method: 'PUT',
          body: JSON.stringify({ latitude: 'invalid' }),
        });

        const res = await PUT_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid coordinates');
      });

      test('re-throws other unexpected errors on PUT', async () => {
        mockService.update.mockRejectedValue(new Error('Internal Database Error'));

        const req = new NextRequest('http://localhost/api/admin/attractions/123', {
          method: 'PUT',
          body: JSON.stringify({}),
        });

        const res = await PUT_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe('Internal Database Error');
      });
    });

    describe('DELETE Handler', () => {
      test('returns 404 if entity service is not found', async () => {
        mockGetEntityService.mockResolvedValue(null);
        const req = new NextRequest('http://localhost/api/admin/unknown/123', { method: 'DELETE' });

        const res = await DELETE_ITEM(req, { params: Promise.resolve({ entity: 'unknown', id: '123' }) });
        expect(res.status).toBe(404);
      });

      test('deletes record successfully and returns deleted item', async () => {
        const deletedRecord = { id: '123', name: 'Old Attraction' };
        mockService.delete.mockResolvedValue(deletedRecord);

        const req = new NextRequest('http://localhost/api/admin/attractions/123', { method: 'DELETE' });
        const res = await DELETE_ITEM(req, { params: Promise.resolve({ entity: 'attractions', id: '123' }) });
        
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, data: deletedRecord });
        expect(mockService.delete).toHaveBeenCalledWith('123');
      });
    });
  });
});
