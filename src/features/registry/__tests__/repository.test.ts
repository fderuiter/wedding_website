import { registryRepository } from '../repository';
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
    media: {
      create: jest.fn(),
      update: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockRegistryItem: RegistryItem = {
  id: '1',
  name: 'Test Item',
  price: 100,
  description: 'Test Description',
  vendorUrl: 'http://example.com',
  imageId: 'media1',
  image: { id: 'media1', url: 'http://example.com/image.jpg', altText: null, isDecorative: false, createdAt: new Date(), updatedAt: new Date() },
  category: 'Test Category',
  amountContributed: 0,
  purchased: false,
  quantity: 1,
  isGroupGift: true,
  contributors: [],
};

describe('RegistryRepository', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllItems', () => {
    it('should return all registry items', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      const items = await registryRepository.getAllItems();
      expect(items).toEqual([mockRegistryItem]);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: {
          image: true,
          contributors: true,
        },
      });
    });
  });

  describe('getItemById', () => {
    it('should return a single item by id', async () => {
      (prisma.registryItem.findUnique as jest.Mock).mockResolvedValue(mockRegistryItem);
      const item = await registryRepository.getItemById('1');
      expect(item).toEqual(mockRegistryItem);
      expect(prisma.registryItem.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: {
          image: true,
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
        vendorUrl: 'http://new.com',
        imageUrl: 'http://new.com/image.jpg',
        category: 'New Category',
        quantity: 1,
        isGroupGift: true,
      };
      (prisma.media.create as jest.Mock).mockResolvedValue({ id: 'media2' });
      (prisma.registryItem.create as jest.Mock).mockResolvedValue({ 
        ...newItemData, 
        id: '2', 
        imageId: 'media2',
        purchased: false, 
        amountContributed: 0,
        contributors: []
      });
      const item = await registryRepository.createItem(newItemData);
      expect(item.name).toBe('New Item');
      expect(prisma.media.create).toHaveBeenCalled();
      expect(prisma.registryItem.create).toHaveBeenCalledWith({
        data: {
          name: newItemData.name,
          price: newItemData.price,
          quantity: newItemData.quantity,
          category: newItemData.category,
          description: newItemData.description,
          imageId: 'media2',
          vendorUrl: newItemData.vendorUrl,
          isGroupGift: newItemData.isGroupGift,
          contributors: {
            create: [],
          },
        },
        include: {
          image: true,
          contributors: true,
        },
      });
    });
  });

  describe('updateItem', () => {
    it('should update an existing item', async () => {
      const updatedData = { name: 'Updated Item' };
      (prisma.registryItem.update as jest.Mock).mockResolvedValue({ ...mockRegistryItem, ...updatedData });
      const item = await registryRepository.updateItem('1', updatedData);
      expect(item.name).toBe('Updated Item');
      expect(prisma.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updatedData,
        include: {
          image: true,
          contributors: true,
        },
      });
    });
  });

  describe('deleteItem', () => {
    it('should delete an item', async () => {
      (prisma.registryItem.delete as jest.Mock).mockResolvedValue(mockRegistryItem);
      await registryRepository.deleteItem('1');
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
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'John Doe', amount: 50 };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.registryItem.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
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
          image: true,
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
      await expect(registryRepository.contributeToItem('1', contribution)).rejects.toThrow('Item not found');
    });

  });
});
