import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import { ContentNodeSchema, isPrivateContentNode, type ContentNodeDTO } from '@/features/content';

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

    const [nodes, publicSubEvents] = await Promise.all([
      this.client.contentNode.findMany({
        where: {
          OR: [
            { tags: { has: 'Homepage' } },
            { tags: { has: 'Schedule' } },
            { tags: { has: 'schedule' } },
            { type: 'Logistics' },
            { type: 'Schedule' }
          ]
        }
      }),
      this.client.subEvent?.findMany
        ? this.client.subEvent.findMany({
          where: { isPrivate: false },
          orderBy: { startTime: 'asc' },
        })
        : Promise.resolve([]),
    ]);

    const parsed: ContentNodeDTO[] = nodes
      .map((n: any) => ContentNodeSchema.parse(n))
      .filter((n: ContentNodeDTO) => !isPrivateContentNode(n));

    if (Array.isArray(publicSubEvents) && publicSubEvents.length > 0) {
      const nonScheduleNodes = parsed.filter((n: ContentNodeDTO) => {
        const data = n.data as any;
        const isScheduleFallback =
          n.type === 'Schedule' ||
          n.tags.includes('Schedule') ||
          n.tags.includes('schedule') ||
          Boolean(data?.startTime);
        return !isScheduleFallback;
      });

      const subEventNodes: ContentNodeDTO[] = publicSubEvents.map((evt: any) => {
        const startIso = evt.startTime instanceof Date ? evt.startTime.toISOString() : (evt.startTime || undefined);
        const endIso = evt.endTime instanceof Date ? evt.endTime.toISOString() : (evt.endTime || undefined);
        const category = typeof evt.category === 'string' && evt.category.trim() ? evt.category.trim() : undefined;

        return ContentNodeSchema.parse({
          id: evt.id,
          type: 'Schedule',
          tags: ['Homepage', 'Schedule'],
          data: {
            title: evt.title,
            description: evt.description || '',
            startTime: startIso,
            endTime: endIso,
            locationName: evt.locationName || evt.location || '',
            location: evt.location || '',
            category,
            categoryTags: category ? [category] : [],
            attireRules: evt.attireRules || evt.attire || undefined,
            isPrivate: false,
            isReadOnly: false,
          },
          createdAt: evt.createdAt ? new Date(evt.createdAt) : new Date(0),
          updatedAt: evt.updatedAt ? new Date(evt.updatedAt) : new Date(0),
        });
      });

      return this.sortNodesChronologically([...nonScheduleNodes, ...subEventNodes]);
    }

    const fallbackNodes = parsed.map((n: ContentNodeDTO) => {
      const data = n.data as any;
      const isScheduleLike =
        n.type === 'Schedule' ||
        n.tags.includes('Schedule') ||
        n.tags.includes('schedule') ||
        Boolean(data?.startTime);
      if (isScheduleLike && data?.isReadOnly === undefined && data?.userRsvp === undefined) {
        return {
          ...n,
          data: {
            ...data,
            isReadOnly: true,
          },
        } as ContentNodeDTO;
      }
      return n;
    });

    return this.sortNodesChronologically(fallbackNodes);
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
