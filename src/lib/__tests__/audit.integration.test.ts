/**
 * @jest-environment node
 */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createAuditSnapshot, pruneSnapshotsBulk } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { GET as getVersions } from '@/app/api/admin/versions/route';
import { GET as exportBackup } from '@/app/api/admin/maintenance/export/route';

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 25
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function readResponseJson<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  const raw = await res.json();
  if (
    raw &&
    typeof raw === 'object' &&
    'getReader' in raw &&
    typeof (raw as ReadableStream<Uint8Array>).getReader === 'function'
  ) {
    const reader = (raw as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as T;
  }
  return raw as T;
}

describe('Snapshot Pruning PostgreSQL Window Delete Integration', () => {
  const originalLimit = process.env.HISTORY_VERSION_LIMIT;

  beforeEach(async () => {
    if (originalLimit === undefined) {
      delete process.env.HISTORY_VERSION_LIMIT;
    } else {
      process.env.HISTORY_VERSION_LIMIT = originalLimit;
    }
    await prisma.snapshotVersion.deleteMany();
  });

  afterAll(async () => {
    if (originalLimit === undefined) {
      delete process.env.HISTORY_VERSION_LIMIT;
    } else {
      process.env.HISTORY_VERSION_LIMIT = originalLimit;
    }
    await prisma.snapshotVersion.deleteMany();
    await prisma.$disconnect();
    const globalState = globalThis as unknown as {
      prisma?: unknown;
      pgPool?: { end?: () => Promise<void> };
    };
    if (globalState.pgPool?.end) {
      await globalState.pgPool.end();
    }
    delete globalState.prisma;
    delete globalState.pgPool;
  });

  it('retains HISTORY_VERSION_LIMIT newest rows after calling createAuditSnapshot 65 times for one entity', async () => {
    process.env.HISTORY_VERSION_LIMIT = '50';

    for (let i = 1; i <= 65; i++) {
      await createAuditSnapshot('RegistryItem', 'item-single-65', { step: i }, 'Admin');
    }

    await waitForCondition(async () => {
      const count = await prisma.snapshotVersion.count({
        where: { entityType: 'RegistryItem', entityId: 'item-single-65' },
      });
      return count === 50;
    });

    const remaining = await prisma.snapshotVersion.findMany({
      where: { entityType: 'RegistryItem', entityId: 'item-single-65' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    expect(remaining).toHaveLength(50);
    const steps = remaining.map((row) => (row.data as { step: number }).step);
    expect(steps[0]).toBe(65);
    expect(steps[steps.length - 1]).toBe(16);
  });

  it('preserves up to HISTORY_VERSION_LIMIT committed versions when an interactive transaction rolls back', async () => {
    process.env.HISTORY_VERSION_LIMIT = '50';
    const baseMs = Date.now() - 100_000;

    await prisma.snapshotVersion.createMany({
      data: Array.from({ length: 50 }, (_, idx) => ({
        id: `committed-${String(idx + 1).padStart(3, '0')}`,
        entityType: 'ContentNode',
        entityId: 'node-rollback-test',
        data: { rev: idx + 1 },
        author: 'Admin',
        createdAt: new Date(baseMs + idx * 1000),
      })),
    });

    await expect(
      executeInTransaction(prisma, async (tx) => {
        for (let i = 51; i <= 60; i++) {
          await createAuditSnapshot(
            'ContentNode',
            'node-rollback-test',
            { rev: i },
            'Admin',
            tx
          );
        }
        throw new Error('Abort interactive transaction');
      })
    ).rejects.toThrow('Abort interactive transaction');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const surviving = await prisma.snapshotVersion.findMany({
      where: { entityType: 'ContentNode', entityId: 'node-rollback-test' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    expect(surviving).toHaveLength(50);
    expect(surviving[0].id).toBe('committed-050');
    expect(surviving[surviving.length - 1].id).toBe('committed-001');
  });

  it('prunes 500 entities x 80 versions in one DELETE with 3 parameters and 0 transferred rows, matching versions and export routes', async () => {
    process.env.HISTORY_VERSION_LIMIT = '50';

    const totalEntities = 500;
    const versionsPerEntity = 80;
    const baseMs = Date.UTC(2026, 5, 1, 0, 0, 0);

    const seedBatchSize = 5000;
    let buffer: any[] = [];
    const expectedIdsByEntity = new Map<string, string[]>();

    for (let e = 0; e < totalEntities; e++) {
      const entityId = `guest-bench-${String(e).padStart(3, '0')}`;
      const entityCreatedIds: string[] = [];
      for (let v = 0; v < versionsPerEntity; v++) {
        const id = `snap-${String(e).padStart(3, '0')}-${String(v).padStart(3, '0')}`;
        entityCreatedIds.push(id);
        buffer.push({
          id,
          entityType: 'InvitationCode',
          entityId,
          data: { versionIndex: v },
          author: 'BulkSeeder',
          createdAt: new Date(baseMs + v * 1000),
        });
        if (buffer.length >= seedBatchSize) {
          await prisma.snapshotVersion.createMany({ data: buffer });
          buffer = [];
        }
      }
      // Newest 50 are v = 79 down to v = 30
      expectedIdsByEntity.set(entityId, entityCreatedIds.slice(30).reverse());
    }
    if (buffer.length > 0) {
      await prisma.snapshotVersion.createMany({ data: buffer });
    }
    await prisma.$executeRawUnsafe('ANALYZE "SnapshotVersion"');

    const globalState = globalThis as unknown as { pgPool?: any };
    const pool = globalState.pgPool;
    const wireQueries: { text: string; paramCount: number; rowsTransferred: number }[] = [];
    const originalQuery = pool.query.bind(pool);
    pool.query = async (...args: any[]) => {
      const res = await originalQuery(...args);
      const first = args[0];
      const text = typeof first === 'string' ? first : first?.text || '';
      const values =
        typeof first === 'object' && first !== null && Array.isArray(first.values)
          ? first.values
          : Array.isArray(args[1])
            ? args[1]
            : [];
      wireQueries.push({
        text,
        paramCount: values.length,
        rowsTransferred: Array.isArray(res?.rows) ? res.rows.length : 0,
      });
      return res;
    };

    try {
      const entities = Array.from({ length: totalEntities }, (_, e) => ({
        entityType: 'InvitationCode',
        entityId: `guest-bench-${String(e).padStart(3, '0')}`,
      }));

      await pruneSnapshotsBulk(entities);
    } finally {
      pool.query = originalQuery;
    }

    const deleteQueries = wireQueries.filter((q) =>
      q.text.trim().toUpperCase().startsWith('DELETE')
    );
    expect(wireQueries).toHaveLength(1);
    expect(deleteQueries).toHaveLength(1);
    expect(deleteQueries[0].paramCount).toBe(3);
    expect(deleteQueries[0].rowsTransferred).toBe(0);

    const remainingTotal = await prisma.snapshotVersion.count();
    expect(remainingTotal).toBe(totalEntities * 50);

    // Verify GET /api/admin/versions returns the exact newest 50 IDs for a sample entity
    const sampleEntityId = 'guest-bench-042';
    const versionsReq = new NextRequest(
      `http://localhost/api/admin/versions?entityType=InvitationCode&entityId=${sampleEntityId}&limit=50`,
      { method: 'GET' }
    );
    const versionsRes = await getVersions(versionsReq, {});
    expect(versionsRes.status).toBe(200);
    const versionsPayload = await readResponseJson<{
      data?: { items: { id: string }[] };
      items?: { id: string }[];
    }>(versionsRes);
    const apiItems = versionsPayload.data?.items ?? versionsPayload.items ?? [];
    expect(apiItems).toHaveLength(50);
    expect(apiItems.map((item) => item.id)).toEqual(expectedIdsByEntity.get(sampleEntityId));

    // Trim down to 3 entities (150 snapshots) to quickly verify full streaming backup export IDs
    await prisma.snapshotVersion.deleteMany({
      where: {
        entityId: {
          notIn: ['guest-bench-000', 'guest-bench-001', 'guest-bench-042'],
        },
      },
    });

    const exportReq = new NextRequest('http://localhost/api/admin/maintenance/export', {
      method: 'GET',
    });
    const exportRes = await exportBackup(exportReq, {});
    expect(exportRes.status).toBe(200);
    const rawExport = await readResponseJson<{
      data?: { snapshotVersion: { id: string; entityId: string }[] };
      snapshotVersion?: { id: string; entityId: string }[];
    }>(exportRes);
    const exportSnapshots =
      rawExport.data?.snapshotVersion ?? rawExport.snapshotVersion ?? [];

    expect(exportSnapshots).toHaveLength(150);
    for (const checkId of ['guest-bench-000', 'guest-bench-001', 'guest-bench-042']) {
      const exportedIdsForEntity = exportSnapshots
        .filter((s) => s.entityId === checkId)
        .map((s) => s.id)
        .sort();
      const expectedSorted = [...(expectedIdsByEntity.get(checkId) ?? [])].sort();
      expect(exportedIdsForEntity).toEqual(expectedSorted);
    }
  }, 30000);
});
