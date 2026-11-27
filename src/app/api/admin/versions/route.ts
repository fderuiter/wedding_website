import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
import { toPublicAppConfig } from '@/lib/config';
import { PublicAppConfigSchema } from '@/features/content';
import {
  maskSnapshotEmail,
  shouldIncludeSnapshotData,
  toSnapshotSummaryData,
} from '@/utils/versionSnapshots';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

function sanitizeSnapshotData(data: any, entityType?: string): any {
  if (!data || typeof data !== 'object' || data instanceof Date) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeSnapshotData(item, entityType));
  }

  let result = { ...data };

  if (entityType === 'AppConfig') {
    const rawFeatures = result.features;
    result = toPublicAppConfig(result);
    if (rawFeatures !== undefined) {
      const parsedFeatures = PublicAppConfigSchema.shape.features.safeParse(rawFeatures);
      result = {
        ...result,
        features: parsedFeatures.success ? parsedFeatures.data : rawFeatures,
      };
    }
  }

  const nestedEntityType = entityType === 'AppConfig' ? undefined : entityType;

  for (const key of Object.keys(result)) {
    const val = result[key];
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('email') && typeof val === 'string' && val.length > 0) {
      result[key] = maskSnapshotEmail(val);
    } else if (
      (lowerKey === 'ssn' ||
        lowerKey === 'phone' ||
        lowerKey === 'phonenumber' ||
        lowerKey === 'shippingphone') &&
      typeof val === 'string' &&
      val.length > 0
    ) {
      result[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      result[key] = sanitizeSnapshotData(val, nestedEntityType);
    }
  }

  return result;
}

interface SnapshotSummarySqlRow {
  id: string;
  entityType: string;
  entityId: string;
  author: string;
  createdAt: Date | string;
  isDeleted: boolean;
}

async function queryVersionSummaries(
  where: { entityType?: string; entityId?: string },
  take: number,
  skip: number
): Promise<Array<Record<string, any>>> {
  const rawQuery = (prisma as { $queryRaw?: typeof prisma.$queryRaw }).$queryRaw;
  if (typeof rawQuery === 'function') {
    const conditions: Prisma.Sql[] = [];
    if (where.entityType) {
      conditions.push(Prisma.sql`"entityType" = ${where.entityType}`);
    }
    if (where.entityId) {
      conditions.push(Prisma.sql`"entityId" = ${where.entityId}`);
    }
    const whereSql =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;
    const snapshotVersionTable = Prisma.raw(qualifyPostgresTable('SnapshotVersion'));
    const rawRows = await prisma.$queryRaw<SnapshotSummarySqlRow[]>(Prisma.sql`
      SELECT
        "id",
        "entityType",
        "entityId",
        "author",
        ("createdAt" AT TIME ZONE 'UTC') AS "createdAt",
        CASE
          WHEN jsonb_typeof("data") = 'object' AND ("data" -> 'deleted') = 'true'::jsonb
          THEN true
          ELSE false
        END AS "isDeleted"
      FROM ${snapshotVersionTable}
      ${whereSql}
      ORDER BY "createdAt" DESC
      LIMIT ${take}
      OFFSET ${skip}
    `);
    if (Array.isArray(rawRows)) {
      return rawRows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        author: row.author,
        createdAt:
          row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
        data: row.isDeleted === true ? { deleted: true } : {},
      }));
    }
  }

  const versions = await prisma.snapshotVersion.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });

  return versions.map((v) => ({
    id: v.id,
    entityType: v.entityType,
    entityId: v.entityId,
    author: v.author,
    createdAt: v.createdAt,
    data: toSnapshotSummaryData(v.data),
  }));
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const url = new URL(request.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');
  const rawIncludeData = url.searchParams.get('includeData');

  const rawPage = url.searchParams.get('page');
  const rawLimit = url.searchParams.get('limit');

  let page = 1;
  if (rawPage !== null && rawPage !== '') {
    const parsedPage = parseInt(rawPage, 10);
    if (!isNaN(parsedPage) && parsedPage >= 1) {
      page = parsedPage;
    }
  }

  let limit = 50;
  if (rawLimit !== null && rawLimit !== '') {
    const parsedLimit = parseInt(rawLimit, 10);
    if (!isNaN(parsedLimit) && parsedLimit >= 1) {
      limit = Math.min(parsedLimit, 100);
    }
  }

  const skip = (page - 1) * limit;
  const take = limit;

  const normalizedEntityType = entityType?.trim() || null;
  const normalizedEntityId = entityId?.trim() || null;
  const includeData = shouldIncludeSnapshotData(rawIncludeData, normalizedEntityId);

  const where: any = {};
  if (normalizedEntityType) where.entityType = normalizedEntityType;
  if (normalizedEntityId) where.entityId = normalizedEntityId;

  let total = 0;
  let items: Array<Record<string, any>> = [];

  if (includeData) {
    const [count, versions] = await Promise.all([
      prisma.snapshotVersion.count({ where }),
      prisma.snapshotVersion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);
    total = count;
    items = versions.map((v) => ({
      ...v,
      data: sanitizeSnapshotData(v.data, v.entityType),
    }));
  } else {
    const [count, summaryVersions] = await Promise.all([
      prisma.snapshotVersion.count({ where }),
      queryVersionSummaries(where, take, skip),
    ]);
    total = count;
    items = summaryVersions;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return NextResponse.json({
    items,
    pagination: {
      total,
      totalCount: total,
      page,
      currentPage: page,
      limit,
      pageSize: limit,
      totalPages,
      isPaginated: true,
    },
  });
});
