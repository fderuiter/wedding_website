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

describe('ContentRepository.getNodesByType', () => {
  let mockPrisma: any;
  let repo: ContentRepository;

  beforeEach(() => {
    mockPrisma = {
      contentNode: {
        findMany: jest.fn(),
      },
    };
    repo = new ContentRepository(mockPrisma);
  });

  it('queries nodes by type with default desc ordering when no options provided', async () => {
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    await repo.getNodesByType('Photo');

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: { type: 'Photo' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('filters createdAt with gt cursor when since is provided as a Date or ISO string', async () => {
    const sinceDate = new Date('2026-06-20T18:00:00.000Z');
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    await repo.getNodesByType('Photo', { since: sinceDate });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        createdAt: { gt: sinceDate },
      },
      orderBy: { createdAt: 'desc' },
    });

    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);
    await repo.getNodesByType('Photo', { since: '2026-06-20T18:00:00.000Z' });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        createdAt: { gt: sinceDate },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('applies bounded limit when limit option is provided', async () => {
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    await repo.getNodesByType('Photo', { limit: 20 });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: { type: 'Photo' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);
    await repo.getNodesByType('Photo', { limit: 150 });

    // Capped at 100
    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: { type: 'Photo' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('loads pre-existing Photo rows with legacy invalid URLs on getNodeById and getPendingPhotos so moderation can reject them', async () => {
    const legacyRow = {
      id: 'legacy-photo-1',
      type: 'Photo',
      tags: ['gallery'],
      data: { url: '/../canary-outside-public.txt', status: 'PENDING', isVisible: false },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };

    const repoWithFindUnique = new ContentRepository({
      contentNode: {
        count: jest.fn().mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValueOnce([legacyRow]),
        findUnique: jest.fn().mockResolvedValueOnce(legacyRow),
      },
    });

    const node = await repoWithFindUnique.getNodeById('legacy-photo-1');
    expect(node).toEqual(expect.objectContaining({
      id: 'legacy-photo-1',
      type: 'Photo',
      data: expect.objectContaining({ url: '/../canary-outside-public.txt' }),
    }));

    const pending = await repoWithFindUnique.getPendingPhotos();
    expect(pending.photos).toHaveLength(1);
    expect(pending.photos[0].id).toBe('legacy-photo-1');
  });

  it('skips Prisma queries and returns mock Photo nodes during STATIC_EXPORT builds', async () => {
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';

    const strictRepo = new ContentRepository({
      contentNode: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      media: {
        findMany: jest.fn(),
      },
      appConfig: {
        findUnique: jest.fn(),
      },
    });

    try {
      const photos = await strictRepo.getNodesByType('Photo');
      expect(photos.length).toBeGreaterThan(0);
      expect(photos[0].type).toBe('Photo');
      expect(strictRepo.client.contentNode.findMany).not.toHaveBeenCalled();

      const otherNodes = await strictRepo.getNodesByType('CustomSection');
      expect(otherNodes).toEqual([]);
      expect(strictRepo.client.contentNode.findMany).not.toHaveBeenCalled();

      const boundIds = await strictRepo.getEntityBoundMediaIds(['media-1']);
      expect(boundIds.size).toBe(0);
      expect(strictRepo.client.media.findMany).not.toHaveBeenCalled();

      const pending = await strictRepo.getPendingPhotos();
      expect(pending.photos).toEqual([]);
      expect(strictRepo.client.contentNode.count).not.toHaveBeenCalled();

      const features = await strictRepo.getFeatures();
      expect(features).toEqual([]);
      expect(strictRepo.client.appConfig.findUnique).not.toHaveBeenCalled();
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });
});

