import { RegistryRepository } from '../repository';
import { prisma } from '@/lib/prisma';
import { RegistryItem } from '../types';

// We still mock the module because the default export `registryRepository` depends on it,
// and we also want to pass the mocked `prisma` to the constructor in our tests.
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
  vendorUrl: 'http://example.com',
  image: 'http://example.com/image.jpg',
  category: 'Test Category',
  amountContributed: 0,
  purchased: false,
  quantity: 1,
  isGroupGift: true,
  contributors: [],
};

describe('RegistryRepository', () => {
  let registryRepository: RegistryRepository;

  beforeEach(() => {
     // Inject the mocked prisma instance
     registryRepository = new RegistryRepository(prisma);
  });

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
        image: 'http://new.com/image.jpg',
        category: 'New Category',
        quantity: 1,
        isGroupGift: true,
      };
      (prisma.registryItem.create as jest.Mock).mockResolvedValue({ ...newItemData, id: '2' });
      const item = await registryRepository.createItem(newItemData);
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
      const item = await registryRepository.updateItem('1', updatedData);
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
