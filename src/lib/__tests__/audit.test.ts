/**
 * @jest-environment node
 */

import { reviveDates } from '@/app/api/admin/maintenance/import/route';
import { createAuditSnapshot, createBatchAuditSnapshots, pruneSnapshotsBulk } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    snapshotVersion: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as any;

async function flushDeferredPruning(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('High-Throughput Safe Backup Import & Audit Pruning Utilities', () => {
  const originalLimit = process.env.HISTORY_VERSION_LIMIT;
  let defaultExecuteRawMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    if (originalLimit === undefined) {
      delete process.env.HISTORY_VERSION_LIMIT;
    } else {
      process.env.HISTORY_VERSION_LIMIT = originalLimit;
    }
    defaultExecuteRawMock = jest.fn().mockResolvedValue(0);
    mockPrisma.$executeRaw = defaultExecuteRawMock;
    delete mockPrisma.$transaction;
    mockPrisma.snapshotVersion.create.mockResolvedValue({ id: 'snap-default' });
    mockPrisma.snapshotVersion.findMany.mockResolvedValue([]);
    mockPrisma.snapshotVersion.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.snapshotVersion.createMany.mockResolvedValue({ count: 0 });
  });

  afterAll(() => {
    if (originalLimit === undefined) {
      delete process.env.HISTORY_VERSION_LIMIT;
    } else {
      process.env.HISTORY_VERSION_LIMIT = originalLimit;
    }
  });

  describe('reviveDates - Iterative deep-traversal', () => {
    it('revives dates in shallow objects', () => {
      const obj = {
        name: 'test',
        createdAt: '2026-08-03T10:00:00.000Z',
      };
      const revived = reviveDates(obj);
      expect(revived.createdAt).toBeInstanceOf(Date);
      expect(revived.createdAt.toISOString()).toBe('2026-08-03T10:00:00.000Z');
    });

    it('successfully processes an extremely deeply nested object (100 levels) without blowing the call stack', () => {
      const levels = 100;
      let root: any = { createdAt: '2026-08-03T10:00:00.000Z' };
      for (let i = 0; i < levels; i++) {
        root = { child: root };
      }

      let revived: any;
      expect(() => {
        revived = reviveDates(root);
      }).not.toThrow();

      let current = revived;
      for (let i = 0; i < levels; i++) {
        current = current.child;
      }
      expect(current.createdAt).toBeInstanceOf(Date);
      expect(current.createdAt.toISOString()).toBe('2026-08-03T10:00:00.000Z');
    });
  });

  describe('pruneSnapshotsBulk - PostgreSQL Window DELETE & Mock Fallback', () => {
    it('executes a single parameterized DELETE ... USING window query via $executeRaw with UNNEST and ROW_NUMBER()', async () => {
      process.env.HISTORY_VERSION_LIMIT = '25';
      mockPrisma.$executeRaw.mockResolvedValueOnce(12);

      await pruneSnapshotsBulk([
        { entityType: 'appconfig', entityId: 'global' },
        { entityType: 'RegistryItem', entityId: 'ri1' },
        { entityType: 'AppConfig', entityId: 'global' }, // duplicate should be deduplicated
      ]);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.snapshotVersion.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.snapshotVersion.deleteMany).not.toHaveBeenCalled();

      const sqlArg = mockPrisma.$executeRaw.mock.calls[0][0];
      const normalizedSql = sqlArg.strings.join('?').replace(/\s+/g, ' ').trim();

      expect(normalizedSql).toContain('DELETE FROM "SnapshotVersion"');
      expect(normalizedSql).toContain('USING');
      expect(normalizedSql).toContain('UNNEST');
      expect(normalizedSql).toContain(
        'ROW_NUMBER() OVER ( PARTITION BY "entityType", "entityId" ORDER BY "createdAt" DESC, "id" DESC )'
      );
      expect(sqlArg.values).toEqual([['AppConfig', 'RegistryItem'], ['global', 'ri1'], 25]);
    });

    it('returns early without querying when entities array is empty', async () => {
      await pruneSnapshotsBulk([]);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.snapshotVersion.findMany).not.toHaveBeenCalled();
    });

    it('falls back to mocked findMany and deleteMany when prisma.$executeRaw is omitted', async () => {
      delete mockPrisma.$executeRaw;

      const entities = [
        { entityType: 'AppConfig', entityId: 'global' },
        { entityType: 'RegistryItem', entityId: 'ri1' },
      ];

      const mockSnapshots: any[] = [];
      for (let i = 0; i < 52; i++) {
        mockSnapshots.push({
          id: `app-config-id-${i}`,
          entityType: 'AppConfig',
          entityId: 'global',
        });
      }
      for (let i = 0; i < 51; i++) {
        mockSnapshots.push({
          id: `registry-item-id-${i}`,
          entityType: 'RegistryItem',
          entityId: 'ri1',
        });
      }

      mockPrisma.snapshotVersion.findMany.mockResolvedValue(mockSnapshots);
      mockPrisma.snapshotVersion.deleteMany.mockResolvedValue({ count: 3 });

      await pruneSnapshotsBulk(entities);

      expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { entityType: 'AppConfig', entityId: 'global' },
            { entityType: 'RegistryItem', entityId: 'ri1' },
          ],
        },
        orderBy: [
          { entityType: 'asc' },
          { entityId: 'asc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        select: { id: true, entityType: true, entityId: true },
      });

      expect(mockPrisma.snapshotVersion.deleteMany).toHaveBeenCalledTimes(1);
      const deleteArgs = mockPrisma.snapshotVersion.deleteMany.mock.calls[0][0];
      expect(deleteArgs.where.id.in).toEqual([
        'app-config-id-50',
        'app-config-id-51',
        'registry-item-id-50',
      ]);
    });

    it('does not trigger deleteMany in fallback mode if no snapshots exceed the retention limit', async () => {
      delete mockPrisma.$executeRaw;

      mockPrisma.snapshotVersion.findMany.mockResolvedValue([
        { id: '1', entityType: 'AppConfig', entityId: 'global' },
        { id: '2', entityType: 'AppConfig', entityId: 'global' },
      ]);

      await pruneSnapshotsBulk([{ entityType: 'AppConfig', entityId: 'global' }]);

      expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.snapshotVersion.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('createAuditSnapshot - Deferred Single-Entity Pruning & txClient Isolation', () => {
    it('resolves without awaiting pruning and triggers deferred single-entity window pruning on prisma', async () => {
      let resolvePrune!: (_count: number) => void;
      mockPrisma.$executeRaw.mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolvePrune = resolve;
          })
      );
      mockPrisma.snapshotVersion.create.mockResolvedValue({ id: 'snap-1' });

      await createAuditSnapshot('registryitem', 'item-123', { name: 'Gift' }, 'Admin');

      expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledWith({
        data: {
          entityType: 'RegistryItem',
          entityId: 'item-123',
          data: { name: 'Gift' },
          author: 'Admin',
        },
      });

      await flushDeferredPruning();

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sqlArg = mockPrisma.$executeRaw.mock.calls[0][0];
      expect(sqlArg.values).toEqual([['RegistryItem'], ['item-123'], 50]);

      resolvePrune(1);
      await flushDeferredPruning();
    });

    it('isolates standalone uncommitted txClient without running premature pruning on prisma or txClient', async () => {
      const mockTx = {
        $executeRaw: jest.fn(),
        snapshotVersion: {
          create: jest.fn().mockResolvedValue({ id: 'snap-tx' }),
          findMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      };

      await createAuditSnapshot('RegistryItem', 'item-456', { name: 'Gift Tx' }, 'User', mockTx);
      await flushDeferredPruning();

      expect(mockTx.snapshotVersion.create).toHaveBeenCalledWith({
        data: {
          entityType: 'RegistryItem',
          entityId: 'item-456',
          data: { name: 'Gift Tx' },
          author: 'User',
        },
      });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.snapshotVersion.create).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('defers pruning through executeInTransaction until txClient commits on prisma and skips pruning on rollback', async () => {
      const mockTx = {
        $executeRaw: jest.fn(),
        snapshotVersion: {
          create: jest.fn().mockResolvedValue({ id: 'snap-tx-commit' }),
          createMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };

      mockPrisma.$transaction = jest.fn(async (cb: any) => cb(mockTx));

      const txResult = await executeInTransaction(mockPrisma, async (tx) => {
        await createAuditSnapshot('RegistryItem', 'item-1', { name: 'One' }, 'Admin', tx);
        await createBatchAuditSnapshots(
          'Contributor',
          [{ id: 'c-1', name: 'Alice' }],
          'Admin',
          tx
        );

        // Pruning must NOT execute while transaction is still uncommitted
        expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
        expect(mockTx.$executeRaw).not.toHaveBeenCalled();
        return 'committed';
      });

      expect(txResult).toBe('committed');
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();

      await flushDeferredPruning();

      // Coalesced post-commit pruning runs once on root prisma client
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sqlArg = mockPrisma.$executeRaw.mock.calls[0][0];
      expect(sqlArg.values).toEqual([
        ['RegistryItem', 'Contributor'],
        ['item-1', 'c-1'],
        50,
      ]);

      // Verify rollback discards queued post-commit pruning
      jest.clearAllMocks();
      await expect(
        executeInTransaction(mockPrisma, async (tx) => {
          await createAuditSnapshot('RegistryItem', 'item-rb', { name: 'Rollback' }, 'Admin', tx);
          throw new Error('Simulated transaction failure');
        })
      ).rejects.toThrow('Simulated transaction failure');

      await flushDeferredPruning();
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('createBatchAuditSnapshots - Transactional Batch Audit Snapshots', () => {
    it('returns early when records array is empty or undefined', async () => {
      await createBatchAuditSnapshots('Contributor', []);
      expect(mockPrisma.snapshotVersion.createMany).not.toHaveBeenCalled();

      await createBatchAuditSnapshots('Contributor', null as any);
      expect(mockPrisma.snapshotVersion.createMany).not.toHaveBeenCalled();

      await flushDeferredPruning();
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('creates snapshots in bulk using createMany, normalizes entityType, and schedules window pruning', async () => {
      mockPrisma.snapshotVersion.createMany.mockResolvedValue({ count: 2 });

      const records = [
        { id: 'c1', name: 'Alice', thankYouStatus: 'Sent' },
        { id: 'c2', name: 'Bob', thankYouStatus: 'Sent' },
      ];

      await createBatchAuditSnapshots('contributor', records, 'Admin');

      expect(mockPrisma.snapshotVersion.createMany).toHaveBeenCalledWith({
        data: [
          {
            entityType: 'Contributor',
            entityId: 'c1',
            data: records[0],
            author: 'Admin',
          },
          {
            entityType: 'Contributor',
            entityId: 'c2',
            data: records[1],
            author: 'Admin',
          },
        ],
      });

      await flushDeferredPruning();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$executeRaw.mock.calls[0][0].values).toEqual([
        ['Contributor', 'Contributor'],
        ['c1', 'c2'],
        50,
      ]);
    });

    it('uses custom txClient when passed without touching prisma prematurely', async () => {
      const customTxClient = {
        snapshotVersion: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };

      const records = [{ id: 'c1', name: 'Alice' }];

      await createBatchAuditSnapshots('Contributor', records, 'System', customTxClient);
      await flushDeferredPruning();

      expect(customTxClient.snapshotVersion.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.snapshotVersion.createMany).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
