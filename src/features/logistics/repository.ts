import { prisma } from '@/lib/prisma';
import type { ILogisticsRepository } from './types';
import {
  ContentNodeSchema,
  compareFaqNodesByOrder,
  isFaqNodeVisible,
  isPrivateContentNode,
  type ContentNodeDTO,
} from '@/features/content';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';

function buildStaticLogisticsNodes(): ContentNodeDTO[] {
  const seed = buildArchetypeSeedData('classic');
  return [
    ...seed.scheduleNodes,
    ...seed.logisticsNodes,
    ...seed.faqNodes,
  ].map((node) => ContentNodeSchema.parse(node));
}

export class LogisticsRepository implements ILogisticsRepository {
  constructor(public client: any = prisma) {}

  async getLogisticsNodes(): Promise<ContentNodeDTO[]> {
    if (isStaticExportBuild()) {
      return this.sortNodesChronologically(buildStaticLogisticsNodes());
    }

    const [nodes, publicSubEvents] = await Promise.all([
      this.client.contentNode.findMany({
        where: {
          OR: [
            { tags: { has: 'Homepage' } },
            { tags: { has: 'Schedule' } },
            { tags: { has: 'schedule' } },
            { type: 'FAQ' },
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
      .filter((n: ContentNodeDTO) => {
        if (isPrivateContentNode(n)) return false;
        if (n.type === 'FAQ' && !isFaqNodeVisible(n)) return false;
        return true;
      });

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
            ...(Array.isArray(evt.mealOptions) ? { mealOptions: evt.mealOptions } : {}),
            ...(Array.isArray(evt.customQuestions)
              ? { customQuestions: evt.customQuestions }
              : {}),
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

  async getVisibleFaqs(): Promise<Extract<ContentNodeDTO, { type: 'FAQ' }>[]> {
    if (isStaticExportBuild()) {
      return buildStaticLogisticsNodes()
        .filter(
          (n): n is Extract<ContentNodeDTO, { type: 'FAQ' }> =>
            n.type === 'FAQ' && isFaqNodeVisible(n)
        )
        .sort(compareFaqNodesByOrder);
    }

    if (!this.client?.contentNode?.findMany) {
      return [];
    }

    const rawNodes = await this.client.contentNode.findMany({
      where: { type: 'FAQ' },
    });

    return rawNodes
      .map((n: any) => ContentNodeSchema.parse(n))
      .filter(
        (n: ContentNodeDTO): n is Extract<ContentNodeDTO, { type: 'FAQ' }> =>
          n.type === 'FAQ' && isFaqNodeVisible(n)
      )
      .sort(compareFaqNodesByOrder);
  }

  public sortNodesChronologically(nodes: ContentNodeDTO[]): ContentNodeDTO[] {
    return [...nodes].sort((a, b) => {
      if (a.type === 'FAQ' && b.type === 'FAQ') {
        return compareFaqNodesByOrder(a, b);
      }

      const timeA = (a.data as any)?.startTime ? new Date((a.data as any).startTime).getTime() : Infinity;
      const timeB = (b.data as any)?.startTime ? new Date((b.data as any).startTime).getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      if (a.type === 'FAQ' && b.type !== 'FAQ') {
        return 1;
      }
      if (a.type !== 'FAQ' && b.type === 'FAQ') {
        return -1;
      }

      const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return createdA - createdB;
    });
  }
}

export const logisticsRepository = new LogisticsRepository();
