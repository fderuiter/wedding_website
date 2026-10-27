import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { IContentRepository, PendingPhotosOptions, PaginatedPendingPhotosResult } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';
import { isMultisiteEnabled } from '@/lib/config';

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

    const photos = nodes.map((n: any) => ContentNodeSchema.parse(n));
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

  async getNodesByType(type: string): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany({
      where: { type }
    });
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

  async getAllNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany();
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
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
    return ContentNodeSchema.parse(node);
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
