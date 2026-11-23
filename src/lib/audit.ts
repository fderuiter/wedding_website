import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { deferAfterCommit } from '@/lib/transaction';

let microtaskPruneQueue: { entityType: string; entityId: string }[] = [];
let microtaskPruneScheduled = false;

function normalizeEntityType(entityType: string): string {
  return (
    Object.values(Prisma.ModelName).find(
      (name) => name.toLowerCase() === entityType.toLowerCase()
    ) || entityType
  );
}

function scheduleSnapshotPrune(entities: { entityType: string; entityId: string }[]): void {
  if (entities.length === 0) return;
  microtaskPruneQueue.push(...entities);
  if (!microtaskPruneScheduled) {
    microtaskPruneScheduled = true;
    void Promise.resolve().then(() => {
      const batch = microtaskPruneQueue;
      microtaskPruneQueue = [];
      microtaskPruneScheduled = false;
      void pruneSnapshotsBulk(batch);
    });
  }
}

function enqueueSnapshotPrune(
  entities: { entityType: string; entityId: string }[],
  txClient?: unknown
): void {
  if (entities.length === 0) return;

  if (deferAfterCommit(txClient, () => scheduleSnapshotPrune(entities))) {
    return;
  }

  if (
    !txClient ||
    txClient === prisma ||
    (typeof txClient === 'object' && '$transaction' in txClient)
  ) {
    scheduleSnapshotPrune(entities);
  }
}

export async function createAuditSnapshot(
  entityType: string,
  entityId: string,
  data: any,
  author: string = 'System',
  txClient?: any
) {
  const client = txClient || prisma;

  const normalizedType = normalizeEntityType(entityType);

  // Create the snapshot
  await client.snapshotVersion.create({
    data: {
      entityType: normalizedType,
      entityId,
      data,
      author,
    },
  });

  if (entityId) {
    enqueueSnapshotPrune([{ entityType: normalizedType, entityId }], txClient);
  }
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

  const normalizedType = normalizeEntityType(entityType);

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
    enqueueSnapshotPrune(entitiesToPrune, txClient);
  }
}

export async function pruneSnapshotsBulk(entities: { entityType: string; entityId: string }[]) {
  try {
    if (!entities || entities.length === 0) return;

    // Get unique pairs and normalize entityType
    const uniquePairsMap = new Map<string, { entityType: string; entityId: string }>();
    for (const item of entities) {
      if (!item || !item.entityType || !item.entityId) continue;
      const normalizedType = normalizeEntityType(item.entityType);
      const key = `${normalizedType}:${item.entityId}`;
      uniquePairsMap.set(key, { entityType: normalizedType, entityId: item.entityId });
    }
    const uniqueEntityPairs = Array.from(uniquePairsMap.values());
    if (uniqueEntityPairs.length === 0) return;

    const limit = env.HISTORY_VERSION_LIMIT;

    const rawExecutor = (prisma as { $executeRaw?: typeof prisma.$executeRaw }).$executeRaw;
    if (typeof rawExecutor === 'function') {
      const entityTypes = uniqueEntityPairs.map((pair) => pair.entityType);
      const entityIds = uniqueEntityPairs.map((pair) => pair.entityId);

      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "SnapshotVersion" AS sv
        USING (
          SELECT ranked."id"
          FROM (
            SELECT
              s."id",
              ROW_NUMBER() OVER (
                PARTITION BY "entityType", "entityId"
                ORDER BY "createdAt" DESC, "id" DESC
              ) AS rn
            FROM UNNEST(${entityTypes}::text[], ${entityIds}::text[]) AS target(entity_type, entity_id)
            JOIN "SnapshotVersion" AS s
              ON s."entityType" = target.entity_type
             AND s."entityId" = target.entity_id
          ) AS ranked
          WHERE ranked.rn > ${limit}
        ) AS expired
        WHERE sv."id" = expired."id"
      `);
      return;
    }

    if (typeof prisma.snapshotVersion?.findMany !== 'function') {
      return;
    }

    // Fallback for mocked Prisma clients that omit $executeRaw
    const snapshots = await prisma.snapshotVersion.findMany({
      where: {
        OR: uniqueEntityPairs.map((p) => ({ entityType: p.entityType, entityId: p.entityId })),
      },
      orderBy: [
        { entityType: 'asc' },
        { entityId: 'asc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      select: { id: true, entityType: true, entityId: true },
    });

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
        const expiredIds = ids.slice(limit);
        idsToDelete.push(...expiredIds);
      }
    }

    if (idsToDelete.length > 0 && typeof prisma.snapshotVersion?.deleteMany === 'function') {
      await prisma.snapshotVersion.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }
  } catch (err) {
    logger.error('Error during bulk snapshot pruning:', err);
  }
}
