import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

export class LogisticsRepository implements ILogisticsRepository {
  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await prisma.contentNode.findMany({
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
