import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, ContentNodeDTO } from '../content/schemas';

const STATIC_MOCK_LOGISTICS_NODES: ContentNodeDTO[] = [
  {
    id: 'mock-logistics-ceremony',
    type: 'Logistics',
    tags: ['Homepage', 'Schedule', 'Logistics'],
    data: {
      ceremonyTitle: 'Wedding Ceremony',
      ceremonyTime: '4:00 PM',
      receptionTitle: 'Evening Reception',
      receptionTime: '6:00 PM',
      receptionDetails: 'Dinner, toasts, and dancing into the evening.',
      receptionAttire: 'Semi-Formal / Cocktail Attire',
      startTime: '2026-09-19T16:00:00.000Z',
      endTime: '2026-09-19T23:00:00.000Z',
      locationName: 'The Glasshouse Estate',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-logistics-accommodations',
    type: 'Logistics',
    tags: ['Homepage', 'Logistics'],
    data: {
      title: 'Accommodations',
      description: 'A block of rooms has been reserved at The Grand Hotel nearby. Mention the wedding code for a discounted rate.',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-logistics-travel',
    type: 'Logistics',
    tags: ['Homepage', 'Logistics'],
    data: {
      title: 'Travel & Parking',
      description: 'Valet parking is provided at the estate gates. Ride-sharing drop-offs are available at the front turnaround.',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
];

export class LogisticsRepository implements ILogisticsRepository {
  constructor(public client: any = prisma) {}

  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                           process.env.STATIC_EXPORT === '1' ||
                           process.env.npm_lifecycle_event === 'build:export';

    if (isStaticExport) {
      return STATIC_MOCK_LOGISTICS_NODES;
    }

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
