import { RegistryService } from '../registryService';
import { prisma } from '../../lib/prisma';
import type { Contributor, RegistryItem } from '@/types/registry';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    registryItem: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn()
  }
}));

describe('RegistryService.contributeToItem', () => {
  it('updates contribution and returns remaining balance', async () => {
    const item = {
      id: '1',
      name: 'Gift',
      description: '',
      category: 'Other',
      price: 100,
      image: '',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      purchaserName: null,
      amountContributed: 40,
      contributors: [] as Contributor[]
    };
    const updatedItem = {
      ...item,
      amountContributed: 70,
      purchased: false,
      contributors: [{ name: 'Alice', amount: 30, date: new Date().toISOString() }]
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      const tx = {
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(item),
          update: jest.fn().mockResolvedValue(updatedItem)
        }
      };
      return cb(tx);
    });

    const result = await RegistryService.contributeToItem('1', {
      name: 'Alice',
      amount: 30
    });

    expect(result.amountContributed).toBe(70);
    expect(result.purchased).toBe(false);
    const remaining = result.price - result.amountContributed;
    expect(remaining).toBe(30);
  });
});

describe('RegistryService basic methods', () => {
  it('returns all items', async () => {
    const items = [{ id: '1' }];
    (prisma.registryItem.findMany as jest.Mock).mockResolvedValue(items);
    const result = await RegistryService.getAllItems();
    expect(result).toEqual(items);
    expect(prisma.registryItem.findMany).toHaveBeenCalled();
  });

  it('updates an item without contributors field', async () => {
    const updated = { id: '1', name: 'New' };
    (prisma.registryItem.update as jest.Mock).mockResolvedValue(updated);
    const result = await RegistryService.updateItem('1', { name: 'New', contributors: [] as Contributor[] });
    expect(result).toEqual(updated);
    expect(prisma.registryItem.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { name: 'New' },
      include: { contributors: true }
    });
  });

  it('creates and deletes an item', async () => {
    const itemData: Omit<RegistryItem, 'id' | 'contributors'> = { name: 'G', description: '', category: 'Other', price: 1, image: '', vendorUrl: null, quantity: 1, isGroupGift: false, purchased: false, purchaserName: null, amountContributed: 0 };
    const createdItem = { id: '2', ...itemData, contributors: [] };
    (prisma.registryItem.create as jest.Mock).mockResolvedValue(createdItem);
    const result = await RegistryService.createItem(itemData);
    expect(result).toEqual(createdItem);
    expect(prisma.registryItem.create).toHaveBeenCalled();
    (prisma.registryItem.delete as jest.Mock).mockResolvedValue({});
    await RegistryService.deleteItem('2');
    expect(prisma.registryItem.delete).toHaveBeenCalledWith({ where: { id: '2' } });
  });
});
