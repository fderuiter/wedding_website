/** @jest-environment node */

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import type { NextRequest } from 'next/server';
import { POST as unclaimPOST } from '@/app/api/admin/registry/items/[id]/unclaim/route';
import { PATCH as contributorPATCH, DELETE as contributorDELETE } from '../[id]/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { registryService } from '@/features/registry';
import { ApiError } from '@/utils/ApiError';

const mockIsAdminRequest = isAdminRequest as jest.Mock;
const mockUnclaimItem: jest.SpyInstance = jest.spyOn(registryService, 'unclaimItem');
const mockUpdateContributor: jest.SpyInstance = jest.spyOn(registryService, 'updateContributor');
const mockDeleteContributor: jest.SpyInstance = jest.spyOn(registryService, 'deleteContributor');

describe('Admin Registry Claim & Contributor Reconciliation API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockUnclaimItem.mockReset();
    mockUpdateContributor.mockReset();
    mockDeleteContributor.mockReset();
  });

  afterAll(() => {
    mockUnclaimItem.mockRestore();
    mockUpdateContributor.mockRestore();
    mockDeleteContributor.mockRestore();
  });

  describe('POST /api/admin/registry/items/[id]/unclaim', () => {
    it('returns 401 when caller is not an admin', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new Request('http://localhost/api/admin/registry/items/item-1/unclaim', {
        method: 'POST',
      });
      const res = await unclaimPOST(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'item-1' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 409 when service requires explicit confirmation for verified Stripe payment', async () => {
      mockUnclaimItem.mockRejectedValue(
        new ApiError(
          409,
          'Explicit admin confirmation is required before releasing a claim with a verified Stripe payment.'
        )
      );
      const req = new Request('http://localhost/api/admin/registry/items/item-1/unclaim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await unclaimPOST(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'item-1' }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain('verified Stripe payment');
    });

    it('unclaims item and returns sanitized item payload when confirmed', async () => {
      mockUnclaimItem.mockResolvedValue({
        id: 'item-1',
        name: 'Stand Mixer',
        price: 350,
        quantity: 1,
        category: 'Kitchen',
        itemType: 'PHYSICAL',
        isGroupGift: false,
        purchased: false,
        amountContributed: 0,
        purchaserName: null,
        isMostWanted: false,
        displayOrder: 0,
        isSample: false,
        contributors: [],
      });

      const req = new Request('http://localhost/api/admin/registry/items/item-1/unclaim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmVerifiedPayment: true }),
      });
      const res = await unclaimPOST(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'item-1' }),
      });
      expect(res.status).toBe(200);
      expect(mockUnclaimItem).toHaveBeenCalledWith(
        'item-1',
        { confirmVerifiedPayment: true },
        'Admin'
      );
      const json = await res.json();
      expect(json.data.item.purchased).toBe(false);
    });
  });

  describe('PATCH & DELETE /api/admin/contributors/[id]', () => {
    it('returns 400 when PATCH payload has no editable fields', async () => {
      const req = new Request('http://localhost/api/admin/contributors/c-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await contributorPATCH(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(400);
    });

    it('updates contributor and returns recomputed item on PATCH', async () => {
      mockUpdateContributor.mockResolvedValue({
        contributor: { id: 'c-1', name: 'Updated Guest', amount: 75, status: 'CONFIRMED' },
        item: {
          id: 'item-1',
          name: 'Honeymoon Fund',
          price: 200,
          quantity: 1,
          category: 'Cash Fund',
          itemType: 'CASH_FUND',
          isGroupGift: true,
          purchased: false,
          amountContributed: 75,
          isMostWanted: false,
          displayOrder: 0,
          isSample: false,
          contributors: [],
        },
      });

      const req = new Request('http://localhost/api/admin/contributors/c-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Guest', amount: 75, confirmVerifiedPayment: true }),
      });
      const res = await contributorPATCH(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateContributor).toHaveBeenCalledWith(
        'c-1',
        { name: 'Updated Guest', amount: 75, confirmVerifiedPayment: true },
        'Admin'
      );
      const json = await res.json();
      expect(json.data.contributor.name).toBe('Updated Guest');
      expect(json.data.item.amountContributed).toBe(75);
    });

    it('deletes contributor with confirmVerifiedPayment query param and returns recomputed item', async () => {
      mockDeleteContributor.mockResolvedValue({
        deletedId: 'c-1',
        item: null,
      });

      const req = new Request(
        'http://localhost/api/admin/contributors/c-1?confirmVerifiedPayment=true',
        { method: 'DELETE' }
      );
      const res = await contributorDELETE(req as unknown as NextRequest, {
        params: Promise.resolve({ id: 'c-1' }),
      });
      expect(res.status).toBe(200);
      expect(mockDeleteContributor).toHaveBeenCalledWith(
        'c-1',
        { confirmVerifiedPayment: true },
        'Admin'
      );
      const json = await res.json();
      expect(json.data.deletedId).toBe('c-1');
    });
  });
});
