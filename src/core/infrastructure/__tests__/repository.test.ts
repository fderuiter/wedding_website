/** @jest-environment node */

import { BaseRepository } from '../repository';

describe('BaseRepository', () => {
  let mockClient: any;
  let repo: BaseRepository<{ id: string; name?: string; order?: number }>;

  beforeEach(() => {
    mockClient = {
      testModel: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(async (input: any) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }
        if (typeof input === 'function') {
          return input(mockClient);
        }
        return input;
      }),
    };

    repo = new BaseRepository('testModel', mockClient);
    jest.clearAllMocks();
  });

  describe('reorder', () => {
    it('should batch entity updates into client.$transaction array', async () => {
      const orderedIds = ['id-1', 'id-2', 'id-3'];
      const result = await repo.reorder(orderedIds);

      expect(mockClient.testModel.update).toHaveBeenCalledTimes(3);
      expect(mockClient.testModel.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'id-1' },
        data: { order: 0 },
      });
      expect(mockClient.testModel.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'id-2' },
        data: { order: 1 },
      });
      expect(mockClient.testModel.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'id-3' },
        data: { order: 2 },
      });

      expect(mockClient.$transaction).toHaveBeenCalledTimes(1);
      expect(mockClient.$transaction).toHaveBeenCalledWith(expect.any(Array));
      expect(result).toEqual([
        { id: 'id-1', order: 0 },
        { id: 'id-2', order: 1 },
        { id: 'id-3', order: 2 },
      ]);
    });

    it('should return empty array immediately when orderedIds is empty without calling database', async () => {
      const result = await repo.reorder([]);

      expect(result).toEqual([]);
      expect(mockClient.testModel.update).not.toHaveBeenCalled();
      expect(mockClient.$transaction).not.toHaveBeenCalled();
    });

    it('should fall back to Promise.all if client.$transaction is undefined', async () => {
      const clientWithoutTx = {
        testModel: {
          update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        },
      };
      const repoWithoutTx = new BaseRepository('testModel', clientWithoutTx);

      const result = await repoWithoutTx.reorder(['id-a', 'id-b']);

      expect(clientWithoutTx.testModel.update).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        { id: 'id-a', order: 0 },
        { id: 'id-b', order: 1 },
      ]);
    });

    it('should reject and roll back when client.$transaction fails', async () => {
      mockClient.$transaction.mockRejectedValueOnce(new Error('Record to update not found'));

      await expect(repo.reorder(['id-1', 'invalid-id'])).rejects.toThrow(
        'Record to update not found'
      );
    });
  });
});
