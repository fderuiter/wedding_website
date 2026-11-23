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

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(() => Promise.resolve(actual.APP_DEFAULTS)),
  };
});

import { registryAddItemPOST as addItem } from '@/features/registry';
import { registryContributePOST as contribute } from '@/features/registry';
import { registryGetItemsGET as getItems } from '@/features/registry';
import { registryItemByIdGET as getItemByIdRoute, registryItemByIdPUT as updateItemRoute, registryItemByIdDELETE as deleteItemRoute } from '@/features/registry';
import { registryService } from '@/features/registry';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig, APP_DEFAULTS } from '@/lib/config';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import type { NextRequest } from 'next/server';

const mockCreateItem = registryService.createItem as jest.Mock;
const mockContributeToItem = registryService.contributeToItem as jest.Mock;
const mockGetAllItems = registryService.getAllItems as jest.Mock;
const mockGetItemById = registryService.getItemById as jest.Mock;
const mockUpdateItem = registryService.updateItem as jest.Mock;
const mockDeleteItem = registryService.deleteItem as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

describe('Registry API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/registry/items', () => {
    const validItem = {
      name: 'Toaster',
      price: 50,
      quantity: 1,
      category: 'Kitchen',
    };

    it('returns 401 when unauthorized', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req as unknown as NextRequest);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('creates item when authorized and input is valid', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const created = { id: '1', ...validItem };
      mockCreateItem.mockResolvedValue(created);
      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req as unknown as NextRequest);
      expect(res.status).toBe(201);
      expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining(validItem));
      const json = await res.json();
      expect(json.data).toEqual(expect.objectContaining({ item: expect.objectContaining(validItem) }));
    });

    it('returns 400 for invalid input', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        body: JSON.stringify({ price: -1 }),
      });
      const res = await addItem(req as unknown as NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it('returns 500 when service fails', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      mockCreateItem.mockRejectedValue(new Error('DB down'));
      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        body: JSON.stringify(validItem),
      });
      const res = await addItem(req as unknown as NextRequest);
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
      const res = await contribute(req as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockContributeToItem).toHaveBeenCalledWith(validContribution.itemId, expect.objectContaining({
        name: validContribution.name,
        amount: validContribution.amount,
      }));
    });

    it('processes a valid contribution with personal message', async () => {
      mockContributeToItem.mockResolvedValue({ id: '1', amountContributed: 25 });
      const contributionWithMessage = {
        ...validContribution,
        message: 'Wishing you a lifetime of love and happiness!',
      };
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify(contributionWithMessage),
      });
      const res = await contribute(req as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockContributeToItem).toHaveBeenCalledWith(validContribution.itemId, expect.objectContaining({
        name: validContribution.name,
        amount: validContribution.amount,
        message: 'Wishing you a lifetime of love and happiness!',
      }));
    });

    it('rejects contribution when personal message exceeds 1000 characters', async () => {
      const longMessage = 'a'.repeat(1001);
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({ ...validContribution, message: longMessage }),
      });
      const res = await contribute(req as unknown as NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Personal note must be under 1000 characters.');
    });

    it('returns 400 for invalid data', async () => {
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({ name: '', amount: -5 }),
      });
      const res = await contribute(req as unknown as NextRequest);
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
      const res = await contribute(req as unknown as NextRequest);
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
      const res = await contribute(req as unknown as NextRequest);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ success: false, error: 'DB error' });
    });
  });

  describe('GET /api/registry/items', () => {
    it('returns paginated items without contributors for public guest requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const paginatedData = { items: [{ id: '1', name: 'Item', contributors: [] }], total: 1, page: 1, limit: 20, totalPages: 1 };
      mockGetAllItems.mockResolvedValue(paginatedData);
      const res = await getItems();
      expect(res.status).toBe(200);
      expect(mockGetAllItems).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        category: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        includeContributors: false,
      });
      const json = await res.json();
      expect(json.data).toEqual(paginatedData);
    });

    it('requests contributors and validates query parameters for administrative requests', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const paginatedData = {
        items: [{ id: '1', name: 'Item', contributors: [{ name: 'John', amount: 50, date: '2026-01-01' }] }],
        total: 1,
        page: 2,
        limit: 10,
        totalPages: 1,
      };
      mockGetAllItems.mockResolvedValue(paginatedData);
      const req = new Request('http://localhost/api/registry/items?page=2&limit=10&category=Kitchen&minPrice=10&maxPrice=100');
      const res = await getItems(req as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockGetAllItems).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        category: 'Kitchen',
        minPrice: 10,
        maxPrice: 100,
        includeContributors: true,
      });
      const json = await res.json();
      expect(json.data).toEqual(paginatedData);
    });

    it('accepts bounded catalog limit=500 while excluding contributors for public guest requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const paginatedData = { items: [{ id: '35', name: 'Gift 35', contributors: [] }], total: 35, page: 1, limit: 500, totalPages: 1 };
      mockGetAllItems.mockResolvedValue(paginatedData);
      const req = new Request('http://localhost/api/registry/items?page=1&limit=500');
      const res = await getItems(req as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockGetAllItems).toHaveBeenCalledWith({
        page: 1,
        limit: 500,
        category: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        sortBy: undefined,
        includeContributors: false,
      });
      const json = await res.json();
      expect(json.data).toEqual(paginatedData);
    });

    it('masks purchaserName as Anonymous for non-admin callers while preserving empty values', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const paginatedData = {
        items: [
          { id: '1', name: 'Claimed Gift', purchased: true, purchaserName: 'Marker Buyer Identity', contributors: [] },
          { id: '2', name: 'Null Buyer Gift', purchased: false, purchaserName: null, contributors: [] },
          { id: '3', name: 'Empty Buyer Gift', purchased: false, purchaserName: '', contributors: [] },
          { id: '4', name: 'Undefined Buyer Gift', purchased: false, contributors: [] },
        ],
        total: 4,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockGetAllItems.mockResolvedValue(paginatedData);
      const res = await getItems(new Request('http://localhost/api/registry/items') as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockGetAllItems).toHaveBeenCalledWith(expect.objectContaining({ includeContributors: false }));
      const json = await res.json();
      expect(json.data).toEqual({
        items: [
          { id: '1', name: 'Claimed Gift', purchased: true, purchaserName: 'Anonymous', contributors: [] },
          { id: '2', name: 'Null Buyer Gift', purchased: false, purchaserName: null, contributors: [] },
          { id: '3', name: 'Empty Buyer Gift', purchased: false, purchaserName: '', contributors: [] },
          { id: '4', name: 'Undefined Buyer Gift', purchased: false, contributors: [] },
        ],
        total: 4,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('preserves real purchaserName for admin callers on catalog read', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const paginatedData = {
        items: [
          {
            id: '1',
            name: 'Claimed Gift',
            purchased: true,
            purchaserName: 'Marker Buyer Identity',
            contributors: [
              { name: 'Marker Buyer Identity', email: 'buyer@example.com', amount: 120, date: '2026-01-01' },
            ],
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockGetAllItems.mockResolvedValue(paginatedData);
      const res = await getItems(new Request('http://localhost/api/registry/items') as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(mockGetAllItems).toHaveBeenCalledWith(expect.objectContaining({ includeContributors: true }));
      const json = await res.json();
      expect(json.data.items[0].purchaserName).toBe('Marker Buyer Identity');
      expect(json.data.items[0].contributors).toEqual([
        { name: 'Marker Buyer Identity', amount: 120, date: '2026-01-01' },
      ]);
    });

    it('returns 400 when query parameters fail validation', async () => {
      const req = new Request('http://localhost/api/registry/items?limit=501');
      const res = await getItems(req as unknown as NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid query parameters');
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
      it('returns item when found for guest request', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const item = { id: itemId, name: 'Lamp', contributors: [] };
        mockGetItemById.mockResolvedValue(item);
        const req = new Request(baseUrl);
        const res = await getItemByIdRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        expect(mockGetItemById).toHaveBeenCalledWith(itemId, { includeContributors: false });
        const json = await res.json();
        expect(json.data).toEqual(item);
      });

      it('returns item with contributors when found for admin request', async () => {
        mockIsAdminRequest.mockResolvedValue(true);
        const item = { id: itemId, name: 'Lamp', contributors: [{ name: 'Jane', amount: 100, date: '2026-01-01' }] };
        mockGetItemById.mockResolvedValue(item);
        const req = new Request(baseUrl);
        const res = await getItemByIdRoute(req as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        expect(mockGetItemById).toHaveBeenCalledWith(itemId, { includeContributors: true });
        const json = await res.json();
        expect(json.data).toEqual(item);
      });

      it('masks purchaserName as Anonymous for non-admin single-item requests while preserving empty values', async () => {
        mockIsAdminRequest.mockResolvedValue(false);
        const claimedItem = {
          id: itemId,
          name: 'Lamp',
          purchased: true,
          purchaserName: 'Marker Buyer Identity',
          contributors: [],
        };
        mockGetItemById.mockResolvedValueOnce(claimedItem);
        const claimedRes = await getItemByIdRoute(new Request(baseUrl) as unknown as NextRequest, { params: mockParams });
        expect(claimedRes.status).toBe(200);
        expect(mockGetItemById).toHaveBeenCalledWith(itemId, { includeContributors: false });
        const claimedJson = await claimedRes.json();
        expect(claimedJson.data).toEqual({
          ...claimedItem,
          purchaserName: 'Anonymous',
        });

        const unclaimedNullItem = {
          id: itemId,
          name: 'Lamp',
          purchased: false,
          purchaserName: null,
          contributors: [],
        };
        mockGetItemById.mockResolvedValueOnce(unclaimedNullItem);
        const nullRes = await getItemByIdRoute(new Request(baseUrl) as unknown as NextRequest, { params: mockParams });
        expect((await nullRes.json()).data.purchaserName).toBeNull();

        const unclaimedEmptyItem = {
          id: itemId,
          name: 'Lamp',
          purchased: false,
          purchaserName: '',
          contributors: [],
        };
        mockGetItemById.mockResolvedValueOnce(unclaimedEmptyItem);
        const emptyRes = await getItemByIdRoute(new Request(baseUrl) as unknown as NextRequest, { params: mockParams });
        expect((await emptyRes.json()).data.purchaserName).toBe('');
      });

      it('preserves real purchaserName for admin single-item requests', async () => {
        mockIsAdminRequest.mockResolvedValue(true);
        const claimedItem = {
          id: itemId,
          name: 'Lamp',
          purchased: true,
          purchaserName: 'Marker Buyer Identity',
          contributors: [
            { name: 'Marker Buyer Identity', email: 'buyer@example.com', amount: 100, date: '2026-01-01' },
          ],
        };
        mockGetItemById.mockResolvedValue(claimedItem);
        const res = await getItemByIdRoute(new Request(baseUrl) as unknown as NextRequest, { params: mockParams });
        expect(res.status).toBe(200);
        expect(mockGetItemById).toHaveBeenCalledWith(itemId, { includeContributors: true });
        const json = await res.json();
        expect(json.data).toEqual({
          id: itemId,
          name: 'Lamp',
          purchased: true,
          purchaserName: 'Marker Buyer Identity',
          contributors: [
            { name: 'Marker Buyer Identity', amount: 100, date: '2026-01-01' },
          ],
        });
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
        console.log('JSON returned:', json);
        expect(json.error).toBe('Validation Error');
        expect(JSON.stringify(json.details)).toContain('Price must be a positive number.');
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

    it('returns 404 across GET, PUT, and DELETE when registry module is disabled', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const disabledConfig = {
        ...APP_DEFAULTS,
        modules: { ...DEFAULT_MODULE_CONFIG, registry: false, groupGifting: false },
      } as any;

      mockGetAppConfig.mockResolvedValueOnce(disabledConfig);
      const getRes = await getItemByIdRoute(new Request(baseUrl) as unknown as NextRequest, { params: mockParams });
      expect(getRes.status).toBe(404);

      mockGetAppConfig.mockResolvedValueOnce(disabledConfig);
      const putRes = await updateItemRoute(
        new Request(baseUrl, {
          method: 'PUT',
          body: JSON.stringify({ name: 'Lamp', price: 20, quantity: 1 }),
        }) as unknown as NextRequest,
        { params: mockParams }
      );
      expect(putRes.status).toBe(404);

      mockGetAppConfig.mockResolvedValueOnce(disabledConfig);
      const deleteRes = await deleteItemRoute(
        new Request(baseUrl, { method: 'DELETE' }) as unknown as NextRequest,
        { params: mockParams }
      );
      expect(deleteRes.status).toBe(404);
    });
  });
});
