import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

async function getPrisma() {
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/prisma').prisma;
  }
  const { prisma } = await (0, eval)('import("../../lib/prisma")');
  return prisma;
}

class LogisticsRepository implements ILogisticsRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await getPrisma());
  }

  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    const client = await this.getClient();
    const nodes = await client.contentNode.findMany({
      where: {
        tags: {
          has: 'Homepage'
        }
      }
    });
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }
}

export const logisticsRepository = new LogisticsRepository();
