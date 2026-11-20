import { LogisticsRepository } from '../repository';
import { LogisticsService } from '../service';
import type { ContentNodeDTO } from '@/features/content';

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

    const nodes = await customService.getScheduleNodes();

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
});
