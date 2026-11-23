import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { IContentRepository, PendingPhotosOptions, PaginatedPendingPhotosResult, GetNodesByTypeOptions } from './types';
import { ContentNodeSchema, PhotoNodeSchema, PhotoDataSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

function isMultisiteEnabled(): boolean {
  return process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1';
}

const StoredLegacyPhotoNodeSchema = PhotoNodeSchema.extend({
  data: PhotoDataSchema.extend({
    url: z.string().optional(),
  }),
});

function parseStoredPhotoNode(node: unknown): ContentNodeDTO {
  const parsed = PhotoNodeSchema.safeParse(node);
  if (parsed.success) {
    return parsed.data;
  }
  return StoredLegacyPhotoNodeSchema.parse(node);
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
    const where: any = { type };
    if (options?.since) {
      const sinceDate = options.since instanceof Date ? options.since : new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        where.createdAt = { gt: sinceDate };
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
        where.createdAt = { gt: sinceDate };
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

  async getEntityBoundMediaIds(mediaIds: string[]): Promise<Set<string>> {
    if (!mediaIds.length || !this.client.media?.findMany) {
      return new Set();
    }

    const boundMedia = await this.client.media.findMany({
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

}

export const contentRepository = new ContentRepository();
