import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

export function sanitizeSnapshotPayload(data: any): any {
  if (data === null || data === undefined) return data;
  if (data instanceof Date) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeSnapshotPayload);
  }

  const result: Record<string, any> = { ...data };

  // Strip email if present
  if ('email' in result) {
    delete result.email;
  }

  // Mask purchaserName if present
  if ('purchaserName' in result && result.purchaserName) {
    result.purchaserName = 'Anonymous';
  }

  // Mask contributors array if present
  if ('contributors' in result && Array.isArray(result.contributors)) {
    result.contributors = result.contributors.map((c: any) => {
      if (typeof c === 'object' && c !== null) {
        const item = { ...c };
        delete item.email;
        return {
          ...item,
          name: 'Anonymous',
        };
      }
      return c;
    });
  }

  // If object represents a standalone contributor record
  if ('name' in result && ('amount' in result || 'registryItemId' in result || 'isPlusOne' in result)) {
    result.name = 'Anonymous';
  }

  // Recursively sanitize all nested objects
  for (const key of Object.keys(result)) {
    if (key !== 'contributors' && typeof result[key] === 'object' && result[key] !== null) {
      if (!(result[key] instanceof Date)) {
        result[key] = sanitizeSnapshotPayload(result[key]);
      }
    }
  }

  return result;
}

export function sanitizeAuthor(author?: string): string {
  if (!author) return 'System';

  if (author.includes('@') || author === 'Guest' || author === 'Contributor' || author === 'Guest/Contributor' || author === 'Guest/User') {
    return 'Anonymous';
  }

  return author;
}

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

  const sanitizedData = sanitizeSnapshotPayload(data);
  const sanitizedAuthor = sanitizeAuthor(author);
  
  // Create the snapshot
  await client.snapshotVersion.create({
    data: {
      entityType: normalizedType,
      entityId,
      data: sanitizedData,
      author: sanitizedAuthor,
    },
  });

  // Execute non-blocking retention management routines
  void pruneSnapshots(normalizedType, entityId);
  void purgeOrphanedContributors();
}

async function pruneSnapshots(entityType: string, entityId: string) {
  try {
    const limit = env.HISTORY_VERSION_LIMIT;
    
    // Find all versions ordered by createdAt DESC
    const snapshots = await prisma.snapshotVersion.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      // We only need ids after the limit
      skip: limit,
    });

    if (snapshots && snapshots.length > 0) {
      const idsToDelete = snapshots.map(s => s.id);
      await prisma.snapshotVersion.deleteMany({
        where: { id: { in: idsToDelete } }
      });
    }
  } catch (err) {
    logger.error('Error during snapshot pruning:', err);
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

export async function purgeOrphanedContributors() {
  try {
    await prisma.contributor.deleteMany({
      where: {
        OR: [
          { registryItemId: null },
          {
            registryItem: {
              is: null,
            },
          },
        ],
      },
    });
  } catch (err: any) {
    if (!err?.message?.includes('database is locked')) {
      logger.error('Error during orphaned contributor purging:', err);
    }
  }
}
