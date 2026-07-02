import { ImportBackupSchema } from "@/utils/validation";
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { createAuditSnapshot } from '@/lib/audit';

function reviveDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(obj)) {
    return new Date(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(reviveDates);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = reviveDates(obj[key]);
    }
    return res;
  }
  return obj;
}

export const POST = withApiMiddleware(async (_request: NextRequest) => {
  const rawData = await request.json();
  ImportBackupSchema.parse(rawData);
  const data = reviveDates(rawData);

  if (!data.appConfig || !data.registryItem) {
    throw new ApiError(400, 'Invalid backup file structure');
  }

  await prisma.$transaction(async (tx) => {
    await tx.contributor.deleteMany();
    await tx.registryItem.deleteMany();
    await tx.attraction.deleteMany();
    await tx.weddingPartyMember.deleteMany();
    await tx.contentNode.deleteMany();
    await tx.appConfig.deleteMany();
    
    // We intentionally DO NOT delete snapshotVersion here, so history is retained across imports.
    // Also we don't import snapshotVersion from the backup (to avoid duplicating history).

    if (data.appConfig?.length) await tx.appConfig.createMany({ data: data.appConfig });
    if (data.contentNode?.length) await tx.contentNode.createMany({ data: data.contentNode });
    if (data.weddingPartyMember?.length) await tx.weddingPartyMember.createMany({ data: data.weddingPartyMember });
    if (data.attraction?.length) await tx.attraction.createMany({ data: data.attraction });
    if (data.registryItem?.length) await tx.registryItem.createMany({ data: data.registryItem });
    
    if (data.contributor?.length) await tx.contributor.createMany({ data: data.contributor });
  });

  // Track mass changes in background
  void (async () => {
    try {
      if (data.appConfig?.length) {
        for (const item of data.appConfig) {
          await createAuditSnapshot('AppConfig', item.id, item, 'Admin/BulkImport');
        }
      }
      if (data.contentNode?.length) {
        for (const item of data.contentNode) {
          await createAuditSnapshot('ContentNode', item.id, item, 'Admin/BulkImport');
        }
      }
      if (data.weddingPartyMember?.length) {
        for (const item of data.weddingPartyMember) {
          await createAuditSnapshot('WeddingPartyMember', item.id, item, 'Admin/BulkImport');
        }
      }
      if (data.attraction?.length) {
        for (const item of data.attraction) {
          await createAuditSnapshot('Attraction', item.id, item, 'Admin/BulkImport');
        }
      }
      if (data.registryItem?.length) {
        for (const item of data.registryItem) {
          await createAuditSnapshot('RegistryItem', item.id, item, 'Admin/BulkImport');
        }
      }
    } catch (e) {
      console.error('Error during bulk import audit snapshot creation:', e);
    }
  })();

  return NextResponse.json({ success: true });
});
