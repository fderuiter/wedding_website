import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicAppConfig } from '@/lib/config';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const url = new URL(request.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');

  const where: any = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  const versions = await prisma.snapshotVersion.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });

  const sanitizedVersions = versions.map(v => {
    if (v.entityType === 'AppConfig') {
      return {
        ...v,
        data: toPublicAppConfig(v.data as any)
      };
    }
    return v;
  });

  return NextResponse.json(sanitizedVersions);
});
