import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

class LogisticsRepository implements ILogisticsRepository {
  constructor(public client: any = prisma) {}

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }

  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany({
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
