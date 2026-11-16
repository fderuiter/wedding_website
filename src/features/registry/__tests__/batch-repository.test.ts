/** @jest-environment node */

import { createRegistryRepository } from '../repository';

describe('RegistryRepository createBatchItems transaction atomicity', () => {
  it('rolls back all insertions if an item in the batch fails', async () => {
    const mockTxClient = {
      media: {
        create: jest.fn().mockResolvedValue({ id: 'media-1', url: '/images/item.png' }),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      },
      registryItem: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'item-1',
            name: 'Item 1',
            price: 50,
            quantity: 1,
            category: 'Kitchen',
            description: '',
            imageId: 'media-1',
            vendorUrl: null,
            isGroupGift: false,
            isMostWanted: false,
            displayOrder: 0,
            purchased: false,
            amountContributed: 0,
            contributors: [],
          })
          .mockRejectedValueOnce(new Error('Simulated database write failure')),
      },
    };

    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockTxClient);
      }),
    };

    const repository = createRegistryRepository(mockPrisma);

    await expect(
      repository.createBatchItems([
        { name: 'Item 1', price: 50, category: 'Kitchen' },
        { name: 'Item 2', price: 100, category: 'Kitchen' },
      ])
    ).rejects.toThrow('Simulated database write failure');

    // Verify $transaction was used to wrap the batch operation
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTxClient.registryItem.create).toHaveBeenCalledTimes(2);
  });

  it('persists all items in transaction when all are valid', async () => {
    const mockTxClient = {
      media: {
        create: jest.fn().mockResolvedValue({ id: 'media-1', url: '/images/placeholder.png' }),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      },
      registryItem: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `item-${data.name}`,
          ...data,
          purchased: false,
          amountContributed: 0,
          contributors: [],
        })),
      },
    };

    const mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockTxClient);
      }),
    };

    const repository = createRegistryRepository(mockPrisma);

    const created = await repository.createBatchItems([
      { name: 'Item 1', price: 50, category: 'Kitchen' },
      { name: 'Item 2', price: 75, category: 'Kitchen' },
    ]);

    expect(created).toHaveLength(2);
    expect(created[0].name).toBe('Item 1');
    expect(created[1].name).toBe('Item 2');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
