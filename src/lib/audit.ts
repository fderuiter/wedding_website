import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

export async function createAuditSnapshot(
  entityType: string,
  entityId: string,
  data: any,
  author: string = 'System',
  txClient?: any
) {
  const client = txClient || prisma;
  
  const normalizedType = Object.values(Prisma.ModelName).find(
    (name) => name.toLowerCase() === entityType.toLowerCase()
  ) || entityType;
  
  // Create the snapshot
  await client.snapshotVersion.create({
    data: {
      entityType: normalizedType,
      entityId,
      data,
      author,
    },
  });
}

export async function createBatchAuditSnapshots(
  entityType: string,
  records: any[],
  author: string = 'System',
  txClient?: any
) {
  if (!records || records.length === 0) {
    return;
  }

  const client = txClient || prisma;

  const normalizedType = Object.values(Prisma.ModelName).find(
    (name) => name.toLowerCase() === entityType.toLowerCase()
  ) || entityType;

  const snapshots = records.map((record) => {
    const entityId = record.id || record.entityId;
    const data =
      record.data !== undefined && record.entityId !== undefined && record.id === undefined
        ? record.data
        : record;
    return {
      entityType: normalizedType,
      entityId,
      data,
      author,
    };
  });

  await client.snapshotVersion.createMany({
    data: snapshots,
  });

  const entitiesToPrune = records
    .map((record) => ({
      entityType: normalizedType,
      entityId: record.id || record.entityId,
    }))
    .filter((item) => Boolean(item.entityId));

  if (entitiesToPrune.length > 0) {
    void pruneSnapshotsBulk(entitiesToPrune);
  }
}

export async function pruneSnapshotsBulk(entities: { entityType: string; entityId: string }[]) {
  try {
    if (entities.length === 0) return;

    // Get unique pairs and normalize entityType
    const uniquePairsMap = new Map<string, { entityType: string; entityId: string }>();
    for (const item of entities) {
      const normalizedType = Object.values(Prisma.ModelName).find(
        (name) => name.toLowerCase() === item.entityType.toLowerCase()
      ) || item.entityType;
      const key = `${normalizedType}:${item.entityId}`;
      uniquePairsMap.set(key, { entityType: normalizedType, entityId: item.entityId });
    }
    const uniqueEntityPairs = Array.from(uniquePairsMap.values());

    const limit = env.HISTORY_VERSION_LIMIT;

    // Retrieve all snapshots for all unique entities in a single, ordered query
    const snapshots = await prisma.snapshotVersion.findMany({
      where: {
        OR: uniqueEntityPairs.map(p => ({ entityType: p.entityType, entityId: p.entityId }))
      },
      orderBy: [
        { entityType: 'asc' },
        { entityId: 'asc' },
        { createdAt: 'desc' }
      ],
      select: { id: true, entityType: true, entityId: true }
    });

    // Group snapshots by (entityType, entityId) in memory to determine which IDs exceed the limit
    if (!snapshots || snapshots.length === 0) return;

    const grouped = new Map<string, string[]>();
    for (const s of snapshots) {
      const key = `${s.entityType}:${s.entityId}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(s.id);
    }

    const idsToDelete: string[] = [];
    for (const ids of grouped.values()) {
      if (ids.length > limit) {
        // Since orderBy has createdAt DESC, the first limit items are the newest ones, and we delete the ones beyond the limit
        const expiredIds = ids.slice(limit);
        idsToDelete.push(...expiredIds);
      }
    }

    if (idsToDelete.length > 0) {
      await prisma.snapshotVersion.deleteMany({
        where: { id: { in: idsToDelete } }
      });
    }
  } catch (err) {
    logger.error('Error during bulk snapshot pruning:', err);
  }
}
