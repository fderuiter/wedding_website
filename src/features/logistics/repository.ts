import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

export class LogisticsRepository implements ILogisticsRepository {
  constructor(public client: any = prisma) {}

  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await this.client.contentNode.findMany({
      where: {
        OR: [
          { tags: { has: 'Homepage' } },
          { tags: { has: 'Schedule' } },
          { tags: { has: 'schedule' } },
          { type: 'Logistics' },
          { type: 'Schedule' }
        ]
      }
    });
    const parsed = nodes.map((n: any) => ContentNodeSchema.parse(n));
    return this.sortNodesChronologically(parsed);
  }

  async getScheduleNodes(): Promise<ContentNodeDTO[]> {
    return this.getLogisticsNodes();
  }

  public sortNodesChronologically(nodes: ContentNodeDTO[]): ContentNodeDTO[] {
    return [...nodes].sort((a, b) => {
      const timeA = (a.data as any)?.startTime ? new Date((a.data as any).startTime).getTime() : Infinity;
      const timeB = (b.data as any)?.startTime ? new Date((b.data as any).startTime).getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return createdA - createdB;
    });
  }
}

export const logisticsRepository = new LogisticsRepository();
