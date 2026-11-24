/** @jest-environment node */

import { RegistryItemAdminService } from '../admin.service';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';

const mockTxRegistryItemCreate = jest.fn();
const mockTxRegistryItemUpdate = jest.fn();
const mockTxRegistryItemUpdateManyAndReturn = jest.fn();
const mockTxRegistryItemFindMany = jest.fn();
const mockTxMediaCreate = jest.fn();
const mockTxMediaUpdate = jest.fn();

jest.mock('@/lib/prisma', () => {
  const mockTx = {
    registryItem: {
      create: (...args: any[]) => mockTxRegistryItemCreate(...args),
      update: (...args: any[]) => mockTxRegistryItemUpdate(...args),
      updateManyAndReturn: (...args: any[]) => mockTxRegistryItemUpdateManyAndReturn(...args),
      findMany: (...args: any[]) => mockTxRegistryItemFindMany(...args),
    },
    media: {
      create: (...args: any[]) => mockTxMediaCreate(...args),
      update: (...args: any[]) => mockTxMediaUpdate(...args),
    },
  };

  return {
    prisma: {
      registryItem: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      media: {
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockTx)),
    },
  };
});

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
  createBatchAuditSnapshots: jest.fn(),
}));

describe('RegistryItemAdminService Input Validation', () => {
  let adminService: RegistryItemAdminService;

  beforeEach(() => {
    adminService = new RegistryItemAdminService();
    jest.clearAllMocks();
  });

  it('validates valid registry item input payloads', async () => {
    const validData = {
      name: 'Coffee Maker',
      price: 99.99,
      category: 'Kitchen',
    };
    await expect(adminService['validate'](validData)).resolves.not.toThrow();
  });

  it('rejects invalid registry item input payloads and throws clear validation error', async () => {
    const invalidData = {
      name: '',
      price: -10,
    };
    await expect(adminService['validate'](invalidData)).rejects.toThrow(/Validation Error/);
  });
});

describe('RegistryItemAdminService Reorder & Partial Updates', () => {
  let adminService: RegistryItemAdminService;

  beforeEach(() => {
    adminService = new RegistryItemAdminService();
    jest.clearAllMocks();
  });

  describe('reorder', () => {
    it('updates displayOrder sequentially in a transaction and records batch audit snapshots', async () => {
      const orderedIds = ['gift-3', 'gift-1', 'gift-2'];
      mockTxRegistryItemFindMany.mockResolvedValue([
        { id: 'gift-1' },
        { id: 'gift-2' },
        { id: 'gift-3' },
      ]);
      mockTxRegistryItemUpdate.mockImplementation((args: any) =>
        Promise.resolve({
          id: args.where.id,
          displayOrder: args.data.displayOrder,
          imageId: `media-${args.where.id}`,
        })
      );

      await adminService.reorder(orderedIds, 'Coordinator');

      expect(mockTxRegistryItemFindMany).toHaveBeenCalledWith({
        where: { id: { in: orderedIds } },
        select: { id: true },
      });
      expect(mockTxRegistryItemUpdate).toHaveBeenCalledTimes(3);
      expect(mockTxRegistryItemUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: 'gift-3' },
        data: { displayOrder: 0 },
      });
      expect(mockTxRegistryItemUpdate).toHaveBeenNthCalledWith(2, {
        where: { id: 'gift-1' },
        data: { displayOrder: 1 },
      });
      expect(mockTxRegistryItemUpdate).toHaveBeenNthCalledWith(3, {
        where: { id: 'gift-2' },
        data: { displayOrder: 2 },
      });
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'RegistryItem',
        [
          { id: 'gift-3', displayOrder: 0, imageId: 'media-gift-3' },
          { id: 'gift-1', displayOrder: 1, imageId: 'media-gift-1' },
          { id: 'gift-2', displayOrder: 2, imageId: 'media-gift-2' },
        ],
        'Coordinator',
        expect.any(Object)
      );
    });

    it('throws an error when an invalid registry item ID is supplied and performs no updates', async () => {
      mockTxRegistryItemFindMany.mockResolvedValue([{ id: 'gift-1' }]);

      await expect(adminService.reorder(['gift-1', 'unknown-gift'], 'Admin')).rejects.toThrow(
        'Invalid registry item ID(s): unknown-gift'
      );
      expect(mockTxRegistryItemUpdate).not.toHaveBeenCalled();
      expect(createBatchAuditSnapshots).not.toHaveBeenCalled();
    });

    it('throws an error when orderedIds is empty', async () => {
      await expect(adminService.reorder([], 'Admin')).rejects.toThrow(
        'Ordered IDs array cannot be empty'
      );
      expect(mockTxRegistryItemFindMany).not.toHaveBeenCalled();
    });

    it('throws an error when orderedIds contains duplicate IDs', async () => {
      await expect(adminService.reorder(['gift-1', 'gift-1'], 'Admin')).rejects.toThrow(
        'Duplicate registry item IDs are not allowed'
      );
      expect(mockTxRegistryItemFindMany).not.toHaveBeenCalled();
    });

    it('uses one parameterized $executeRaw UPDATE FROM VALUES query on displayOrder and captures full snapshots when $executeRaw exists', async () => {
      const mockExecuteRaw = jest.fn().mockResolvedValue(2);
      const mockFindMany = jest.fn().mockResolvedValue([
        {
          id: 'gift-1',
          itemType: 'PHYSICAL',
          name: 'Stand Mixer',
          description: '5-quart mixer',
          category: 'Kitchen',
          price: 399,
          imageId: 'media-gift-1',
          quantity: 1,
          isGroupGift: false,
          isMostWanted: true,
          displayOrder: 1,
          purchased: false,
          amountContributed: 0,
          isSample: false,
        },
        {
          id: 'gift-2',
          itemType: 'CASH_FUND',
          name: 'Honeymoon Fund',
          description: 'Flights',
          category: 'Travel',
          price: 1000,
          imageId: 'media-gift-2',
          quantity: 1,
          isGroupGift: true,
          isMostWanted: false,
          displayOrder: 0,
          purchased: false,
          amountContributed: 250,
          isSample: false,
        },
      ]);
      const mockUpdate = jest.fn();
      const rawTx: any = {
        registryItem: {
          findMany: mockFindMany,
          update: mockUpdate,
        },
        $executeRaw: mockExecuteRaw,
      };
      const rawClient = {
        $transaction: jest.fn((cb: any) => cb(rawTx)),
      };
      const rawAdminService = new RegistryItemAdminService(rawClient);

      await rawAdminService.reorder(['gift-2', 'gift-1'], 'Coordinator');

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['gift-2', 'gift-1'] } },
      });
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();

      const sqlArg = mockExecuteRaw.mock.calls[0][0];
      const normalizedSql = sqlArg.strings.join('?').replace(/\s+/g, ' ').trim();
      expect(normalizedSql).toContain('UPDATE "public"."RegistryItem" AS t');
      expect(normalizedSql).toContain('SET "displayOrder" = v."displayOrder", "updatedAt" = NOW()');
      expect(sqlArg.values).toEqual(['gift-2', 0, 'gift-1', 1]);

      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'RegistryItem',
        [
          expect.objectContaining({
            id: 'gift-2',
            name: 'Honeymoon Fund',
            imageId: 'media-gift-2',
            displayOrder: 0,
          }),
          expect.objectContaining({
            id: 'gift-1',
            name: 'Stand Mixer',
            imageId: 'media-gift-1',
            displayOrder: 1,
          }),
        ],
        'Coordinator',
        rawTx
      );
    });
  });

  describe('partial updates and imageId preservation', () => {
    it('preserves existing imageId and skips placeholder media creation when toggling isMostWanted', async () => {
      mockTxRegistryItemUpdate.mockResolvedValue({
        id: 'gift-1',
        name: 'Espresso Machine',
        price: 250,
        category: 'Kitchen',
        imageId: 'existing-media-id',
        isMostWanted: true,
        displayOrder: 0,
      });

      const updated = await adminService.update('gift-1', { isMostWanted: true }, 'Couple');

      expect(mockTxMediaCreate).not.toHaveBeenCalled();
      expect(mockTxMediaUpdate).not.toHaveBeenCalled();
      expect(mockTxRegistryItemUpdate).toHaveBeenCalledWith({
        where: { id: 'gift-1' },
        data: { isMostWanted: true },
      });
      expect(updated.imageId).toBe('existing-media-id');
      expect(createAuditSnapshot).toHaveBeenCalledWith(
        'RegistryItem',
        'gift-1',
        expect.objectContaining({ id: 'gift-1', imageId: 'existing-media-id', isMostWanted: true }),
        'Couple',
        expect.any(Object)
      );
    });

    it('preserves existing imageId during updateBatch without media fields', async () => {
      mockTxRegistryItemUpdateManyAndReturn.mockResolvedValue([
        { id: 'gift-1', imageId: 'media-1', isMostWanted: false },
        { id: 'gift-2', imageId: 'media-2', isMostWanted: false },
      ]);

      const updated = await adminService.updateBatch(['gift-1', 'gift-2'], { isMostWanted: false }, 'Admin');

      expect(mockTxMediaCreate).not.toHaveBeenCalled();
      expect(mockTxRegistryItemUpdateManyAndReturn).toHaveBeenCalledWith({
        where: { id: { in: ['gift-1', 'gift-2'] } },
        data: { isMostWanted: false },
      });
      expect(updated).toHaveLength(2);
      expect(createBatchAuditSnapshots).toHaveBeenCalledWith(
        'RegistryItem',
        updated,
        'Admin',
        expect.any(Object)
      );
    });

    it('still creates a placeholder Media record when creating a new item without media fields', async () => {
      mockTxMediaCreate.mockResolvedValue({
        id: 'placeholder-media-1',
        url: '/images/placeholder.png',
        altText: null,
        isDecorative: true,
      });
      mockTxRegistryItemCreate.mockResolvedValue({
        id: 'gift-new',
        name: 'Stand Mixer',
        price: 399,
        category: 'Kitchen',
        imageId: 'placeholder-media-1',
      });

      const created = await adminService.create(
        { name: 'Stand Mixer', price: 399, category: 'Kitchen' },
        'Admin'
      );

      expect(mockTxMediaCreate).toHaveBeenCalledWith({
        data: {
          url: '/images/placeholder.png',
          altText: null,
          isDecorative: true,
        },
      });
      expect(created.imageId).toBe('placeholder-media-1');
    });

    it('updates associated Media when media fields are explicitly supplied on update', async () => {
      mockTxMediaUpdate.mockResolvedValue({
        id: 'existing-media-id',
        url: '/images/updated.jpg',
        altText: 'Updated photo',
        isDecorative: false,
      });
      mockTxRegistryItemUpdate.mockResolvedValue({
        id: 'gift-1',
        imageId: 'existing-media-id',
      });

      await adminService.update(
        'gift-1',
        {
          imageId: 'existing-media-id',
          imageUrl: '/images/updated.jpg',
          imageAlt: 'Updated photo',
        },
        'Admin'
      );

      expect(mockTxMediaCreate).not.toHaveBeenCalled();
      expect(mockTxMediaUpdate).toHaveBeenCalledWith({
        where: { id: 'existing-media-id' },
        data: {
          url: '/images/updated.jpg',
          altText: 'Updated photo',
        },
      });
    });
  });
});
