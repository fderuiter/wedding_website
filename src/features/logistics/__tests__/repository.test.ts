import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runWithRequestContext } from '@/lib/requestContext';
import { LogisticsRepository, logisticsRepository } from '../repository';
import { LogisticsService, logisticsService } from '../service';
import { ContentNodeSchema, type ContentNodeDTO } from '@/features/content';

describe('LogisticsRepository Chronological Sorting', () => {
  let repo: LogisticsRepository;

  beforeEach(() => {
    repo = new LogisticsRepository();
  });

  it('sorts schedule nodes in ascending chronological order by startTime', () => {
    const unsortedNodes: ContentNodeDTO[] = [
      {
        id: 'node-3',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Reception Party',
          startTime: '2026-06-20T19:00:00.000Z',
          endTime: '2026-06-20T23:00:00.000Z',
        },
        createdAt: new Date('2026-01-03'),
        updatedAt: new Date('2026-01-03'),
      },
      {
        id: 'node-1',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Welcome Breakfast',
          startTime: '2026-06-20T09:00:00.000Z',
          endTime: '2026-06-20T11:00:00.000Z',
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'node-2',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Wedding Ceremony',
          startTime: '2026-06-20T15:00:00.000Z',
          endTime: '2026-06-20T16:30:00.000Z',
        },
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      },
    ];

    const sorted = repo.sortNodesChronologically(unsortedNodes);

    expect(sorted.map((n) => n.id)).toEqual(['node-1', 'node-2', 'node-3']);
    expect((sorted[0].data as any).title).toBe('Welcome Breakfast');
    expect((sorted[1].data as any).title).toBe('Wedding Ceremony');
    expect((sorted[2].data as any).title).toBe('Reception Party');
  });

  it('queries and sorts schedule nodes from mock database client', async () => {
    const mockFindMany = jest.fn().mockResolvedValue([
      {
        id: '2',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Evening Reception',
          startTime: '2026-06-20T18:00:00Z',
          endTime: '2026-06-20T22:00:00Z',
        },
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      },
      {
        id: '1',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Afternoon Ceremony',
          startTime: '2026-06-20T14:00:00Z',
          endTime: '2026-06-20T15:30:00Z',
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockFindMany },
    });
    const customService = new LogisticsService(customRepo);

    const nodes = await customService.getHomepageLogistics();

    expect(nodes.length).toBe(2);
    expect(nodes[0].id).toBe('1');
    expect(nodes[1].id).toBe('2');
    expect((nodes[0].data as any).title).toBe('Afternoon Ceremony');
    expect((nodes[0].data as any).isReadOnly).toBe(true);
  });

  it('returns public SubEvents as Schedule nodes even when ContentNode table is empty', async () => {
    const mockContentFindMany = jest.fn().mockResolvedValue([]);
    const mockSubEventFindMany = jest.fn().mockResolvedValue([
      {
        id: 'se-public-1',
        title: 'Garden Ceremony',
        description: 'Outdoor vows',
        startTime: new Date('2026-06-20T15:00:00.000Z'),
        endTime: new Date('2026-06-20T16:00:00.000Z'),
        locationName: 'Rose Garden',
        category: 'Ceremony',
        attireRules: 'Formal',
        isPrivate: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'se-public-tbd',
        title: 'Farewell Brunch',
        description: 'Time TBD',
        startTime: null,
        endTime: null,
        locationName: 'Terrace',
        category: 'Brunch',
        isPrivate: false,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockContentFindMany },
      subEvent: { findMany: mockSubEventFindMany },
    });

    const nodes = await customRepo.getLogisticsNodes();

    expect(mockSubEventFindMany).toHaveBeenCalledWith({
      where: { isPrivate: false },
      orderBy: { startTime: 'asc' },
    });
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).toBe('se-public-1');
    expect(nodes[0].type).toBe('Schedule');
    expect((nodes[0].data as any).isReadOnly).toBe(false);
    expect((nodes[0].data as any).isPrivate).toBe(false);
    expect(nodes[1].id).toBe('se-public-tbd');
    expect(nodes[1].type).toBe('Schedule');
  });

  it('excludes private Schedule and Logistics ContentNodes when SubEvent table is empty while keeping false/"false" public nodes', async () => {
    const mockContentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'priv-sched-bool',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Private Rehearsal Dinner',
          startTime: '2026-06-19T18:00:00.000Z',
          isPrivate: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'priv-log-str',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Private VIP Shuttle',
          description: 'VIP shuttle pickup instructions',
          isPrivate: 'true',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-sched-str-false',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Public Welcome Drinks',
          startTime: '2026-06-19T20:00:00.000Z',
          isPrivate: 'false',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-log',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Guest Parking',
          description: 'Complimentary valet at the main entrance.',
          isPrivate: false,
        },
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockContentFindMany },
      subEvent: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const customService = new LogisticsService(customRepo);

    const nodes = await customService.getHomepageLogistics();

    expect(nodes.map((n) => n.id)).toEqual(['pub-sched-str-false', 'pub-log']);
    expect((nodes[0].data as any).isReadOnly).toBe(true);
  });

  it('excludes private Logistics and Schedule ContentNodes when public SubEvents exist', async () => {
    const mockContentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'priv-log-vip',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'VIP Green Room',
          description: 'Private suite code 9999',
          isPrivate: 'TRUE',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'priv-sched',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Private Rehearsal',
          startTime: '2026-06-19T17:00:00.000Z',
          isPrivate: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-log-hotel',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Accommodations',
          description: 'Room block at The Grand Hotel',
          isPrivate: 'false',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const mockSubEventFindMany = jest.fn().mockResolvedValue([
      {
        id: 'se-pub-ceremony',
        title: 'Main Ceremony',
        description: 'All guests welcome',
        startTime: new Date('2026-06-20T16:00:00.000Z'),
        endTime: new Date('2026-06-20T17:00:00.000Z'),
        locationName: 'Main Lawn',
        category: 'Ceremony',
        isPrivate: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockContentFindMany },
      subEvent: { findMany: mockSubEventFindMany },
    });

    const nodes = await customRepo.getLogisticsNodes();

    expect(nodes.map((n) => n.id)).toEqual(['se-pub-ceremony', 'pub-log-hotel']);
  });

  it('returns an empty array when all Schedule ContentNodes are private and SubEvent is empty', async () => {
    const customRepo = new LogisticsRepository({
      contentNode: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'only-priv-1',
            type: 'Schedule',
            tags: ['Schedule'],
            data: {
              title: 'Hidden Rehearsal',
              startTime: '2026-06-19T18:00:00.000Z',
              isPrivate: true,
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            id: 'only-priv-2',
            type: 'Schedule',
            tags: ['Schedule'],
            data: {
              title: 'Hidden Brunch',
              startTime: '2026-06-21T10:00:00.000Z',
              isPrivate: 'true',
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
      },
      subEvent: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(customRepo.getLogisticsNodes()).resolves.toEqual([]);
  });

  it('queries FAQ nodes without requiring a Homepage tag, excludes hidden FAQs, and sorts by displayOrder then createdAt', async () => {
    const mockContentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'faq-order-2',
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Second FAQ',
          answer: 'Answer two',
          displayOrder: 2,
          isVisible: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'faq-hidden',
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'Hidden FAQ',
          answer: 'Secret draft',
          displayOrder: 0,
          isVisible: false,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'faq-order-1',
        type: 'FAQ',
        tags: [],
        data: {
          question: 'First FAQ',
          answer: 'Answer one',
          displayOrder: 1,
          isVisible: true,
        },
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      {
        id: 'faq-legacy-early',
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Legacy Early FAQ',
          answer: 'Created earlier without displayOrder',
        },
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'faq-legacy-late',
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Legacy Late FAQ',
          answer: 'Created later without displayOrder',
        },
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockContentFindMany },
      subEvent: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const customService = new LogisticsService(customRepo);

    const nodes = await customService.getHomepageLogistics();
    expect(mockContentFindMany).toHaveBeenCalledWith({
      where: {
        OR: expect.arrayContaining([
          { tags: { has: 'Homepage' } },
          { tags: { has: 'Schedule' } },
          { type: 'FAQ' },
        ]),
      },
    });
    expect(nodes.map((n) => n.id)).toEqual([
      'faq-order-1',
      'faq-order-2',
      'faq-legacy-early',
      'faq-legacy-late',
    ]);

    const visibleFaqs = await customService.getVisibleFaqs();
    expect(visibleFaqs.map((n) => n.id)).toEqual([
      'faq-order-1',
      'faq-order-2',
      'faq-legacy-early',
      'faq-legacy-late',
    ]);
  });

  it('returns generic mock FAQ nodes alongside Schedule and Logistics nodes when STATIC_EXPORT=true', async () => {
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';

    try {
      const staticRepo = new LogisticsRepository();
      const staticService = new LogisticsService(staticRepo);

      const allNodes = await staticService.getHomepageLogistics();
      const faqNodes = allNodes.filter((n) => n.type === 'FAQ');
      expect(faqNodes.length).toBeGreaterThanOrEqual(3);

      const visibleFaqs = await staticService.getVisibleFaqs();
      expect(visibleFaqs.length).toBe(faqNodes.length);
      expect(visibleFaqs.every((n) => n.type === 'FAQ')).toBe(true);
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });

  it('skips public SubEvent queries and parses when includePublicSubEvents is false', async () => {
    const mockContentFindMany = jest.fn().mockResolvedValue([
      {
        id: 'log-1',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Airport Shuttle',
          description: 'Hourly departures',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'sched-fallback-1',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Fallback Welcome Toast',
          startTime: '2026-06-19T18:00:00.000Z',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const mockSubEventFindMany = jest.fn().mockResolvedValue([
      {
        id: 'se-public-ignored',
        title: 'Public Ceremony',
        startTime: new Date('2026-06-20T15:00:00.000Z'),
        isPrivate: false,
      },
    ]);

    const customRepo = new LogisticsRepository({
      contentNode: { findMany: mockContentFindMany },
      subEvent: { findMany: mockSubEventFindMany },
    });
    const customService = new LogisticsService(customRepo);
    const parseSpy = jest.spyOn(ContentNodeSchema, 'parse');

    try {
      const nodes = await customService.getHomepageLogistics({ includePublicSubEvents: false });

      expect(mockSubEventFindMany).not.toHaveBeenCalled();
      expect(parseSpy).toHaveBeenCalledTimes(2);
      expect(nodes.map((n) => n.id)).toEqual(['sched-fallback-1', 'log-1']);
      expect((nodes[0].data as any).isReadOnly).toBe(true);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('shares in-flight homepage ContentNode parses with getVisibleFaqs within RequestContextStore when client === prisma', async () => {
    const rawRows = [
      {
        id: 'faq-shared-2',
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'When should we arrive?',
          answer: '30 minutes early.',
          displayOrder: 2,
          isVisible: true,
        },
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'faq-shared-1',
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Is parking free?',
          answer: 'Yes, complimentary valet.',
          displayOrder: 1,
          isVisible: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'faq-hidden-shared',
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'Draft FAQ',
          answer: 'Hidden',
          displayOrder: 0,
          isVisible: false,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'logistics-shared-1',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Hotel Shuttle',
          description: 'Departs at 3:15 PM',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const contentFindManyMock = prisma.contentNode.findMany as jest.Mock;
    const subEventFindManyMock = prisma.subEvent.findMany as jest.Mock;
    contentFindManyMock.mockClear();
    subEventFindManyMock.mockClear();
    contentFindManyMock.mockResolvedValue(rawRows);
    subEventFindManyMock.mockResolvedValue([]);

    const parseSpy = jest.spyOn(ContentNodeSchema, 'parse');

    try {
      const req = new NextRequest('http://localhost/');
      const [homepageNodes, visibleFaqs] = await runWithRequestContext(req, () =>
        Promise.all([
          logisticsService.getHomepageLogistics({ includePublicSubEvents: false }),
          logisticsService.getVisibleFaqs(),
        ])
      );

      expect(contentFindManyMock).toHaveBeenCalledTimes(1);
      expect(subEventFindManyMock).not.toHaveBeenCalled();
      expect(parseSpy).toHaveBeenCalledTimes(rawRows.length);
      expect(visibleFaqs.map((n) => n.id)).toEqual(['faq-shared-1', 'faq-shared-2']);
      expect(homepageNodes.map((n) => n.id)).toEqual([
        'logistics-shared-1',
        'faq-shared-1',
        'faq-shared-2',
      ]);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('avoids re-querying or re-parsing FAQ rows when getVisibleFaqs starts before getHomepageLogistics in the same request', async () => {
    const faqRows = [
      {
        id: 'faq-first-1',
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'Dress code?',
          answer: 'Black tie optional.',
          displayOrder: 1,
          isVisible: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const nonFaqRows = [
      {
        id: 'log-second-1',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Valet Gate',
          description: 'North entrance',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const contentFindManyMock = prisma.contentNode.findMany as jest.Mock;
    contentFindManyMock.mockClear();
    contentFindManyMock
      .mockResolvedValueOnce(faqRows)
      .mockResolvedValueOnce(nonFaqRows);

    const parseSpy = jest.spyOn(ContentNodeSchema, 'parse');

    try {
      const req = new NextRequest('http://localhost/');
      await runWithRequestContext(req, async () => {
        const faqsPromise = logisticsRepository.getVisibleFaqs();
        const homepageNodesPromise = logisticsRepository.getLogisticsNodes({
          includePublicSubEvents: false,
        });
        const [faqs, homepageNodes] = await Promise.all([faqsPromise, homepageNodesPromise]);

        expect(faqs.map((n) => n.id)).toEqual(['faq-first-1']);
        expect(homepageNodes.map((n) => n.id)).toEqual(['log-second-1', 'faq-first-1']);
      });

      expect(contentFindManyMock).toHaveBeenCalledTimes(2);
      expect(contentFindManyMock).toHaveBeenNthCalledWith(1, {
        where: { type: 'FAQ' },
      });
      expect(contentFindManyMock).toHaveBeenNthCalledWith(2, {
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
      });
      expect(parseSpy).toHaveBeenCalledTimes(faqRows.length + nonFaqRows.length);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('evicts rejected ContentNode promises from RequestContextStore so subsequent calls recover', async () => {
    const contentFindManyMock = prisma.contentNode.findMany as jest.Mock;
    contentFindManyMock.mockClear();
    contentFindManyMock
      .mockRejectedValueOnce(new Error('Transient connection reset'))
      .mockResolvedValueOnce([
        {
          id: 'faq-recovered',
          type: 'FAQ',
          tags: ['FAQ'],
          data: {
            question: 'Recovered FAQ',
            answer: 'Loaded on retry',
            isVisible: true,
          },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);

    const req = new NextRequest('http://localhost/registry');
    await runWithRequestContext(req, async () => {
      await expect(logisticsRepository.getVisibleFaqs()).rejects.toThrow(
        'Transient connection reset'
      );

      const recovered = await logisticsRepository.getVisibleFaqs();
      expect(recovered.map((n) => n.id)).toEqual(['faq-recovered']);
    });

    expect(contentFindManyMock).toHaveBeenCalledTimes(2);
  });
});
