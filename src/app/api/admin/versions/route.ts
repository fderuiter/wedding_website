import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicAppConfig } from '@/lib/config';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

function maskEmail(email: string): string {
  if (!email || typeof email !== 'string') return email;
  if (!email.includes('@')) return '[REDACTED]';
  const [local, domain] = email.split('@');
  if (!local) return '[REDACTED]';
  if (local.length <= 2) {
    return `${local[0] || ''}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function sanitizeSnapshotData(data: any, entityType?: string): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeSnapshotData(item, entityType));
  }

  let result = { ...data };

  if (entityType === 'AppConfig') {
    result = toPublicAppConfig(result);
  }

  for (const key of Object.keys(result)) {
    const val = result[key];
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('email') && typeof val === 'string' && val.length > 0) {
      result[key] = maskEmail(val);
    } else if (
      (lowerKey === 'ssn' || lowerKey === 'phone' || lowerKey === 'phonenumber') &&
      typeof val === 'string' && val.length > 0
    ) {
      result[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      result[key] = sanitizeSnapshotData(val, entityType);
    }
  }

  return result;
}

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

  const sanitizedVersions = versions.map(v => ({
    ...v,
    data: sanitizeSnapshotData(v.data, v.entityType)
  }));

  return NextResponse.json(sanitizedVersions);
});
