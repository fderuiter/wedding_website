import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { IContentRepository, PendingPhotosOptions, PaginatedPendingPhotosResult, GetNodesByTypeOptions } from './types';
import { ContentNodeSchema, PhotoNodeSchema, PhotoDataSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';

function isMultisiteEnabled(): boolean {
  return process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1';
}

const StoredLegacyPhotoNodeSchema = PhotoNodeSchema.extend({
  data: PhotoDataSchema.extend({
    url: z.string().optional(),
  }),
});

function normalizeStoredNodeTimestamps<T extends Record<string, any>>(node: T): T {
  if (!node || typeof node !== 'object') {
    return node;
  }
  return {
    ...node,
    ...('tags' in node && !Array.isArray(node.tags) ? { tags: [] } : {}),
    ...(node.createdAt !== undefined && !(node.createdAt instanceof Date)
      ? { createdAt: new Date(node.createdAt) }
      : {}),
    ...(node.updatedAt !== undefined && !(node.updatedAt instanceof Date)
      ? { updatedAt: new Date(node.updatedAt) }
      : {}),
  };
}

function parseStoredPhotoNode(node: unknown): ContentNodeDTO {
  const normalized =
    node && typeof node === 'object'
      ? normalizeStoredNodeTimestamps(node as Record<string, any>)
      : node;
  const parsed = PhotoNodeSchema.safeParse(normalized);
  if (parsed.success) {
    return parsed.data;
  }
  return StoredLegacyPhotoNodeSchema.parse(normalized);
}

function parseStoredContentNode(node: unknown): ContentNodeDTO {
  if (node && typeof node === 'object' && (node as { type?: unknown }).type === 'Photo') {
    return parseStoredPhotoNode(node);
  }
  const parsed = ContentNodeSchema.safeParse(node);
  if (parsed.success) {
    return parsed.data;
  }
  throw parsed.error;
}

export class ContentRepository implements IContentRepository {
  constructor(public client: any = prisma) {}

  async getPendingPhotos(options: PendingPhotosOptions = {}): Promise<PaginatedPendingPhotosResult> {
    let page = Math.floor(Number(options.page));
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    let limit = Math.floor(Number(options.limit));
    if (isNaN(limit) || limit < 1) {
      limit = 50;
    }
    if (limit > 100) {
      limit = 100;
    }

    const skip = (page - 1) * limit;
    const take = limit;

    if (isStaticExportBuild()) {
      const seedPending = buildArchetypeSeedData('classic').pendingPhotos.map((n) =>
        parseStoredPhotoNode(n)
      );
      const total = seedPending.length;
      const photos = seedPending.slice(skip, skip + take);
      const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
      return {
        photos,
        total,
        page,
        limit,
        totalPages,
      };
    }

    const where: any = {
      type: 'Photo',
      OR: [
        {
          data: {
            path: ['status'],
            equals: 'PENDING',
          },
        },
        {
          tags: {
            has: 'guest-upload',
          },
          data: {
            path: ['isVisible'],
            equals: false,
          },
          OR: [
            { data: { path: ['status'], equals: Prisma.DbNull } },
            { data: { path: ['status'], equals: Prisma.AnyNull } },
          ],
        },
      ],
    };

    const [total, nodes] = await Promise.all([
      this.client.contentNode.count({ where }),
      this.client.contentNode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    const photos = nodes.map((n: any) => parseStoredPhotoNode(n));
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      photos,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getFeatures(configIdOrSubdomain: string = 'global') {
    if (isStaticExportBuild()) {
      const parsed = AppConfigSchema.parse(buildArchetypeSeedData('classic').config);
      return parsed.features || [];
    }

    const target = isMultisiteEnabled() ? configIdOrSubdomain : 'global';
    let config = await this.client.appConfig.findUnique({ where: { id: target } });
    if (!config && isMultisiteEnabled()) {
      config = await this.client.appConfig.findUnique({ where: { subdomain: target } });
    }
    if (!config) return [];
    
    const parsed = AppConfigSchema.parse(config);
    return parsed.features || [];
  }

  async updateFeatures(features: any[], author: string = 'System', configIdOrSubdomain: string = 'global'): Promise<AppConfigDTO> {
    const targetKey = isMultisiteEnabled() ? configIdOrSubdomain : 'global';
    return executeInTransaction(this.client, async (tx) => {
      let config = await tx.appConfig.findUnique({ where: { id: targetKey } });
      if (!config && isMultisiteEnabled()) {
        config = await tx.appConfig.findUnique({ where: { subdomain: targetKey } });
      }
      const targetId = config ? config.id : 'global';
      const previous = await tx.appConfig.findUnique({ where: { id: targetId } });
      const updated = await tx.appConfig.update({
        where: { id: targetId },
        data: { features }
      });
      await createAuditSnapshot('AppConfig', targetId, { previous: previous?.features || [], current: updated.features }, author, tx);
      return AppConfigSchema.parse(updated);
    });
  }

  async getNodesByType(type: string, options?: GetNodesByTypeOptions): Promise<ContentNodeDTO[]> {
    if (isStaticExportBuild()) {
      let filtered = buildArchetypeSeedData('classic')
        .allContentNodes.filter((node) => node.type === type)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (options?.since) {
        const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
        if (!isNaN(sinceDate.getTime())) {
          filtered = filtered.filter(
            (node) => (node.updatedAt ?? node.createdAt).getTime() > sinceDate.getTime()
          );
        }
      }

      if (options?.limit !== undefined) {
        const limit = Math.floor(Number(options.limit));
        if (!isNaN(limit) && limit > 0) {
          filtered = filtered.slice(0, limit > 100 ? 100 : limit);
        }
      }

      return filtered.map((node) => parseStoredContentNode(node));
    }

    const where: any = { type };
    if (options?.since) {
      const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        where.updatedAt = { gt: sinceDate };
      }
    }

    const queryArgs: any = {
      where,
      orderBy: { createdAt: 'desc' },
    };

    if (options?.limit !== undefined) {
      const limit = Math.floor(Number(options.limit));
      if (!isNaN(limit) && limit > 0) {
        queryArgs.take = limit > 100 ? 100 : limit;
      }
    }

    const nodes = await this.client.contentNode.findMany(queryArgs);
    return nodes.map((n: any) => parseStoredContentNode(n));
  }

  async getPublicPhotos(options?: GetNodesByTypeOptions): Promise<ContentNodeDTO[]> {
    let take: number | undefined;
    if (options?.limit !== undefined) {
      const limit = Math.floor(Number(options.limit));
      if (!isNaN(limit) && limit > 0) {
        take = limit > 100 ? 100 : limit;
      }
    }

    if (isStaticExportBuild()) {
      let photos = buildArchetypeSeedData('classic').publicPhotos.map((node) =>
        parseStoredPhotoNode(node)
      );
      if (options?.since) {
        const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
        if (!isNaN(sinceDate.getTime())) {
          photos = photos.filter(
            (node) => (node.updatedAt ?? node.createdAt).getTime() > sinceDate.getTime()
          );
        }
      }
      if (take !== undefined) {
        photos = photos.slice(0, take);
      }
      return photos;
    }

    const andFilters: any[] = [
      { data: { path: ['status'], equals: 'APPROVED' } },
      { data: { path: ['isVisible'], equals: true } },
    ];

    if (take !== undefined && this.client.media?.findMany) {
      const boundMedia = await this.client.media.findMany({
        where: {
          OR: [
            { weddingPartyMembers: { some: {} } },
            { attractions: { some: {} } },
            { registryItems: { some: {} } },
          ],
        },
        select: { id: true },
      });
      const boundMediaIds = Array.isArray(boundMedia)
        ? boundMedia.map((m: { id: string }) => m.id).filter(Boolean)
        : [];
      if (boundMediaIds.length > 0) {
        andFilters.push({
          OR: [
            { tags: { has: 'guest-upload' } },
            { data: { path: ['publishToGallery'], equals: true } },
            { data: { path: ['mediaId'], equals: Prisma.AnyNull } },
            {
              NOT: {
                OR: boundMediaIds.map((mediaId: string) => ({
                  data: { path: ['mediaId'], equals: mediaId },
                })),
              },
            },
          ],
        });
      }
    }

    const where: any = {
      type: 'Photo',
      AND: andFilters,
    };

    if (options?.since) {
      const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        where.updatedAt = { gt: sinceDate };
      }
    }

    const queryArgs: any = {
      where,
      orderBy: { createdAt: 'desc' },
    };

    if (take !== undefined) {
      queryArgs.take = take;
    }

    const nodes = await this.client.contentNode.findMany(queryArgs);
    const parsedNodes = nodes.map((n: any) => parseStoredPhotoNode(n));

    if (take === undefined && parsedNodes.length > 0 && this.client.media?.findMany) {
      const candidateMediaIds = Array.from(
        new Set<string>(
          parsedNodes
            .map((node: ContentNodeDTO) => {
              const data = node.data as { mediaId?: string; publishToGallery?: boolean } | undefined;
              if (!data?.mediaId || data.publishToGallery === true || node.tags?.includes('guest-upload')) {
                return null;
              }
              return data.mediaId;
            })
            .filter((id: string | null): id is string => Boolean(id))
        )
      );

      if (candidateMediaIds.length > 0) {
        const excludedMediaIds = await this.getEntityBoundMediaIds(candidateMediaIds);
        if (excludedMediaIds.size > 0) {
          return parsedNodes.filter((node: ContentNodeDTO) => {
            const data = node.data as { mediaId?: string; publishToGallery?: boolean } | undefined;
            if (
              data?.mediaId &&
              data.publishToGallery !== true &&
              !node.tags?.includes('guest-upload') &&
              excludedMediaIds.has(data.mediaId)
            ) {
              return false;
            }
            return true;
          });
        }
      }
    }

    return parsedNodes;
  }

  async getEntityBoundMediaIds(
    mediaIds: string[],
    client: any = this.client
  ): Promise<Set<string>> {
    if (!mediaIds.length) {
      return new Set();
    }

    if (isStaticExportBuild()) {
      const boundSet = new Set(buildArchetypeSeedData('classic').boundMediaIds);
      return new Set(mediaIds.filter((id) => boundSet.has(id)));
    }

    if (!client?.media?.findMany) {
      return new Set();
    }

    const boundMedia = await client.media.findMany({
      where: {
        id: { in: mediaIds },
        OR: [
          { weddingPartyMembers: { some: {} } },
          { attractions: { some: {} } },
          { registryItems: { some: {} } },
        ],
      },
      select: { id: true },
    });

    return new Set(boundMedia.map((m: { id: string }) => m.id));
  }

  async createNode(data: { type: string; tags?: string[]; data: any }, author: string = 'System'): Promise<ContentNodeDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const node = await tx.contentNode.create({
        data: {
          type: data.type,
          tags: data.tags || [],
          data: data.data,
        }
      });
      await createAuditSnapshot('ContentNode', node.id, node, author, tx);
      return ContentNodeSchema.parse(node);
    });
  }

  async getNodeById(id: string): Promise<ContentNodeDTO | null> {
    if (isStaticExportBuild()) {
      const found = buildArchetypeSeedData('classic').allContentNodes.find(
        (candidate) => candidate.id === id
      );
      return found ? parseStoredContentNode(found) : null;
    }

    const node = await this.client.contentNode.findUnique({
      where: { id }
    });
    if (!node) return null;
    return parseStoredContentNode(node);
  }

  async updateNode(id: string, data: { tags?: string[]; data?: any }, author: string = 'System'): Promise<ContentNodeDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const updated = await tx.contentNode.update({
        where: { id },
        data: {
          ...(data.tags !== undefined ? { tags: data.tags } : {}),
          ...(data.data !== undefined ? { data: data.data } : {}),
        }
      });
      await createAuditSnapshot('ContentNode', updated.id, updated, author, tx);
      return ContentNodeSchema.parse(updated);
    });
  }

  async deleteNode(id: string, author: string = 'System'): Promise<void> {
    return executeInTransaction(this.client, async (tx) => {
      const node = await tx.contentNode.findUnique({ where: { id } });
      if (node) {
        await tx.contentNode.delete({ where: { id } });
        await createAuditSnapshot('ContentNode', id, { deleted: true, previous: node }, author, tx);
      }
    });
  }

  async approvePhotosBatch(
    ids: string[],
    author: string = 'System'
  ): Promise<ContentNodeDTO[]> {
    const uniqueIds = Array.from(
      new Set((ids || []).filter((id): id is string => typeof id === 'string' && id.length > 0))
    );
    if (uniqueIds.length === 0) {
      return [];
    }

    return executeInTransaction(this.client, async (tx) => {
      let updatedRawNodes: any[] = [];

      if (typeof tx.$queryRaw === 'function') {
        const contentNodeTable = Prisma.raw(qualifyPostgresTable('ContentNode'));
        const rows = await tx.$queryRaw(Prisma.sql`
          UPDATE ${contentNodeTable}
          SET
            "data" = COALESCE(
              CASE WHEN jsonb_typeof("data") = 'object' THEN "data" ELSE '{}'::jsonb END,
              '{}'::jsonb
            ) || '{"status":"APPROVED","isVisible":true}'::jsonb,
            "updatedAt" = NOW()
          WHERE "type" = 'Photo'
            AND "id" = ANY(${uniqueIds}::text[])
          RETURNING "id", "type", COALESCE("tags", ARRAY[]::text[]) AS "tags", "data", "createdAt", "updatedAt"
        `);
        updatedRawNodes = Array.isArray(rows)
          ? rows.map((row) => normalizeStoredNodeTimestamps(row))
          : [];
      } else if (typeof tx.contentNode?.findMany === 'function') {
        const existingNodes = await tx.contentNode.findMany({
          where: {
            id: { in: uniqueIds },
            type: 'Photo',
          },
        });
        for (const node of existingNodes) {
          const currentData =
            node.data && typeof node.data === 'object' && !Array.isArray(node.data)
              ? (node.data as Record<string, any>)
              : {};
          const nextData = {
            ...currentData,
            status: 'APPROVED',
            isVisible: true,
          };
          const updated = await tx.contentNode.update({
            where: { id: node.id },
            data: { data: nextData },
          });
          updatedRawNodes.push(normalizeStoredNodeTimestamps(updated));
        }
      }

      if (updatedRawNodes.length === 0) {
        return [];
      }

      await createBatchAuditSnapshots('ContentNode', updatedRawNodes, author, tx);
      return updatedRawNodes.map((node) => parseStoredPhotoNode(node));
    });
  }

  async rejectPhotosBatch(
    ids: string[],
    author: string = 'System'
  ): Promise<string[]> {
    const uniqueIds = Array.from(
      new Set((ids || []).filter((id): id is string => typeof id === 'string' && id.length > 0))
    );
    if (uniqueIds.length === 0) {
      return [];
    }

    const { MediaRepository, mediaRepository, unlinkManagedStorageUrls } = await import(
      '@/features/media'
    );
    const mediaRepo =
      this.client && this.client !== mediaRepository.client
        ? new MediaRepository(this.client)
        : mediaRepository;

    const { deletedIds, urlsToUnlink } = await executeInTransaction(
      this.client,
      async (tx) => {
        let deletedRawNodes: any[] = [];

        if (typeof tx.$queryRaw === 'function') {
          const contentNodeTable = Prisma.raw(qualifyPostgresTable('ContentNode'));
          const rows = await tx.$queryRaw(Prisma.sql`
            DELETE FROM ${contentNodeTable}
            WHERE "type" = 'Photo'
              AND "id" = ANY(${uniqueIds}::text[])
            RETURNING "id", "type", COALESCE("tags", ARRAY[]::text[]) AS "tags", "data", "createdAt", "updatedAt"
          `);
          deletedRawNodes = Array.isArray(rows)
            ? rows.map((row) => normalizeStoredNodeTimestamps(row))
            : [];
        } else if (typeof tx.contentNode?.findMany === 'function') {
          const existingNodes = await tx.contentNode.findMany({
            where: {
              id: { in: uniqueIds },
              type: 'Photo',
            },
          });
          if (Array.isArray(existingNodes) && existingNodes.length > 0) {
            const existingIds = existingNodes.map((node: { id: string }) => node.id);
            if (typeof tx.contentNode.deleteMany === 'function') {
              await tx.contentNode.deleteMany({
                where: { id: { in: existingIds } },
              });
            } else if (typeof tx.contentNode.delete === 'function') {
              for (const existingId of existingIds) {
                await tx.contentNode.delete({ where: { id: existingId } });
              }
            }
            deletedRawNodes = existingNodes.map((node: any) =>
              normalizeStoredNodeTimestamps(node)
            );
          }
        }

        if (deletedRawNodes.length === 0) {
          return { deletedIds: [] as string[], urlsToUnlink: [] as string[] };
        }

        await createBatchAuditSnapshots(
          'ContentNode',
          deletedRawNodes.map((node) => ({
            entityId: node.id,
            data: { deleted: true, previous: node },
          })),
          author,
          tx
        );

        const candidateMediaIds = Array.from(
          new Set(
            deletedRawNodes
              .map((node) => {
                const nodeData = node.data as { mediaId?: unknown } | null | undefined;
                return typeof nodeData?.mediaId === 'string' && nodeData.mediaId.trim()
                  ? nodeData.mediaId.trim()
                  : null;
              })
              .filter((mediaId): mediaId is string => Boolean(mediaId))
          )
        );

        let entityBoundMediaIds = new Set<string>();
        if (candidateMediaIds.length > 0) {
          entityBoundMediaIds = await this.getEntityBoundMediaIds(candidateMediaIds, tx);
        }

        const unboundMediaIds = candidateMediaIds.filter(
          (mediaId) => !entityBoundMediaIds.has(mediaId)
        );

        const deletedMediaList =
          unboundMediaIds.length > 0
            ? await mediaRepo.deleteMediaBatch(unboundMediaIds, author, {
              tx,
              skipLinkedNodeCleanup: true,
              skipStorageCleanup: true,
            })
            : [];

        const deletedMediaById = new Map(deletedMediaList.map((m) => [m.id, m]));
        const stillExistingUnboundIds = new Set<string>();
        if (
          unboundMediaIds.length > deletedMediaList.length &&
          typeof tx.media?.findMany === 'function'
        ) {
          const remainingIds = unboundMediaIds.filter((id) => !deletedMediaById.has(id));
          if (remainingIds.length > 0) {
            const remainingRows = await tx.media.findMany({
              where: { id: { in: remainingIds } },
              select: { id: true },
            });
            if (Array.isArray(remainingRows)) {
              for (const row of remainingRows) {
                if (row?.id) {
                  stillExistingUnboundIds.add(row.id);
                }
              }
            }
          }
        }

        const collectedUrls: string[] = [];
        for (const media of deletedMediaList) {
          if (typeof media.url === 'string' && media.url) {
            collectedUrls.push(media.url);
          }
        }

        for (const node of deletedRawNodes) {
          const nodeData = (node.data as { mediaId?: unknown; url?: unknown } | null) || {};
          const rawMediaId =
            typeof nodeData.mediaId === 'string' && nodeData.mediaId.trim()
              ? nodeData.mediaId.trim()
              : undefined;

          if (rawMediaId) {
            if (
              deletedMediaById.has(rawMediaId) ||
              entityBoundMediaIds.has(rawMediaId) ||
              stillExistingUnboundIds.has(rawMediaId)
            ) {
              continue;
            }
          }

          if (typeof nodeData.url === 'string' && nodeData.url) {
            collectedUrls.push(nodeData.url);
          }
        }

        return {
          deletedIds: deletedRawNodes.map((node) => String(node.id)),
          urlsToUnlink: collectedUrls,
        };
      }
    );

    if (urlsToUnlink.length > 0) {
      await unlinkManagedStorageUrls(urlsToUnlink, 'ContentRepository.rejectPhotosBatch');
    }

    return deletedIds;
  }

}

export const contentRepository = new ContentRepository();
