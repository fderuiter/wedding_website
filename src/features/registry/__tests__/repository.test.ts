import { registryRepository } from '../repository';
import { prisma } from '@/lib/prisma';
import { RegistryItem } from '../types';
import { createMockCreateRegistryItemInput } from '@/testing/factories/registryFactory';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    registryItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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
  image: { id: 'media1', url: 'http://example.com/image.jpg', altText: null, isDecorative: false, isSample: false, createdAt: new Date(), updatedAt: new Date() },
  category: 'Test Category',
  amountContributed: 0,
  purchased: false,
  quantity: 1,
  isGroupGift: true,
  isMostWanted: false,
  isSample: false,
  displayOrder: 0,
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
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
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
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
        skip: 0,
        take: 20,
      });
    });

    it('should enforce hard maximum limit of 500 items per request', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(600);

      const res = await registryRepository.getAllItems({ page: 1, limit: 1000 });
      expect(res.limit).toBe(500);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: { image: true },
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
        skip: 0,
        take: 500,
      });
    });

    it('should allow requesting up to 500 items in a single bounded catalog fetch', async () => {
      (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([mockRegistryItem]);
      (prisma.registryItem.count as jest.Mock).mockResolvedValue(250);

      const res = await registryRepository.getAllItems({ page: 1, limit: 500 });
      expect(res.limit).toBe(500);
      expect(res.total).toBe(250);
      expect(res.totalPages).toBe(1);
      expect(prisma.registryItem.findMany).toHaveBeenCalledWith({
        include: { image: true },
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
        skip: 0,
        take: 500,
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
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
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
        orderBy: [
          { isMostWanted: 'desc' },
          { displayOrder: 'asc' },
          { createdAt: 'desc' },
        ],
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
      const fundData = createMockCreateRegistryItemInput({
        itemType: 'CASH_FUND',
        name: 'Honeymoon Fund',
        price: 1000,
        category: 'Cash Fund',
        paymentHandleType: 'Venmo',
        paymentHandle: '@honeymoon',
      });
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
          isMostWanted: false,
          displayOrder: 0,
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
              email: null,
              amount: contribution.amount,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
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
              email: null,
              amount: contribution.amount,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
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
              email: null,
              amount: 50,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
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
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'invite-good' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(0),
        },
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
        where: { code: 'GOODCODE', isSample: false },
      });
      expect(tx.invitationCode.update).not.toHaveBeenCalled();
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Jane Smith',
              email: null,
              amount: 50,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
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

    it('should throw an error if a sample invitation code is provided', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn(),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'sample-inv-1',
            code: 'SMITH2026',
            guestName: 'Mr. & Mrs. Robert Smith',
            used: false,
            isSample: true,
          }),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'Mr. & Mrs. Robert Smith', amount: 50, code: 'SMITH2026' };
      await expect(registryRepository.contributeToItem('1', contribution)).rejects.toThrow('Invalid invitation code.');
      expect(tx.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'SMITH2026', isSample: false },
      });
      expect(tx.invitationCode.update).not.toHaveBeenCalled();
      expect(tx.registryItem.update).not.toHaveBeenCalled();
    });

    it('should successfully contribute when a previously used invitation code is provided', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'invite-used' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(2),
        },
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
        where: { code: 'USEDCODE', isSample: false },
      });
      expect(tx.invitationCode.update).not.toHaveBeenCalled();
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Jane Smith',
              email: null,
              amount: 50,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
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

    it('should calculate feeAmount and record coverFee=true when contributor opts in to cover processing fee', async () => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 100 }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));

      const contribution = { name: 'Generous Guest', amount: 100, coverFee: true };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(100);
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 100,
          purchased: true,
          contributors: {
            create: {
              name: 'Generous Guest',
              email: null,
              amount: 100,
              status: 'RESERVED',
              coverFee: true,
              feeAmount: 2.5,
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

    it('should store contributor email address when email is provided', async () => {
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

      const contribution = { name: 'Well Wisher', email: 'wellwisher@example.com', amount: 50, message: 'Congrats!' };
      const item = await registryRepository.contributeToItem('1', contribution);

      expect(item.amountContributed).toBe(50);
      expect(tx.registryItem.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          amountContributed: 50,
          purchased: false,
          contributors: {
            create: {
              name: 'Well Wisher',
              email: 'wellwisher@example.com',
              amount: 50,
              status: 'RESERVED',
              coverFee: false,
              feeAmount: 0,
              message: 'Congrats!',
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

    it('falls back to inviteRecord.email when a verified guest leaves email blank', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'inv-email-fallback' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(0),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-email-fallback',
            code: 'GUEST777',
            guestName: 'Invited Contributor',
            email: 'household@example.com',
            used: false,
            isSample: false,
            partyTags: [],
          }),
          update: jest.fn().mockResolvedValue({ id: 'inv-email-fallback', used: true }),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 60 }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((callback) => callback(tx));

      await registryRepository.contributeToItem('1', {
        name: 'Invited Contributor',
        email: '',
        amount: 60,
        code: 'GUEST777',
      });

      expect(tx.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contributors: {
              create: expect.objectContaining({
                name: 'Invited Contributor',
                email: 'household@example.com',
                invitationCodeId: 'inv-email-fallback',
              }),
            },
          }),
        })
      );
    });

    it('rejects cross-item stripePaymentIntentId reuse and keeps same-item retries idempotent including on P2002 races', async () => {
      const existingSameItem = {
        id: 'contrib-1',
        registryItemId: '1',
        stripePaymentIntentId: 'pi_same_1',
      };
      const txSame = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(existingSameItem),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txSame));

      const sameRes = await registryRepository.contributeToItem('1', {
        name: 'Retry Guest',
        amount: 50,
        stripePaymentIntentId: 'pi_same_1',
      });
      expect(sameRes.amountContributed).toBe(50);
      expect(txSame.registryItem.update).not.toHaveBeenCalled();

      // Cross-item reuse inside transaction
      const txDiff = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(existingSameItem),
        },
        registryItem: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txDiff));

      await expect(
        registryRepository.contributeToItem('other-item-2', {
          name: 'Cross Item Attacker',
          amount: 50,
          stripePaymentIntentId: 'pi_same_1',
        })
      ).rejects.toThrow('Stripe PaymentIntent has already been used for another registry item.');

      // Concurrent P2002 race outside aborted transaction: same item stays idempotent
      const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      const mockFindFirst = jest.fn().mockResolvedValue(existingSameItem);
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002Error);
      (prisma as unknown as { contributor: { findFirst: jest.Mock } }).contributor = {
        findFirst: mockFindFirst,
      };
      (prisma.registryItem.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockRegistryItem,
        amountContributed: 50,
      });

      const raceIdempotent = await registryRepository.contributeToItem('1', {
        name: 'Concurrent Webhook',
        amount: 50,
        stripePaymentIntentId: 'pi_same_1',
      });
      expect(raceIdempotent.amountContributed).toBe(50);

      // Concurrent P2002 race for a different item throws ApiError(400)
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(p2002Error);
      mockFindFirst.mockResolvedValueOnce(existingSameItem);

      await expect(
        registryRepository.contributeToItem('other-item-2', {
          name: 'Concurrent Cross Item',
          amount: 50,
          stripePaymentIntentId: 'pi_same_1',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('records Stripe card payments with status CONFIRMED immediately', async () => {
      const tx = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 100, purchased: true }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(tx));

      await registryRepository.contributeToItem('1', {
        name: 'Card Guest',
        amount: 100,
        stripePaymentIntentId: 'pi_card_immediate',
        stripeChargeId: 'ch_card_immediate',
      });

      expect(tx.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contributors: {
              create: expect.objectContaining({
                name: 'Card Guest',
                amount: 100,
                status: 'CONFIRMED',
                stripePaymentIntentId: 'pi_card_immediate',
                stripeChargeId: 'ch_card_immediate',
              }),
            },
          }),
        })
      );
    });
  });

  describe('contributor lifecycle and non-destructive Stripe reconciliation', () => {
    it('confirms RESERVED contributions, cancels RESERVED claims, voids contributions non-destructively, and recalculates item totals', async () => {
      const reservedRow = {
        id: 'c-res-1',
        name: 'Taylor Guest',
        email: 'taylor@example.com',
        amount: 100,
        refundedAmount: 0,
        status: 'RESERVED',
        coverFee: false,
        feeAmount: 0,
        date: new Date('2026-11-20T00:00:00Z'),
        isPlusOne: false,
        thankYouStatus: 'Unsent',
        registryItemId: 'item-ledger-1',
      };

      const itemWithContributors = {
        ...mockRegistryItem,
        id: 'item-ledger-1',
        isGroupGift: false,
        price: 100,
        quantity: 1,
        amountContributed: 100,
        purchased: true,
        purchaserName: 'Taylor Guest',
      };

      // 1. Confirm RESERVED -> CONFIRMED
      const txConfirm = {
        contributor: {
          findUnique: jest.fn().mockResolvedValue(reservedRow),
          update: jest.fn().mockResolvedValue({ ...reservedRow, status: 'CONFIRMED' }),
          findMany: jest.fn().mockResolvedValue([{ ...reservedRow, status: 'CONFIRMED' }]),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(itemWithContributors),
          update: jest.fn().mockResolvedValue({
            ...itemWithContributors,
            contributors: [{ ...reservedRow, status: 'CONFIRMED' }],
          }),
        },
        snapshotVersion: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txConfirm));

      const confirmRes = await registryRepository.confirmContribution!('c-res-1', 'Guest');
      expect(confirmRes.changed).toBe(true);
      expect(confirmRes.contributor.status).toBe('CONFIRMED');
      expect(txConfirm.contributor.update).toHaveBeenCalledWith({
        where: { id: 'c-res-1' },
        data: { status: 'CONFIRMED', alertEmailSentAt: null },
      });

      // 2. Guest cancel on CONFIRMED is rejected with 409
      const txCancelConfirmed = {
        contributor: {
          findUnique: jest.fn().mockResolvedValue({ ...reservedRow, status: 'CONFIRMED' }),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txCancelConfirmed));
      await expect(registryRepository.cancelReservedContribution!('c-res-1')).rejects.toMatchObject({
        statusCode: 409,
      });

      // 3. Admin void transitions CONFIRMED -> CANCELLED without deleting contributor and reopens item
      const txVoid = {
        contributor: {
          findUnique: jest.fn().mockResolvedValue({ ...reservedRow, status: 'CONFIRMED' }),
          update: jest.fn().mockResolvedValue({ ...reservedRow, status: 'CANCELLED' }),
          findMany: jest.fn().mockResolvedValue([{ ...reservedRow, status: 'CANCELLED' }]),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(itemWithContributors),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...itemWithContributors,
              ...data,
              contributors: [{ ...reservedRow, status: 'CANCELLED' }],
            })
          ),
        },
        snapshotVersion: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txVoid));

      const voidRes = await registryRepository.voidContribution!('c-res-1', 'Admin');
      expect(voidRes.changed).toBe(true);
      expect(voidRes.contributor.status).toBe('CANCELLED');
      expect(txVoid.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            amountContributed: 0,
            purchased: false,
            purchaserName: null,
          },
        })
      );
    });

    it('reconciles partial and full Stripe refunds idempotently', async () => {
      const stripeContrib = {
        id: 'c-stripe-1',
        name: 'Alex Card',
        email: 'alex@example.com',
        amount: 100,
        refundedAmount: 0,
        status: 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        date: new Date('2026-11-20T00:00:00Z'),
        isPlusOne: false,
        thankYouStatus: 'Unsent',
        stripePaymentIntentId: 'pi_refund_1',
        stripeChargeId: 'ch_refund_1',
        registryItemId: 'item-fund-1',
      };
      const fundItem = {
        ...mockRegistryItem,
        id: 'item-fund-1',
        price: 100,
        quantity: 1,
        isGroupGift: true,
        amountContributed: 100,
        purchased: true,
      };

      // Partial refund of $40 -> stays CONFIRMED, refundedAmount = 40, item amountContributed = 60, purchased = false
      const txPartial = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(stripeContrib),
          findUnique: jest.fn().mockResolvedValue(stripeContrib),
          update: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }),
          findMany: jest.fn().mockResolvedValue([{ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }]),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            ...fundItem,
            contributors: [{ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }],
          }),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...fundItem,
              ...data,
              contributors: [{ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }],
            })
          ),
        },
        snapshotVersion: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txPartial));

      const partialRes = await registryRepository.reconcileStripeAdjustment!({
        stripeChargeId: 'ch_refund_1',
        stripePaymentIntentId: 'pi_refund_1',
        refundedCents: 4000,
      });
      expect(partialRes.matched).toBe(true);
      expect(partialRes.changed).toBe(true);
      expect(partialRes.refundedAmount).toBe(40);
      expect(partialRes.contributor?.status).toBe('CONFIRMED');
      expect(txPartial.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountContributed: 60,
            purchased: false,
          }),
        })
      );

      // Duplicate webhook with same $40 refund -> idempotent no-op
      const txDuplicate = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }),
          findUnique: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }),
          update: jest.fn(),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            ...fundItem,
            amountContributed: 60,
            purchased: false,
            contributors: [{ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }],
          }),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txDuplicate));

      const dupRes = await registryRepository.reconcileStripeAdjustment!({
        stripeChargeId: 'ch_refund_1',
        refundedCents: 4000,
      });
      expect(dupRes.matched).toBe(true);
      expect(dupRes.changed).toBe(false);
      expect(txDuplicate.contributor.update).not.toHaveBeenCalled();

      // Full refund ($100) -> status REFUNDED, item amountContributed = 0
      const txFull = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }),
          findUnique: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 40, status: 'CONFIRMED' }),
          update: jest.fn().mockResolvedValue({ ...stripeContrib, refundedAmount: 100, status: 'REFUNDED' }),
          findMany: jest.fn().mockResolvedValue([{ ...stripeContrib, refundedAmount: 100, status: 'REFUNDED' }]),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            ...fundItem,
            contributors: [{ ...stripeContrib, refundedAmount: 100, status: 'REFUNDED' }],
          }),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...fundItem,
              ...data,
              contributors: [{ ...stripeContrib, refundedAmount: 100, status: 'REFUNDED' }],
            })
          ),
        },
        snapshotVersion: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txFull));

      const fullRes = await registryRepository.reconcileStripeAdjustment!({
        stripeChargeId: 'ch_refund_1',
        refundedCents: 10000,
        forceFullReversal: true,
      });
      expect(fullRes.changed).toBe(true);
      expect(fullRes.contributor?.status).toBe('REFUNDED');
      expect(txFull.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountContributed: 0,
            purchased: false,
          }),
        })
      );
    });

    it('keeps pending guest attendance status pending when claiming a gift with an invitation code', async () => {
      const { getAttendanceStatus } = await import('../utils/invitation');
      const inviteRow = {
        id: 'invite-pending',
        code: 'PENDINGCODE',
        guestName: 'Alex Pending',
        used: false,
        subEventRsvps: [],
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'invite-pending' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(0),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue(inviteRow),
          update: jest.fn(),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(tx));

      await registryRepository.contributeToItem('1', {
        name: 'Alex Pending',
        amount: 50,
        code: 'PENDINGCODE',
      });

      expect(tx.invitationCode.update).not.toHaveBeenCalled();
      expect(getAttendanceStatus(inviteRow)).toBe('pending');
    });

    it('never auto-links or backfills InvitationCode from unverified guest email, rejects address-collection codes, and enforces MAX_ACTIVE_HOUSEHOLD_RESERVATIONS=5 on RESERVED claims while allowing Stripe CONFIRMED payments', async () => {
      const txEmailOnly = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 75 }),
        },
        invitationCode: {
          findMany: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txEmailOnly));

      await registryRepository.contributeToItem('1', {
        name: 'Unverified Email Guest',
        email: '  UNIQUE@example.com ',
        amount: 75,
        addressLine1: '100 Pine St',
        city: 'Denver',
        state: 'CO',
        zipCode: '80202',
        country: 'USA',
      });

      expect(txEmailOnly.invitationCode.findMany).not.toHaveBeenCalled();
      expect(txEmailOnly.invitationCode.findUnique).not.toHaveBeenCalled();
      expect(txEmailOnly.invitationCode.update).not.toHaveBeenCalled();
      const unlinkedCreateData = (txEmailOnly.registryItem.update as jest.Mock).mock.calls[0][0]
        .data.contributors.create;
      expect(unlinkedCreateData.invitationCodeId).toBeUndefined();
      expect(unlinkedCreateData.email).toBe('UNIQUE@example.com');
      expect(unlinkedCreateData.addressLine1).toBe('100 Pine St');

      // Rejects address-collection invitation codes
      const txAddrSource = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn(),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-addr-only',
            code: 'ADDRONLY',
            guestName: 'Address Collector',
            isSample: false,
            partyTags: ['address-collection'],
            source: 'address-collection',
          }),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txAddrSource));

      await expect(
        registryRepository.contributeToItem('1', {
          name: 'Address Collector',
          amount: 50,
          code: 'ADDRONLY',
        })
      ).rejects.toThrow('Invalid invitation code.');
      expect(txAddrSource.registryItem.update).not.toHaveBeenCalled();

      // Rejects 6th active RESERVED claim for the same household with ApiError(429)
      const txCapped = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'inv-capped' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(5),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn(),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-capped',
            code: 'CAPPED05',
            guestName: 'Capped Household',
            isSample: false,
            source: 'admin',
          }),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txCapped));

      await expect(
        registryRepository.contributeToItem('1', {
          name: 'Capped Household',
          amount: 25,
          code: 'CAPPED05',
        })
      ).rejects.toMatchObject({
        statusCode: 429,
      });
      expect(txCapped.$queryRaw).toHaveBeenCalledTimes(2);
      expect(txCapped.registryItem.update).not.toHaveBeenCalled();

      // Stripe CONFIRMED payment bypasses RESERVED cap even when 5 RESERVED claims exist
      const txStripeAllowed = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn(),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 50 }),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'inv-capped',
            code: 'CAPPED05',
            guestName: 'Capped Household',
            isSample: false,
            source: 'admin',
          }),
          update: jest.fn(),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txStripeAllowed));

      const stripeAllowedRes = await registryRepository.contributeToItem('1', {
        name: 'Capped Household',
        amount: 50,
        code: 'CAPPED05',
        stripePaymentIntentId: 'pi_verified_bypass_cap',
      });
      expect(stripeAllowedRes.amountContributed).toBe(50);
      expect(txStripeAllowed.contributor.count).not.toHaveBeenCalled();
    });

    it('never overwrites an existing household street address or partially mismatched address during verified contributor checkout backfill', async () => {
      const existingAddressedInvite = {
        id: 'invite-has-addr',
        code: 'ADDRCODE',
        guestName: 'Taylor Household',
        used: false,
        addressLine1: '500 Existing Blvd',
        addressLine2: 'Suite 10',
        city: 'Portland',
        state: 'OR',
        zipCode: '97201',
        country: 'USA',
      };
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'invite-has-addr' }]),
        contributor: {
          count: jest.fn().mockResolvedValue(0),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(mockRegistryItem),
          update: jest.fn().mockResolvedValue({ ...mockRegistryItem, amountContributed: 60 }),
        },
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue(existingAddressedInvite),
          update: jest.fn(),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(tx));

      await registryRepository.contributeToItem('1', {
        name: 'Taylor Household',
        amount: 60,
        code: 'ADDRCODE',
        addressLine1: '999 New St',
        city: 'Seattle',
        state: 'WA',
        zipCode: '98101',
      });

      expect(tx.invitationCode.update).not.toHaveBeenCalled();
      expect(tx.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contributors: {
              create: expect.objectContaining({
                invitationCodeId: 'invite-has-addr',
                addressLine1: '999 New St',
                city: 'Seattle',
                state: 'WA',
                zipCode: '98101',
              }),
            },
          }),
        })
      );
    });
  });

  describe('admin claim reconciliation: unclaimItem, updateContributor, deleteContributor', () => {
    it('unclaims a purchased item under SELECT ... FOR UPDATE, cancels active contributors, and records audit snapshots while enforcing Stripe confirmation', async () => {
      const stripeClaimedItem = {
        ...mockRegistryItem,
        id: 'item-claimed-1',
        price: 100,
        amountContributed: 100,
        purchased: true,
        purchaserName: 'Pat Buyer',
        contributors: [
          {
            id: 'c-stripe-1',
            registryItemId: 'item-claimed-1',
            name: 'Pat Buyer',
            amount: 100,
            status: 'CONFIRMED',
            thankYouStatus: 'Unsent',
            stripePaymentIntentId: 'pi_verified_1',
            date: new Date('2026-06-01T00:00:00Z'),
          },
        ],
      };

      const txReject = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'item-claimed-1' }]),
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(stripeClaimedItem),
          update: jest.fn(),
        },
        contributor: {
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txReject));

      await expect(registryRepository.unclaimItem!('item-claimed-1', {})).rejects.toThrow(
        'Explicit admin confirmation is required before releasing a claim with a verified Stripe payment.'
      );
      expect(txReject.$queryRaw).toHaveBeenCalledTimes(1);
      expect(txReject.registryItem.update).not.toHaveBeenCalled();

      const txConfirm = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'item-claimed-1' }]),
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(stripeClaimedItem),
          update: jest.fn().mockResolvedValue({
            ...stripeClaimedItem,
            purchased: false,
            amountContributed: 0,
            purchaserName: null,
            contributors: [
              {
                ...stripeClaimedItem.contributors[0],
                status: 'CANCELLED',
                thankYouStatus: 'Not Needed',
              },
            ],
          }),
        },
        contributor: {
          update: jest.fn().mockResolvedValue({
            ...stripeClaimedItem.contributors[0],
            status: 'CANCELLED',
            thankYouStatus: 'Not Needed',
          }),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txConfirm));

      const unclaimed = await registryRepository.unclaimItem!('item-claimed-1', {
        confirmVerifiedPayment: true,
      });

      expect(txConfirm.$queryRaw).toHaveBeenCalledTimes(1);
      expect(unclaimed.purchased).toBe(false);
      expect(unclaimed.amountContributed).toBe(0);
      expect(unclaimed.purchaserName).toBeNull();
      expect(txConfirm.contributor.update).toHaveBeenCalledWith({
        where: { id: 'c-stripe-1' },
        data: { status: 'CANCELLED', thankYouStatus: 'Not Needed' },
      });
      expect(txConfirm.snapshotVersion.create).toHaveBeenCalledTimes(2);
    });

    it('updates a contributor under row lock, recomputes item ledger, and requires confirmation for verified Stripe payments', async () => {
      const existingStripeContrib = {
        id: 'c-edit-1',
        registryItemId: '1',
        name: 'Original Guest',
        email: 'orig@example.com',
        amount: 100,
        refundedAmount: 0,
        status: 'CONFIRMED',
        stripeChargeId: 'ch_verified_99',
        thankYouStatus: 'Unsent',
        date: new Date('2026-06-02T00:00:00Z'),
      };

      const txUnconfirmed = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: '1' }]),
        contributor: {
          findUnique: jest.fn().mockResolvedValue(existingStripeContrib),
          update: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txUnconfirmed));

      await expect(
        registryRepository.updateContributor!('c-edit-1', { amount: 40 })
      ).rejects.toThrow(
        'Explicit admin confirmation is required before editing a verified Stripe contribution.'
      );
      expect(txUnconfirmed.$queryRaw).toHaveBeenCalledTimes(1);
      expect(txUnconfirmed.contributor.update).not.toHaveBeenCalled();

      const updatedContrib = {
        ...existingStripeContrib,
        name: 'Corrected Guest',
        amount: 40,
      };
      const txConfirmed = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: '1' }]),
        contributor: {
          findUnique: jest.fn().mockResolvedValue(existingStripeContrib),
          update: jest.fn().mockResolvedValue(updatedContrib),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            ...mockRegistryItem,
            id: '1',
            price: 100,
            isGroupGift: true,
            amountContributed: 100,
            purchased: true,
            contributors: [updatedContrib],
          }),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...mockRegistryItem,
              id: '1',
              price: 100,
              isGroupGift: true,
              ...data,
              contributors: [updatedContrib],
            })
          ),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txConfirmed));

      const result = await registryRepository.updateContributor!('c-edit-1', {
        name: '  Corrected Guest  ',
        amount: 40,
        confirmVerifiedPayment: true,
      });

      expect(txConfirmed.$queryRaw).toHaveBeenCalledTimes(2);
      expect(result.contributor.name).toBe('Corrected Guest');
      expect(result.contributor.amount).toBe(40);
      expect(result.item?.amountContributed).toBe(40);
      expect(result.item?.purchased).toBe(false);
      expect(txConfirmed.snapshotVersion.create).toHaveBeenCalledTimes(2);
    });

    it('deletes a contributor under row lock, recomputes item ledger, and requires confirmation for verified Stripe payments', async () => {
      const existingContrib = {
        id: 'c-del-1',
        registryItemId: '1',
        name: 'Accidental Claim',
        amount: 100,
        refundedAmount: 0,
        status: 'CONFIRMED',
        stripePaymentIntentId: 'pi_del_1',
        date: new Date('2026-06-03T00:00:00Z'),
      };

      const txUnconfirmed = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: '1' }]),
        contributor: {
          findUnique: jest.fn().mockResolvedValue(existingContrib),
          delete: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txUnconfirmed));

      await expect(registryRepository.deleteContributor!('c-del-1', {})).rejects.toThrow(
        'Explicit admin confirmation is required before deleting a verified Stripe contribution.'
      );
      expect(txUnconfirmed.contributor.delete).not.toHaveBeenCalled();

      const txConfirmed = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: '1' }]),
        contributor: {
          findUnique: jest.fn().mockResolvedValue(existingContrib),
          delete: jest.fn().mockResolvedValue(existingContrib),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            ...mockRegistryItem,
            id: '1',
            price: 100,
            purchased: true,
            amountContributed: 100,
            purchaserName: 'Accidental Claim',
            contributors: [],
          }),
          update: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...mockRegistryItem,
              id: '1',
              price: 100,
              ...data,
              contributors: [],
            })
          ),
        },
        snapshotVersion: {
          create: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
      };
      (prisma.$transaction as jest.Mock).mockImplementationOnce((cb) => cb(txConfirmed));

      const deleted = await registryRepository.deleteContributor!('c-del-1', {
        confirmVerifiedPayment: true,
      });

      expect(txConfirmed.$queryRaw).toHaveBeenCalledTimes(2);
      expect(deleted.deletedId).toBe('c-del-1');
      expect(deleted.item?.purchased).toBe(false);
      expect(deleted.item?.amountContributed).toBe(0);
      expect(deleted.item?.purchaserName).toBeNull();
      expect(txConfirmed.snapshotVersion.create).toHaveBeenCalledTimes(2);
    });

    it('computes active catalog capabilities summary excluding sample and fully purchased items', async () => {
      (prisma.registryItem.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'phys-1' })
        .mockResolvedValueOnce(null);
      const physicalOnly = await registryRepository.getActiveCatalogCapabilitiesSummary!();
      expect(prisma.registryItem.findFirst).toHaveBeenCalledWith({
        where: {
          isSample: false,
          purchased: false,
          itemType: 'PHYSICAL',
          isGroupGift: false,
        },
        select: { id: true },
      });
      expect(physicalOnly).toEqual({
        hasActivePhysicalItems: true,
        hasActiveFundsOrGroupGifts: false,
      });

      (prisma.registryItem.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'fund-1' });
      const fundOnly = await registryRepository.getActiveCatalogCapabilitiesSummary!();
      expect(fundOnly).toEqual({
        hasActivePhysicalItems: false,
        hasActiveFundsOrGroupGifts: true,
      });
    });
  });
});
