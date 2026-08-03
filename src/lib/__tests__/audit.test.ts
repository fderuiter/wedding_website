/**
 * @jest-environment node
 */

import { reviveDates } from '@/app/api/admin/maintenance/import/route';
import { pruneSnapshotsBulk } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    snapshotVersion: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as any;

describe('High-Throughput Safe Backup Import Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      // Build a 100-level deeply nested object
      const levels = 100;
      let root: any = { createdAt: '2026-08-03T10:00:00.000Z' };
      for (let i = 0; i < levels; i++) {
        root = { child: root };
      }

      // Should not throw RangeError: Maximum call stack size exceeded
      let revived: any;
      expect(() => {
        revived = reviveDates(root);
      }).not.toThrow();

      // Traverse down to verify the leaf was revived
      let current = revived;
      for (let i = 0; i < levels; i++) {
        current = current.child;
      }
      expect(current.createdAt).toBeInstanceOf(Date);
      expect(current.createdAt.toISOString()).toBe('2026-08-03T10:00:00.000Z');
    });
  });

  describe('pruneSnapshotsBulk - High-Performance Bulk Audit Pruning', () => {
    it('correctly retrieves and groups snapshots, then issues a single deleteMany query for expired versions', async () => {
      const entities = [
        { entityType: 'AppConfig', entityId: 'global' },
        { entityType: 'RegistryItem', entityId: 'ri1' },
      ];

      // Simulate snapshot query results (ordered by entityType, entityId, createdAt desc)
      // HISTORY_VERSION_LIMIT defaults to 50. So let's mock 52 versions for 'global' and 51 for 'ri1'
      const mockSnapshots: any[] = [];
      
      // 52 snapshots for AppConfig:global
      for (let i = 0; i < 52; i++) {
        mockSnapshots.push({
          id: `app-config-id-${i}`,
          entityType: 'AppConfig',
          entityId: 'global',
        });
      }
      // 51 snapshots for RegistryItem:ri1
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

      // Verify read query
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
        ],
        select: { id: true, entityType: true, entityId: true },
      });

      // Verify deletion query
      // The first 50 of each group are kept. The rest should be deleted.
      // AppConfig: 'app-config-id-50', 'app-config-id-51' (2 expired)
      // RegistryItem: 'registry-item-id-50' (1 expired)
      expect(mockPrisma.snapshotVersion.deleteMany).toHaveBeenCalled();
      const deleteArgs = mockPrisma.snapshotVersion.deleteMany.mock.calls[0][0];
      expect(deleteArgs.where.id.in).toContain('app-config-id-50');
      expect(deleteArgs.where.id.in).toContain('app-config-id-51');
      expect(deleteArgs.where.id.in).toContain('registry-item-id-50');
      expect(deleteArgs.where.id.in.length).toBe(3);
    });

    it('does not trigger deleteMany if no snapshots exceed the retention limit', async () => {
      const entities = [
        { entityType: 'AppConfig', entityId: 'global' },
      ];

      const mockSnapshots = [
        { id: '1', entityType: 'AppConfig', entityId: 'global' },
        { id: '2', entityType: 'AppConfig', entityId: 'global' },
      ];

      mockPrisma.snapshotVersion.findMany.mockResolvedValue(mockSnapshots);

      await pruneSnapshotsBulk(entities);

      expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalled();
      expect(mockPrisma.snapshotVersion.deleteMany).not.toHaveBeenCalled();
    });
  });
});
