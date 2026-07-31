import { prisma } from '@/lib/prisma';
import type { IContentRepository } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

class ContentRepository implements IContentRepository {
  constructor(public client: any = prisma) {}

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

}

export const contentRepository = new ContentRepository();
