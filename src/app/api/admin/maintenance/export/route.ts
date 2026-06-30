import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const [
    appConfig,
    contentNode,
    weddingPartyMember,
    attraction,
    registryItem,
    contributor,
    snapshotVersion
  ] = await Promise.all([
    prisma.appConfig.findMany(),
    prisma.contentNode.findMany(),
    prisma.weddingPartyMember.findMany(),
    prisma.attraction.findMany(),
    prisma.registryItem.findMany(),
    prisma.contributor.findMany(),
    prisma.snapshotVersion.findMany()
  ]);

  const data = {
    appConfig,
    contentNode,
    weddingPartyMember,
    attraction,
    registryItem,
    contributor,
    snapshotVersion
  };

  return new NextResponse(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="wedding-backup-${new Date().toISOString().split('T')[0]}.json"`
    }
  });
});
