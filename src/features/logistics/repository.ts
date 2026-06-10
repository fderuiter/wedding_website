import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNode } from '@prisma/client';

export class LogisticsRepository implements ILogisticsRepository {
  async getLogisticsNodes(): Promise<ContentNode[]> {
    return await prisma.contentNode.findMany({
      where: {
        tags: {
          has: 'Homepage'
        }
      }
    });
  }
}

export const logisticsRepository = new LogisticsRepository();
