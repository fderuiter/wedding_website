/** @jest-environment node */

jest.mock('../../../services/registryService', () => ({
  RegistryService: {
    createItem: jest.fn(),
    contributeToItem: jest.fn(),
    getAllItems: jest.fn(),
  },
}));

jest.mock('../../../utils/adminAuth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import { POST as addItem } from '../registry/add-item/route';
import { POST as contribute } from '../registry/contribute/route';
import { GET as getItems } from '../registry/items/route';
import { RegistryService } from '../../../services/registryService';
import { isAdminRequest } from '../../../utils/adminAuth.server';

const mockCreateItem = RegistryService.createItem as jest.Mock;
const mockContributeToItem = RegistryService.contributeToItem as jest.Mock;
const mockGetAllItems = RegistryService.getAllItems as jest.Mock;
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
      expect(json.item).toEqual(expect.objectContaining(validItem));
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
  });

  describe('POST /api/registry/contribute', () => {
    const validContribution = {
      itemId: '1',
      purchaserName: 'John',
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
        name: validContribution.purchaserName,
        amount: validContribution.amount,
      });
    });

    it('returns 400 for invalid data', async () => {
      const req = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({ purchaserName: '', amount: -5 }),
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
      expect(json).toEqual({ error: 'DB error' });
    });
  });

  describe('GET /api/registry/items', () => {
    it('returns items on success', async () => {
      const items = [{ id: '1', name: 'Item' }];
      mockGetAllItems.mockResolvedValue(items);
      const res = await getItems();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual(items);
    });

    it('returns 500 on service failure', async () => {
      mockGetAllItems.mockRejectedValue(new Error('db error'));
      const res = await getItems();
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to load registry items');
    });
  });
});

