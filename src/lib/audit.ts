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

  // Handle version limit & pruning asynchronously?
  // The constraints say: "Retention management must run as a maintenance process to avoid performance impact on primary data mutations."
  // And "Snapshot creation must not increase API response latency for guest users by more than 50ms."
  // If we run it without await, we save time. Wait, but the PR requirement says: "Retention management must run as a maintenance process to avoid performance impact on primary data mutations."
  // A standard way to run this in the background is to just not await the pruning promise, or have a separate bulk operation.
  // We can write a prune function here and trigger it via `void pruneSnapshots(...)`
  void pruneSnapshots(entityType, entityId);
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
