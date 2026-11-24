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

    it('should execute one parameterized UPDATE FROM VALUES query via $executeRaw for Prisma models', async () => {
      const mockExecuteRaw = jest.fn().mockResolvedValue(3);
      const mockUpdate = jest.fn();
      const rawClient: any = {
        weddingPartyMember: {
          update: mockUpdate,
        },
        $executeRaw: mockExecuteRaw,
        $transaction: jest.fn(async (cb: any) => cb(rawClient)),
      };
      const partyRepo = new BaseRepository<{ id: string; order: number }>(
        'weddingPartyMember',
        rawClient
      );

      const result = await partyRepo.reorder(['m-3', 'm-1', 'm-2']);

      expect(rawClient.$transaction).toHaveBeenCalledTimes(1);
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();

      const sqlArg = mockExecuteRaw.mock.calls[0][0];
      const normalizedSql = sqlArg.strings.join('?').replace(/\s+/g, ' ').trim();

      expect(normalizedSql).toContain('UPDATE "public"."WeddingPartyMember" AS t');
      expect(normalizedSql).toContain('SET "order" = v."order", "updatedAt" = NOW()');
      expect(normalizedSql).toContain('FROM (VALUES (?::text, ?::integer), (?::text, ?::integer), (?::text, ?::integer)) AS v("id", "order")');
      expect(normalizedSql).toContain('WHERE t."id" = v."id"');
      expect(sqlArg.values).toEqual(['m-3', 0, 'm-1', 1, 'm-2', 2]);
      expect(result).toEqual([
        { id: 'm-3', order: 0 },
        { id: 'm-1', order: 1 },
        { id: 'm-2', order: 2 },
      ]);
    });

    it('should support displayOrder column, deduplicate orderedIds to last index, and skip count check on undefined stub return', async () => {
      const mockExecuteRaw = jest.fn(); // bare stub returning undefined
      const rawClient: any = {
        registryItem: {
          update: jest.fn(),
        },
        $executeRaw: mockExecuteRaw,
        $transaction: jest.fn(async (cb: any) => cb(rawClient)),
      };
      const registryRepo = new BaseRepository<{ id: string; displayOrder: number }>(
        'registryItem',
        rawClient
      );

      const result = await registryRepo.reorder(['g-1', 'g-2', 'g-1'], 'displayOrder');

      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
      const sqlArg = mockExecuteRaw.mock.calls[0][0];
      const normalizedSql = sqlArg.strings.join('?').replace(/\s+/g, ' ').trim();

      expect(normalizedSql).toContain('UPDATE "public"."RegistryItem" AS t');
      expect(normalizedSql).toContain('SET "displayOrder" = v."displayOrder", "updatedAt" = NOW()');
      expect(normalizedSql).toContain('AS v("id", "displayOrder")');
      expect(sqlArg.values).toEqual(['g-1', 2, 'g-2', 1]);
      expect(result).toEqual([
        { id: 'g-1', displayOrder: 2 },
        { id: 'g-2', displayOrder: 1 },
      ]);
    });

    it('should reject inside transaction when $executeRaw matches fewer rows than unique orderedIds', async () => {
      const mockExecuteRaw = jest.fn().mockResolvedValue(1);
      const rawClient: any = {
        weddingPartyMember: {
          update: jest.fn(),
        },
        $executeRaw: mockExecuteRaw,
        $transaction: jest.fn(async (cb: any) => cb(rawClient)),
      };
      const partyRepo = new BaseRepository('weddingPartyMember', rawClient);

      await expect(partyRepo.reorder(['m-1', 'missing-id'])).rejects.toThrow(
        'Record to update not found'
      );
      expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    });

    it('should fall back to model.update for Prisma models when $executeRaw is absent and reject unsupported columns', async () => {
      const fallbackUpdate = jest.fn((args: any) =>
        Promise.resolve({ id: args.where.id, ...args.data })
      );
      const fallbackClient = {
        registryItem: {
          update: fallbackUpdate,
        },
        $transaction: jest.fn(async (ops: any) => Promise.all(ops)),
      };
      const registryRepo = new BaseRepository('registryItem', fallbackClient);

      const result = await registryRepo.reorder(['g-2', 'g-1'], 'displayOrder');

      expect(fallbackUpdate).toHaveBeenCalledTimes(2);
      expect(fallbackUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: 'g-2' },
        data: { displayOrder: 0 },
      });
      expect(result).toEqual([
        { id: 'g-2', displayOrder: 0 },
        { id: 'g-1', displayOrder: 1 },
      ]);

      await expect(
        registryRepo.reorder(['g-1'], 'invalidColumn' as any)
      ).rejects.toThrow('Invalid reorder column');
    });
  });
});
