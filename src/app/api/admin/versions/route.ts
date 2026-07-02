import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicAppConfig } from '@/lib/config';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const url = new URL(request.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');

  if (!entityType || !entityId) {
    throw new ApiError(400, 'Missing entityType or entityId');
  }

  const versions = await prisma.snapshotVersion.findMany({
    where: { entityType, entityId },
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
