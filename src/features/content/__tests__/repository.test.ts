import { ContentRepository } from '../repository';

describe('ContentRepository.getPendingPhotos', () => {
  let mockPrisma: any;
  let repo: ContentRepository;

  beforeEach(() => {
    mockPrisma = {
      contentNode: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repo = new ContentRepository(mockPrisma);
  });

  it('queries database with JSON path filter, tags criteria, limit, page, and ordering', async () => {
    const mockDbNodes = [
      {
        id: 'node-1',
        type: 'Photo',
        tags: ['guest-upload'],
        data: { url: '/p1.png', status: 'PENDING', isVisible: false },
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      },
    ];

    mockPrisma.contentNode.count.mockResolvedValueOnce(15);
    mockPrisma.contentNode.findMany.mockResolvedValueOnce(mockDbNodes);

    const result = await repo.getPendingPhotos({ page: 2, limit: 5 });

    expect(mockPrisma.contentNode.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: 'Photo',
        OR: expect.arrayContaining([
          expect.objectContaining({
            data: { path: ['status'], equals: 'PENDING' },
          }),
          expect.objectContaining({
            tags: { has: 'guest-upload' },
            data: { path: ['isVisible'], equals: false },
          }),
        ]),
      }),
    });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: 'Photo',
      }),
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].id).toBe('node-1');
    expect(result.total).toBe(15);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.totalPages).toBe(3);
  });

  it('uses default page 1 and limit 50 when options are empty or invalid', async () => {
    mockPrisma.contentNode.count.mockResolvedValueOnce(0);
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    const result = await repo.getPendingPhotos({ page: -1, limit: 'invalid' as any });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: expect.any(Object),
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});
