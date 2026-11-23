/** @jest-environment node */

jest.mock('@/features/registry/service', () => ({
  registryService: {
    createBatchItems: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import { POST as batchAdd } from '../batch-add';
import { registryService } from '../../service';
import { isAdminRequest } from '@/core/auth/auth.server';

const mockCreateBatchItems = registryService.createBatchItems as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('POST /api/registry/items/batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validItems = [
    {
      name: 'Coffee Maker',
      price: 89.99,
      quantity: 1,
      category: 'Kitchen',
      description: 'Drip coffee maker',
      vendorUrl: 'https://example.com/coffee',
    },
    {
      name: 'Toaster',
      price: 49.99,
      quantity: 1,
      category: 'Kitchen',
    },
  ];

  it('returns 401 when unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new Request('http://localhost/api/registry/items/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: validItems }),
    });

    const res = await batchAdd(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when items array is empty', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const req = new Request('http://localhost/api/registry/items/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });

    const res = await batchAdd(req as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when an item in the batch is invalid', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const req = new Request('http://localhost/api/registry/items/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { name: 'Valid Item', price: 10, category: 'Home' },
          { name: '', price: 20, category: 'Home' }, // Missing name
        ],
      }),
    });

    const res = await batchAdd(req as any);
    expect(res.status).toBe(400);
  });

  it('successfully creates batch items and returns 201 Created', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockCreateBatchItems.mockResolvedValue([
      { id: '1', ...validItems[0] },
      { id: '2', ...validItems[1] },
    ]);

    const req = new Request('http://localhost/api/registry/items/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: validItems }),
    });

    const res = await batchAdd(req as any);
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.count).toBe(2);
    expect(json.items).toHaveLength(2);
    expect(mockCreateBatchItems).toHaveBeenCalledTimes(1);
  });
});
