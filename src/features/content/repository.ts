import { prisma } from '@/lib/prisma';
import type { IContentRepository } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

class ContentRepository implements IContentRepository {
  constructor(public client: any = prisma) {}

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }

  async getFeatures() {
    const config = await this.client.appConfig.findUnique({ where: { id: 'global' } });
    if (!config) return [];
    
    const parsed = AppConfigSchema.parse(config);
    return parsed.features || [];
  }

  async updateFeatures(features: any[], author: string = 'System'): Promise<AppConfigDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const previous = await tx.appConfig.findUnique({ where: { id: 'global' } });
      const updated = await tx.appConfig.update({
        where: { id: 'global' },
        data: { features }
      });
      await createAuditSnapshot('AppConfig', 'global', { previous: previous?.features || [], current: updated.features }, author, tx);
      return AppConfigSchema.parse(updated);
    });
  }

  async getAllNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany();
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

  async getNodesByType(type: string): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany({
      where: { type }
    });
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

  async createNode(data: Omit<ContentNodeDTO, 'id' | 'createdAt' | 'updatedAt'>, author: string = 'System'): Promise<ContentNodeDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const created = await tx.contentNode.create({
        data: {
          type: data.type,
          tags: data.tags,
          data: data.data || {}
        }
      });
      await createAuditSnapshot('ContentNode', created.id, created, author, tx);
      return ContentNodeSchema.parse(created);
    });
  }

  async updateNode(id: string, data: Partial<ContentNodeDTO>, author: string = 'System'): Promise<ContentNodeDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const updateData = { ...data } as any;
      const updated = await tx.contentNode.update({
        where: { id },
        data: updateData
      });
      await createAuditSnapshot('ContentNode', id, updated, author, tx);
      return ContentNodeSchema.parse(updated);
    });
  }

  async deleteNode(id: string, author: string = 'System'): Promise<ContentNodeDTO> {
    return executeInTransaction(this.client, async (tx) => {
      const deleted = await tx.contentNode.delete({
        where: { id }
      });
      await createAuditSnapshot('ContentNode', id, { deleted: true, ...deleted }, author, tx);
      return ContentNodeSchema.parse(deleted);
    });
  }
}

export const contentRepository = new ContentRepository();
