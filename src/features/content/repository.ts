import type { IContentRepository } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';

async function getPrisma() {
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/prisma').prisma;
  }
  const { prisma } = await (0, eval)('import("../../lib/prisma")');
  return prisma;
}

async function getAuditSnapshot() {
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/audit').createAuditSnapshot;
  }
  const { createAuditSnapshot } = await (0, eval)('import("../../lib/audit")');
  return createAuditSnapshot;
}

export class ContentRepository implements IContentRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await getPrisma());
  }

  async getFeatures(configIdOrSubdomain: string = 'global') {
    const client = await this.getClient();
    let config = await client.appConfig.findUnique({ where: { id: configIdOrSubdomain } });
    if (!config) {
      config = await client.appConfig.findUnique({ where: { subdomain: configIdOrSubdomain } });
    }
    if (!config) return [];
    
    const parsed = AppConfigSchema.parse(config);
    return parsed.features || [];
  }

  async updateFeatures(features: any[], author: string = 'System', configIdOrSubdomain: string = 'global'): Promise<AppConfigDTO> {
    const client = await this.getClient();
    const createAuditSnapshot = await getAuditSnapshot();
    const getTransaction = async () => {
      if (process.env.JEST_WORKER_ID) {
        const req = eval('require');
        return req('@/lib/transaction');
      }
      return (0, eval)('import("../../lib/transaction")');
    };
    const { executeInTransaction } = await getTransaction();
    return executeInTransaction(client, async (tx: any) => {
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

  async getAllNodes(): Promise<ContentNodeDTO[]> {
    const client = await this.getClient();
    const nodes = await client.contentNode.findMany();
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }
  async getNodesByType(type: string): Promise<ContentNodeDTO[]> {
    const client = await this.getClient();
    const nodes = await client.contentNode.findMany({
      where: { type }
    });
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

}

export const contentRepository = new ContentRepository();
