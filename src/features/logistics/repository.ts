import { prisma } from '@/lib/prisma';
import { getOrLoadRequestData, peekRequestData } from '@/lib/requestContext';
import type { GetLogisticsNodesOptions, ILogisticsRepository } from './types';
import {
  ContentNodeSchema,
  compareFaqNodesByOrder,
  isFaqNodeVisible,
  isPrivateContentNode,
  type ContentNodeDTO,
} from '@/features/content';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';

const HOMEPAGE_CONTENT_NODES_CACHE_KEY = 'logistics:homepageContentNodes';
const VISIBLE_FAQS_CACHE_KEY = 'logistics:visibleFaqs';

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

  private queryAndParseHomepageContentNodes(): Promise<ContentNodeDTO[]> {
    return this.client.contentNode
      .findMany({
        where: {
          OR: [
            { tags: { has: 'Homepage' } },
            { tags: { has: 'Schedule' } },
            { tags: { has: 'schedule' } },
            { type: 'FAQ' },
            { type: 'Logistics' },
            { type: 'Schedule' },
          ],
        },
      })
      .then((nodes: any[]) =>
        nodes
          .map((n: any) => ContentNodeSchema.parse(n))
          .filter((n: ContentNodeDTO) => {
            if (isPrivateContentNode(n)) return false;
            if (n.type === 'FAQ' && !isFaqNodeVisible(n)) return false;
            return true;
          })
      );
  }

  private loadParsedHomepageContentNodes(): Promise<ContentNodeDTO[]> {
    if (this.client !== prisma) {
      return this.queryAndParseHomepageContentNodes();
    }

    return getOrLoadRequestData(HOMEPAGE_CONTENT_NODES_CACHE_KEY, async () => {
      const inFlightFaqs = peekRequestData<Extract<ContentNodeDTO, { type: 'FAQ' }>[]>(
        VISIBLE_FAQS_CACHE_KEY
      );
      if (inFlightFaqs) {
        const [rawNonFaqNodes, visibleFaqs] = await Promise.all([
          this.client.contentNode.findMany({
            where: {
              type: { not: 'FAQ' },
              OR: [
                { tags: { has: 'Homepage' } },
                { tags: { has: 'Schedule' } },
                { tags: { has: 'schedule' } },
                { type: 'Logistics' },
                { type: 'Schedule' },
              ],
            },
          }),
          inFlightFaqs,
        ]);

        const parsedNonFaq: ContentNodeDTO[] = rawNonFaqNodes
          .filter((n: any) => n?.type !== 'FAQ')
          .map((n: any) => ContentNodeSchema.parse(n))
          .filter((n: ContentNodeDTO) => !isPrivateContentNode(n));

        return [...parsedNonFaq, ...visibleFaqs];
      }

      return this.queryAndParseHomepageContentNodes();
    });
  }

  async getLogisticsNodes(options?: GetLogisticsNodesOptions): Promise<ContentNodeDTO[]> {
    if (isStaticExportBuild()) {
      return this.sortNodesChronologically(buildStaticLogisticsNodes());
    }

    const includePublicSubEvents = options?.includePublicSubEvents ?? true;

    const [parsed, publicSubEvents] = await Promise.all([
      this.loadParsedHomepageContentNodes(),
      includePublicSubEvents && this.client.subEvent?.findMany
        ? this.client.subEvent.findMany({
          where: { isPrivate: false },
          orderBy: { startTime: 'asc' },
        })
        : Promise.resolve([]),
    ]);

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

    const queryAndParseVisibleFaqs = async (): Promise<Extract<ContentNodeDTO, { type: 'FAQ' }>[]> => {
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
    };

    if (this.client !== prisma) {
      return queryAndParseVisibleFaqs();
    }

    return getOrLoadRequestData(VISIBLE_FAQS_CACHE_KEY, async () => {
      const inFlightHomepageNodes = peekRequestData<ContentNodeDTO[]>(
        HOMEPAGE_CONTENT_NODES_CACHE_KEY
      );
      if (inFlightHomepageNodes) {
        const nodes = await inFlightHomepageNodes;
        return nodes
          .filter(
            (n: ContentNodeDTO): n is Extract<ContentNodeDTO, { type: 'FAQ' }> =>
              n.type === 'FAQ' && isFaqNodeVisible(n)
          )
          .sort(compareFaqNodesByOrder);
      }

      return queryAndParseVisibleFaqs();
    });
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
