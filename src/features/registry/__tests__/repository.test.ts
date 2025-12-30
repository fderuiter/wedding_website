import { RegistryRepository } from '../repository';
import { RegistryItem } from '../types';
import { PrismaClient } from '@prisma/client';

// We mock the PrismaClient type to be able to pass a mock object
// without satisfying the entire interface which is huge.
type MockPrismaClient = {
  registryItem: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

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
  let mockPrisma: MockPrismaClient;
  let repository: RegistryRepository;

  beforeEach(() => {
    mockPrisma = {
      registryItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    repository = new RegistryRepository(mockPrisma as unknown as PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllItems', () => {
    it('should return all registry items', async () => {
      mockPrisma.registryItem.findMany.mockResolvedValue([mockRegistryItem]);
      const items = await repository.getAllItems();
      expect(items).toEqual([mockRegistryItem]);
      expect(mockPrisma.registryItem.findMany).toHaveBeenCalledWith({
        include: {
          contributors: true,
        },
      });
    });
  });

  describe('getItemById', () => {
    it('should return a single item by id', async () => {
      mockPrisma.registryItem.findUnique.mockResolvedValue(mockRegistryItem);
      const item = await repository.getItemById('1');
      expect(item).toEqual(mockRegistryItem);
      expect(mockPrisma.registryItem.findUnique).toHaveBeenCalledWith({
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
      mockPrisma.registryItem.create.mockResolvedValue({ ...newItemData, id: '2' });
      const item = await repository.createItem(newItemData);
      expect(item).toEqual({ ...newItemData, id: '2' });
      expect(mockPrisma.registryItem.create).toHaveBeenCalledWith({
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
      mockPrisma.registryItem.update.mockResolvedValue({ ...mockRegistryItem, ...updatedData });
      const item = await repository.updateItem('1', updatedData);
      expect(item.name).toBe('Updated Item');
      expect(mockPrisma.registryItem.update).toHaveBeenCalledWith({
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
      mockPrisma.registryItem.delete.mockResolvedValue(mockRegistryItem);
      await repository.deleteItem('1');
      expect(mockPrisma.registryItem.delete).toHaveBeenCalledWith({
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
      mockPrisma.$transaction.mockImplementation(callback => callback(tx));

      const contribution = { name: 'John Doe', amount: 50 };
      const item = await repository.contributeToItem('1', contribution);

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
          mockPrisma.$transaction.mockImplementation(callback => callback(tx));
      const contribution = { name: 'John Doe', amount: 50 };
      await expect(repository.contributeToItem('1', contribution)).rejects.toThrow('Item not found');
    });

  });
});
