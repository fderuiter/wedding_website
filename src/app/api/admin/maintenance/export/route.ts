import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { encryptBackupData } from '@/utils/backupEncryption';
import { createAuditSnapshot } from '@/lib/audit';
import { logger } from '@/lib/logger';

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const requestingUser = 'Admin';
  const timestamp = new Date().toISOString();
  const exportScope = 'full';

  const [
    appConfig,
    contentNode,
    media,
    weddingPartyMember,
    attraction,
    registryItem,
    contributor,
    snapshotVersion
  ] = await Promise.all([
    prisma.appConfig.findMany(),
    prisma.contentNode.findMany(),
    prisma.media.findMany(),
    prisma.weddingPartyMember.findMany(),
    prisma.attraction.findMany(),
    prisma.registryItem.findMany(),
    prisma.contributor.findMany(),
    prisma.snapshotVersion.findMany()
  ]);

  const rawData = {
    appConfig,
    contentNode,
    media,
    weddingPartyMember,
    attraction,
    registryItem,
    contributor,
    snapshotVersion
  };

  const encryptedPayload = encryptBackupData(rawData);

  // Verifiable administrative access audit log
  await createAuditSnapshot(
    'SystemBackup',
    `export-${Date.now()}`,
    { scope: exportScope, timestamp, requestingUser },
    requestingUser
  );

  logger.info('System backup export generated', {
    timestamp,
    requestingUser,
    scope: exportScope,
  });

  return new NextResponse(JSON.stringify(encryptedPayload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="wedding-backup-${timestamp.split('T')[0]}.json"`
    }
  });
});
