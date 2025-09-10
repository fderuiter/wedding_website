import { RegistryRepository } from '../repository';
import { prisma } from '@/lib/prisma';
import { RegistryItem } from '../types';

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

const mockRegistryItem: RegistryItem = {
  id: '1',
  name: 'Test Item',
  price: 100,
  description: 'Test Description',
  link: 'http://example.com',
  image: 'http://example.com/image.jpg',
  category: 'Test Category',
  amountContributed: 0,
  purchased: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  contributors: [],
};

describe('RegistryRepository', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllItems', () => {
    it('should return all registry items', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      const items = await RegistryRepository.getAllItems();
      expect(items).toEqual([mockRegistryItem]);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: {
          contributors: true,
        },
      });
    });
  });

  describe('getItemById', () => {
    it('should return a single item by id', async () => {
      (prisma.registryItem.findUnique as jest.Mock).mockResolvedValue(mockRegistryItem);
      const item = await RegistryRepository.getItemById('1');
      expect(item).toEqual(mockRegistryItem);
      expect(prisma.registryItem.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: {
          contributors: true,
        },
      });
    });
  });

  describe('createItem', () => {
    it('should create a new item', async () => {
      const newItemData = {
        name: 'New Item',
        price: 200,
        description: 'New Description',
        link: 'http://new.com',
        image: 'http://new.com/image.jpg',
        category: 'New Category',
      };
      (prisma.registryItem.create as jest.Mock).mockResolvedValue({ ...newItemData, id: '2' });
      const item = await RegistryRepository.createItem(newItemData);
      expect(item).toEqual({ ...newItemData, id: '2' });
      expect(prisma.registryItem.create).toHaveBeenCalledWith({
        data: {
          ...newItemData,
          contributors: {
            create: [],
          },
        },
        include: {
          contributors: true,
        },
      });
    });
  });

  describe('updateItem', () => {
    it('should update an existing item', async () => {
      const updatedData = { name: 'Updated Item' };
      (prisma.registryItem.update as jest.Mock).mockResolvedValue({ ...mockRegistryItem, ...updatedData });
      const item = await RegistryRepository.updateItem('1', updatedData);
      expect(item.name).toBe('Updated Item');
      expect(prisma.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updatedData,
        include: {
          contributors: true,
        },
      });
    });
  });

  describe('deleteItem', () => {
    it('should delete an item', async () => {
      (prisma.registryItem.delete as jest.Mock).mockResolvedValue(mockRegistryItem);
      await RegistryRepository.deleteItem('1');
      expect(prisma.registryItem.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });

  describe('contributeToItem', () => {
    it('should add a contribution to an item', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'John Doe', amount: 50 };
      const item = await RegistryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.registryItem.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: { contributors: true },
      });
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: contribution.name,
              amount: contribution.amount,
              date: expect.any(Date),
            },
          },
        },
        include: {
          contributors: true,
        },
      });
    });

    it('should throw an error if item is not found', async () => {
        const tx = {
            registryItem: {
              findUnique: jest.fn().mockResolvedValue(null),
              update: jest.fn(),
            },
          };
          (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
      const contribution = { name: 'John Doe', amount: 50 };
      await expect(RegistryRepository.contributeToItem('1', contribution)).rejects.toThrow('Item not found');
    });

    it('should throw an error if contribution is greater than remaining amount', async () => {
        const tx = {
            registryItem: {
              findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
              update: jest.fn(),
            },
          };
          (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
      const contribution = { name: 'John Doe', amount: 150 };
      await expect(RegistryRepository.contributeToItem('1', contribution)).rejects.toThrow('Contribution cannot be greater than the remaining amount.');
    });
  });
});
