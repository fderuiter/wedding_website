import { LogisticsRepository } from '../repository';
import { LogisticsService } from '../service';
import type { ContentNodeDTO } from '@/features/content/schemas';

describe('LogisticsRepository Chronological Sorting', () => {
  let repo: LogisticsRepository;
  let service: LogisticsService;

  beforeEach(() => {
    repo = new LogisticsRepository();
    service = new LogisticsService(repo);
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
  });
});
