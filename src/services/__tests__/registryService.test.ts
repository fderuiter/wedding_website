import type { RegistryItem } from '@/types/registry';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    registryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '@/lib/prisma';
import { RegistryService } from '../registryService';

const mockFindMany = prisma.registryItem.findMany as jest.Mock;
const mockFindUnique = prisma.registryItem.findUnique as jest.Mock;
const mockCreate = prisma.registryItem.create as jest.Mock;
const mockUpdate = prisma.registryItem.update as jest.Mock;
const mockDelete = prisma.registryItem.delete as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

describe('RegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllItems', () => {
    it('returns all registry items', async () => {
      const items = [{ id: '1' } as RegistryItem];
      mockFindMany.mockResolvedValue(items);

      await expect(RegistryService.getAllItems()).resolves.toEqual(items);
      expect(mockFindMany).toHaveBeenCalledWith({ include: { contributors: true } });
    });

    it('throws when database fails', async () => {
      const error = new Error('DB error');
      mockFindMany.mockRejectedValue(error);

      await expect(RegistryService.getAllItems()).rejects.toThrow(error);
    });
  });

  describe('getItemById', () => {
    it('returns a registry item by id', async () => {
      const item = { id: '1' } as RegistryItem;
      mockFindUnique.mockResolvedValue(item);

      await expect(RegistryService.getItemById('1')).resolves.toEqual(item);
      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: { contributors: true },
      });
    });

    it('throws when item lookup fails', async () => {
      const error = new Error('DB error');
      mockFindUnique.mockRejectedValue(error);

      await expect(RegistryService.getItemById('1')).rejects.toThrow(error);
    });
  });

  describe('createItem', () => {
    it('creates a new registry item', async () => {
      const input = {
        title: 'Item',
        price: 100,
        link: '',
        description: '',
        image: '',
        amountContributed: 0,
      } as unknown as Omit<RegistryItem, 'id' | 'contributors'>;
      const created = { id: '1', ...input, contributors: [] } as unknown as RegistryItem;
      mockCreate.mockResolvedValue(created);

      await expect(RegistryService.createItem(input)).resolves.toEqual(created);
      expect(mockCreate).toHaveBeenCalled();
    });

    it('throws when creation fails', async () => {
      const error = new Error('DB error');
      mockCreate.mockRejectedValue(error);

      await expect(
        RegistryService.createItem({} as unknown as Omit<RegistryItem, 'id' | 'contributors'>)
      ).rejects.toThrow(error);
    });
  });

  describe('updateItem', () => {
    it('updates a registry item', async () => {
      const updated = { id: '1', title: 'New', contributors: [] } as unknown as RegistryItem;
      mockUpdate.mockResolvedValue(updated);

      await expect(
        RegistryService.updateItem('1', { title: 'New' } as Partial<RegistryItem>)
      ).resolves.toEqual(updated);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('throws when update fails', async () => {
      const error = new Error('DB error');
      mockUpdate.mockRejectedValue(error);

      await expect(RegistryService.updateItem('1', {})).rejects.toThrow(error);
    });
  });

  describe('deleteItem', () => {
    it('deletes a registry item', async () => {
      const deleted = { id: '1' } as RegistryItem;
      mockDelete.mockResolvedValue(deleted);

      await expect(RegistryService.deleteItem('1')).resolves.toEqual(deleted);
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('throws when delete fails', async () => {
      const error = new Error('DB error');
      mockDelete.mockRejectedValue(error);

      await expect(RegistryService.deleteItem('1')).rejects.toThrow(error);
    });
  });

  describe('contributeToItem', () => {
    it('adds a contribution to an item', async () => {
      const item = { id: '1', amountContributed: 0, price: 100, contributors: [] } as unknown as RegistryItem;
      const updated = {
        ...item,
        amountContributed: 50,
        contributors: [{ name: 'John', amount: 50, date: new Date() }],
        purchased: false,
      } as unknown as RegistryItem;

      mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      mockFindUnique.mockResolvedValue(item);
      mockUpdate.mockResolvedValue(updated);

      const result = await RegistryService.contributeToItem('1', { name: 'John', amount: 50 });
      expect(result).toEqual(updated);
      expect(mockFindUnique).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('throws when item not found', async () => {
      mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      mockFindUnique.mockResolvedValue(null);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Item not found');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('propagates update failures', async () => {
      const item = {
        id: '1',
        amountContributed: 0,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;
      const error = new Error('Update failed');

      mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      mockFindUnique.mockResolvedValue(item);
      mockUpdate.mockRejectedValue(error);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow(error);
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('throws when contribution is greater than remaining amount', async () => {
      const item = {
        id: '1',
        amountContributed: 80,
        price: 100,
        contributors: []
      } as unknown as RegistryItem;

      mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      mockFindUnique.mockResolvedValue(item);

      await expect(
        RegistryService.contributeToItem('1', { name: 'John', amount: 50 })
      ).rejects.toThrow('Contribution cannot be greater than the remaining amount.');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});

