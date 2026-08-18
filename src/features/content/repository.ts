import { prisma } from '@/lib/prisma';
import type { IContentRepository } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

class ContentRepository implements IContentRepository {
  constructor(public client: any = prisma) {}

  async getFeatures(configIdOrSubdomain: string = 'global') {
    let config = await this.client.appConfig.findUnique({ where: { id: configIdOrSubdomain } });
    if (!config) {
      config = await this.client.appConfig.findUnique({ where: { subdomain: configIdOrSubdomain } });
    }
    if (!config) return [];
    
    const parsed = AppConfigSchema.parse(config);
    return parsed.features || [];
  }

  async updateFeatures(features: any[], author: string = 'System', configIdOrSubdomain: string = 'global'): Promise<AppConfigDTO> {
    return executeInTransaction(this.client, async (tx) => {
      let config = await tx.appConfig.findUnique({ where: { id: configIdOrSubdomain } });
      if (!config) {
        config = await tx.appConfig.findUnique({ where: { subdomain: configIdOrSubdomain } });
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

}

export const contentRepository = new ContentRepository();
