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
      count: jest.fn(),
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
    invitationCode: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockRegistryItem: RegistryItem = {
  id: '1',
  itemType: 'PHYSICAL',
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
    it('should return all registry items without joining contributors by default', async () => {
      const itemWithoutRel = { ...mockRegistryItem };
      delete (itemWithoutRel as any).contributors;
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([itemWithoutRel]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(1);

      const res = await registryRepository.getAllItems();
      expect(res).toEqual({
        items: [mockRegistryItem],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: {
          image: true,
        },
        skip: 0,
        take: 20,
      });
    });

    it('should include contributors when includeContributors option is true', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(1);

      const res = await registryRepository.getAllItems({ includeContributors: true });
      expect(res).toEqual({
        items: [mockRegistryItem],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: {
          image: true,
          contributors: true,
        },
        skip: 0,
        take: 20,
      });
    });

    it('should enforce hard maximum limit of 100 items per request', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(150);

      const res = await registryRepository.getAllItems({ page: 1, limit: 500 });
      expect(res.limit).toBe(100);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: { image: true },
        skip: 0,
        take: 100,
      });
    });

    it('should apply page offset correctly', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(50);

      const res = await registryRepository.getAllItems({ page: 3, limit: 10 });
      expect(res.page).toBe(3);
      expect(res.limit).toBe(10);
      expect(res.totalPages).toBe(5);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: { image: true },
        skip: 20,
        take: 10,
      });
    });

    it('should apply category and price range filters in Prisma query', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(1);

      await registryRepository.getAllItems({
        category: 'Kitchen',
        minPrice: 50,
        maxPrice: 200,
      });

      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        where: {
          category: 'Kitchen',
          price: {
            gte: 50,
            lte: 200,
          },
        },
        include: { image: true },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('getItemById', () => {
    it('should return a single item by id without joining contributors by default', async () => {
      const itemWithoutRel = { ...mockRegistryItem };
      delete (itemWithoutRel as any).contributors;
      (prisma.registryItem.findUnique as jest.Mock).mockResolvedValue(itemWithoutRel);
      const item = await registryRepository.getItemById('1');
      expect(item).toEqual(mockRegistryItem);
      expect(prisma.registryItem.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: {
          image: true,
        },
      });
    });

    it('should include contributors when includeContributors option is true', async () => {
      (prisma.registryItem.findUnique as jest.Mock).mockResolvedValue(mockRegistryItem);
      const item = await registryRepository.getItemById('1', { includeContributors: true });
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
    it('should create a cash fund item with payment metadata', async () => {
      const fundData = {
        itemType: 'CASH_FUND' as const,
        name: 'Honeymoon Fund',
        price: 1000,
        category: 'Cash Fund',
        paymentHandleType: 'Venmo',
        paymentHandle: '@honeymoon',
      };
      (prisma.media.create as jest.Mock).mockResolvedValue({ id: 'media3' });
      (prisma.registryItem.create as jest.Mock).mockResolvedValue({
        ...fundData,
        id: '3',
        description: '',
        quantity: 1,
        isGroupGift: true,
        imageId: 'media3',
        vendorUrl: null,
        purchased: false,
        amountContributed: 0,
        contributors: [],
      });

      const item = await registryRepository.createItem(fundData);
      expect(item.itemType).toBe('CASH_FUND');
      expect(item.paymentHandle).toBe('@honeymoon');
      expect(prisma.registryItem.create).toHaveBeenCalledWith({
        data: {
          itemType: 'CASH_FUND',
          paymentHandleType: 'Venmo',
          paymentHandle: '@honeymoon',
          name: 'Honeymoon Fund',
          price: 1000,
          quantity: 1,
          category: 'Cash Fund',
          description: '',
          imageId: 'media3',
          vendorUrl: null,
          isGroupGift: true,
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
              message: null,
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

    it('should save guest message when provided and sanitize whitespace-only messages to null', async () => {
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

      // 1. With valid message
      const contributionWithMessage = { name: 'Alice', amount: 50, message: '  Best wishes for both of you!  ' };
      await registryRepository.contributeToItem('1', contributionWithMessage);

      expect(tx.registryItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          contributors: {
            create: expect.objectContaining({
              name: 'Alice',
              amount: 50,
              message: 'Best wishes for both of you!',
            }),
          },
        }),
      }));

      // 2. With whitespace-only message
      const contributionWithWhitespace = { name: 'Bob', amount: 50, message: '   ' };
      await registryRepository.contributeToItem('1', contributionWithWhitespace);

      expect(tx.registryItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          contributors: {
            create: expect.objectContaining({
              name: 'Bob',
              amount: 50,
              message: null,
            }),
          },
        }),
      }));
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

    it('should successfully complete a final payment of exactly $0.20 for an item with a $10.30 price and $10.10 in existing contributions', async () => {
      const targetItem = {
        ...mockRegistryItem,
        price: 10.30,
        amountContributed: 10.10,
      };
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(targetItem),
          update: jest.fn().mockResolvedValue({ ...targetItem, amountContributed: 10.30, purchased: true }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'John Doe', amount: 0.20 };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(10.30);
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 10.30,
          purchased: true,
          contributors: {
            create: {
              name: contribution.name,
              amount: contribution.amount,
              message: null,
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

    it('should throw an error if a contribution exceeds the exact remaining balance by $0.01', async () => {
      const targetItem = {
        ...mockRegistryItem,
        price: 10.30,
        amountContributed: 10.10,
      };
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(targetItem),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'John Doe', amount: 0.21 };
      await expect(registryRepository.contributeToItem('1', contribution)).rejects.toThrow(
        'Contribution cannot be greater than the remaining amount.'
      );
      expect(tx.registryItem.update).not.toHaveBeenCalled();
    });

    it('should successfully contribute without an invitation code', async () => {
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

      const contribution = { name: 'Guest Contributor', amount: 50 };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Guest Contributor',
              amount: 50,
              message: null,
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

    it('should successfully contribute when a valid and unused invitation code is provided', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'invite-good',
            code: 'GOODCODE',
            guestName: 'Jane Smith',
            used: false,
          }),
          update: jest.fn().mockResolvedValue({ id: 'invite-good', used: true }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'Jane Smith', amount: 50, code: 'GOODCODE' };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'GOODCODE' },
      });
      expect(tx.invitationCode.update).toHaveBeenCalledWith({
        where: { id: 'invite-good' },
        data: {
          used: true,
          usedAt: expect.any(Date),
        },
      });
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Jane Smith',
              amount: 50,
              message: null,
              date: expect.any(Date),
              invitationCodeId: 'invite-good',
            },
          },
        },
        include: {
          image: true,
          contributors: true,
        },
      });
    });

    it('should throw an error if the provided invitation code is invalid', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'Some Name', amount: 50, code: 'INVALID' };
      await expect(registryRepository.contributeToItem('1', contribution)).rejects.toThrow('Invalid invitation code.');
    });

    it('should successfully contribute when a previously used invitation code is provided', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'invite-used',
            code: 'USEDCODE',
            guestName: 'Jane Smith',
            used: true,
          }),
          update: jest.fn().mockResolvedValue({ id: 'invite-used', used: true }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'Jane Smith', amount: 50, code: 'USEDCODE' };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'USEDCODE' },
      });
      expect(tx.invitationCode.update).toHaveBeenCalledWith({
        where: { id: 'invite-used' },
        data: {
          used: true,
          usedAt: expect.any(Date),
        },
      });
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Jane Smith',
              amount: 50,
              message: null,
              date: expect.any(Date),
              invitationCodeId: 'invite-used',
            },
          },
        },
        include: {
          image: true,
          contributors: true,
        },
      });
    });
  });
});
