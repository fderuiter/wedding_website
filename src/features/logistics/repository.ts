import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

class LogisticsRepository implements ILogisticsRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await import('@/lib/prisma')).prisma;
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
