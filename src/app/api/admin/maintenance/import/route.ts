import { ImportBackupSchema } from '@/utils/validation';
import { DatabaseBackupSchema, formatZodError } from '@/utils/backupValidation';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { pruneSnapshotsBulk } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { decryptBackupData } from '@/utils/backupEncryption';

export function reviveDates(root: any): any {
  if (root === null || root === undefined) return root;
  if (typeof root === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(root)) {
    return new Date(root);
  }
  if (typeof root !== 'object') {
    return root;
  }

  const stack: any[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === null || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const val = current[i];
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(val)) {
          current[i] = new Date(val);
        } else if (val !== null && typeof val === 'object') {
          stack.push(val);
        }
      }
    } else {
      for (const key of Object.keys(current)) {
        const val = current[key];
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(val)) {
          current[key] = new Date(val);
        } else if (val !== null && typeof val === 'object') {
          stack.push(val);
        }
      }
    }
  }

  return root;
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const rawData = await request.json();
  const decryptedData = decryptBackupData(rawData);
  ImportBackupSchema.parse(decryptedData);
  const data = reviveDates(decryptedData);

  if (!data.appConfig || !data.registryItem) {
    throw new ApiError(400, 'Invalid backup file structure');
  }

  try {
    DatabaseBackupSchema.parse(data);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, `Validation Error: ${formatZodError(err)}`);
    }
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await tx.contributor.deleteMany();
    await tx.registryItem.deleteMany();
    await tx.attraction.deleteMany();
    await tx.weddingPartyMember.deleteMany();
    await tx.media.deleteMany();
    await tx.contentNode.deleteMany();
    await tx.appConfig.deleteMany();
    
    // We intentionally DO NOT delete snapshotVersion here, so history is retained across imports.
    // Also we don't import snapshotVersion from the backup (to avoid duplicating history).

    if (data.appConfig?.length) await tx.appConfig.createMany({ data: data.appConfig });
    if (data.contentNode?.length) await tx.contentNode.createMany({ data: data.contentNode });
    if (data.media?.length) await tx.media.createMany({ data: data.media });
    if (data.weddingPartyMember?.length) await tx.weddingPartyMember.createMany({ data: data.weddingPartyMember });
    if (data.attraction?.length) await tx.attraction.createMany({ data: data.attraction });
    if (data.registryItem?.length) await tx.registryItem.createMany({ data: data.registryItem });
    
    if (data.contributor?.length) await tx.contributor.createMany({ data: data.contributor });
  });

  // Track mass changes in background
  void (async () => {
    try {
      const snapshotsToCreate: any[] = [];
      const entitiesToPrune: { entityType: string; entityId: string }[] = [];

      if (data.appConfig?.length) {
        for (const item of data.appConfig) {
          snapshotsToCreate.push({
            entityType: 'AppConfig',
            entityId: item.id,
            data: item,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType: 'AppConfig', entityId: item.id });
        }
      }
      if (data.contentNode?.length) {
        for (const item of data.contentNode) {
          snapshotsToCreate.push({
            entityType: 'ContentNode',
            entityId: item.id,
            data: item,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType: 'ContentNode', entityId: item.id });
        }
      }
      if (data.weddingPartyMember?.length) {
        for (const item of data.weddingPartyMember) {
          snapshotsToCreate.push({
            entityType: 'WeddingPartyMember',
            entityId: item.id,
            data: item,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType: 'WeddingPartyMember', entityId: item.id });
        }
      }
      if (data.attraction?.length) {
        for (const item of data.attraction) {
          snapshotsToCreate.push({
            entityType: 'Attraction',
            entityId: item.id,
            data: item,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType: 'Attraction', entityId: item.id });
        }
      }
      if (data.registryItem?.length) {
        for (const item of data.registryItem) {
          snapshotsToCreate.push({
            entityType: 'RegistryItem',
            entityId: item.id,
            data: item,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType: 'RegistryItem', entityId: item.id });
        }
      }

      if (snapshotsToCreate.length > 0) {
        await prisma.snapshotVersion.createMany({ data: snapshotsToCreate });
        await pruneSnapshotsBulk(entitiesToPrune);
      }
    } catch (e) {
      logger.error('Error during bulk import audit snapshot creation:', e);
    }
  })();

  return NextResponse.json({ success: true });
});
