/** @jest-environment node */

jest.mock('@/features/registry/service', () => ({
  registryService: {
    createItem: jest.fn(),
    contributeToItem: jest.fn(),
    getAllItems: jest.fn(),
    getItemById: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
  },
}));

jest.mock('@/features/admin/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import { POST as addItem } from '@/features/registry/api/add-item';
import { POST as contribute } from '@/features/registry/api/contribute';
import { GET as getItems } from '@/features/registry/api/get-items';
import { GET as getItemByIdRoute, PUT as updateItemRoute, DELETE as deleteItemRoute } from '@/features/registry/api/item-by-id';
import { registryService } from '@/features/registry/service';
import { isAdminRequest } from '@/features/admin/auth.server';
import type { NextRequest } from 'next/server';

const mockCreateItem = registryService.createItem as jest.Mock;
const mockContributeToItem = registryService.contributeToItem as jest.Mock;
const mockGetAllItems = registryService.getAllItems as jest.Mock;
const mockGetItemById = registryService.getItemById as jest.Mock;
const mockUpdateItem = registryService.updateItem as jest.Mock;
const mockDeleteItem = registryService.deleteItem as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('Registry API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/registry/add-item', () => {
    const validItem = {
      name: 'Toaster',
      price: 50,
      quantity: 1,
      category: 'Kitchen',
    };

    it('returns 401 when unauthorized', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new Request('http://localhost/api/registry/add-item', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('creates item when authorized and input is valid', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const created = { id: '1', ...validItem };
      mockCreateItem.mockResolvedValue(created);
      const req = new Request('http://localhost/api/registry/add-item', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req);
      expect(res.status).toBe(201);
      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining(validItem));
      const json = await res.json();
      expect(json.data).toEqual(expect.objectContaining({ item: expect.objectContaining(validItem) }));
    });

    it('returns 400 for invalid input', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const req = new Request('http://localhost/api/registry/add-item', {
        method: 'POST',
        body: JSON.stringify({ price: -1 }),
      });
      const res = await addItem(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('returns 500 when service fails', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      mockCreateItem.mockRejectedValue(new Error('DB down'));
      const req = new Request('http://localhost/api/registry/add-item', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('DB down');
    });
  });

  describe('POST /api/registry/contribute', () => {
    const validContribution = {
      itemId: '1',
      name: 'John',
      amount: 25,
    };

    it('processes a valid contribution', async () => {
      mockContributeToItem.mockResolvedValue({ id: '1', amountContributed: 25 });
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify(validContribution),
      });
      const res = await contribute(req);
      expect(res.status).toBe(200);
      expect(mockContributeToItem).toHaveBeenCalledWith(validContribution.itemId, {
        name: validContribution.name,
        amount: validContribution.amount,
      });
    });

    it('returns 400 for invalid data', async () => {
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({ name: '', amount: -5 }),
      });
      const res = await contribute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('returns 500 when item not found', async () => {
      mockContributeToItem.mockRejectedValue(new Error('Item not found'));
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify(validContribution),
      });
      const res = await contribute(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Item not found');
    });

    it('returns 500 for service errors', async () => {
      mockContributeToItem.mockRejectedValue(new Error('DB error'));
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify(validContribution),
      });
      const res = await contribute(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ success: false, error: 'DB error' });
    });
  });

  describe('GET /api/registry/items', () => {
    it('returns items on success', async () => {
      const items = [{ id: '1', name: 'Item' }];
      mockGetAllItems.mockResolvedValue(items);
      const res = await getItems();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual(items);
    });

    it('returns 500 on service failure', async () => {
      mockGetAllItems.mockRejectedValue(new Error('db error'));
      const res = await getItems();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('db error');
    });
  });

  describe('/api/registry/items/[id]', () => {
    const itemId = '1';
    const baseUrl = `http://localhost/api/registry/items/${itemId}`;
    const mockParams = Promise.resolve({ id: itemId });

    describe('GET', () => {
      it('returns item when found', async () => {
        const item = { id: itemId, name: 'Lamp' };
        mockGetItemById.mockResolvedValue(item);
        const req = new Request(baseUrl);
        const res = await getItemByIdRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toEqual(item);
      });

      it('returns 404 when item not found', async () => {
        mockGetItemById.mockResolvedValue(null);
        const req = new Request(baseUrl);
        const res = await getItemByIdRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json).toEqual({ success: false, error: 'Item not found' });
      });
    });

    describe('PUT', () => {
      it('returns 401 when unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new Request(baseUrl, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Lamp', price: 10, quantity: 1 }),
        });
        const res = await updateItemRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(401);
      });

      it('returns 400 when missing fields', async () => {
        mockIsAdminRequest.mockResolvedValue(true);
        const req = new Request(baseUrl, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Lamp' }),
        });
        const res = await updateItemRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe('Price must be a positive number.');
      });

      it('updates item when authorized and data valid', async () => {
        mockIsAdminRequest.mockResolvedValue(true);
        const updated = { id: itemId, name: 'Lamp', price: 20, quantity: 2, category: 'Home' };
        mockUpdateItem.mockResolvedValue(updated);
        const req = new Request(baseUrl, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Lamp', price: 20, quantity: 2, category: 'Home' }),
        });
        const res = await updateItemRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toEqual({ message: 'Item updated successfully', item: updated });
      });
    });

    describe('DELETE', () => {
      it('returns 401 when unauthorized', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const req = new Request(baseUrl, { method: 'DELETE' });
        const res = await deleteItemRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(401);
      });

      it('deletes item when authorized', async () => {
        mockIsAdminRequest.mockResolvedValue(true);
        mockDeleteItem.mockResolvedValue(undefined);
        const req = new Request(baseUrl, { method: 'DELETE' });
        const res = await deleteItemRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data).toEqual({ message: 'Item deleted successfully' });
      });
    });
  });
});
