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

  it('filters updatedAt with gt cursor when since is provided as a Date or ISO string', async () => {
    const sinceDate = new Date('2026-06-20T18:00:00.000Z');
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    await repo.getNodesByType('Photo', { since: sinceDate });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        updatedAt: { gt: sinceDate },
      },
      orderBy: { createdAt: 'desc' },
    });

    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);
    await repo.getNodesByType('Photo', { since: '2026-06-20T18:00:00.000Z' });

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        updatedAt: { gt: sinceDate },
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

      const publicPhotos = await strictRepo.getPublicPhotos({
        since: '2025-01-01T00:00:00.000Z',
        limit: 5,
      });
      expect(publicPhotos.length).toBeGreaterThan(0);
      expect(publicPhotos[0].type).toBe('Photo');
      expect(strictRepo.client.contentNode.findMany).not.toHaveBeenCalled();
      expect(strictRepo.client.media.findMany).not.toHaveBeenCalled();

      const otherNodes = await strictRepo.getNodesByType('CustomSection');
      expect(otherNodes).toEqual([]);
      expect(strictRepo.client.contentNode.findMany).not.toHaveBeenCalled();

      const boundIds = await strictRepo.getEntityBoundMediaIds(['media-1']);
      expect(boundIds.size).toBe(0);
      expect(strictRepo.client.media.findMany).not.toHaveBeenCalled();

      const pending = await strictRepo.getPendingPhotos();
      expect(pending.photos.length).toBeGreaterThan(0);
      expect(pending.photos.every((p) => p.type === 'Photo')).toBe(true);
      expect(strictRepo.client.contentNode.count).not.toHaveBeenCalled();

      const features = await strictRepo.getFeatures();
      expect(features.length).toBeGreaterThan(0);
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

describe('ContentRepository.getPublicPhotos', () => {
  let mockPrisma: any;
  let repo: ContentRepository;

  beforeEach(() => {
    mockPrisma = {
      contentNode: {
        findMany: jest.fn(),
      },
      media: {
        findMany: jest.fn(),
      },
    };
    repo = new ContentRepository(mockPrisma);
  });

  it('filters approved visible Photo rows in SQL ordered by createdAt desc without querying media when no candidate mediaIds exist', async () => {
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([
      {
        id: 'pub-1',
        type: 'Photo',
        tags: ['gallery'],
        data: { url: '/uploads/photos/p1.jpg', status: 'APPROVED', isVisible: true },
        createdAt: new Date('2026-06-20T18:00:00.000Z'),
        updatedAt: new Date('2026-06-20T18:00:00.000Z'),
      },
    ]);

    const result = await repo.getPublicPhotos();

    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        AND: [
          { data: { path: ['status'], equals: 'APPROVED' } },
          { data: { path: ['isVisible'], equals: true } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(mockPrisma.media.findMany).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('pub-1');
  });

  it('applies since cursor and bounded limit (capped at 100) with pre-limit entity media exclusion', async () => {
    const sinceDate = new Date('2026-06-20T18:00:00.000Z');
    mockPrisma.media.findMany.mockResolvedValueOnce([{ id: 'bound-media-1' }]);
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([]);

    await repo.getPublicPhotos({ since: '2026-06-20T18:00:00.000Z', limit: 200 });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { weddingPartyMembers: { some: {} } },
          { attractions: { some: {} } },
          { registryItems: { some: {} } },
        ],
      },
      select: { id: true },
    });
    expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        type: 'Photo',
        updatedAt: { gt: sinceDate },
        AND: [
          { data: { path: ['status'], equals: 'APPROVED' } },
          { data: { path: ['isVisible'], equals: true } },
          {
            OR: expect.arrayContaining([
              { tags: { has: 'guest-upload' } },
              { data: { path: ['publishToGallery'], equals: true } },
              expect.objectContaining({
                NOT: {
                  OR: [{ data: { path: ['mediaId'], equals: 'bound-media-1' } }],
                },
              }),
            ]),
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('excludes entity-bound media on unbounded requests unless publishToGallery is true or tagged guest-upload, and accepts legacy URLs', async () => {
    mockPrisma.contentNode.findMany.mockResolvedValueOnce([
      {
        id: 'legacy-approved',
        type: 'Photo',
        tags: ['gallery'],
        data: { url: '/../legacy-stored-photo.jpg', status: 'APPROVED', isVisible: true },
        createdAt: new Date('2026-06-20T18:03:00.000Z'),
        updatedAt: new Date('2026-06-20T18:03:00.000Z'),
      },
      {
        id: 'bound-hidden',
        type: 'Photo',
        tags: ['gallery'],
        data: { url: '/uploads/kettle.jpg', status: 'APPROVED', isVisible: true, mediaId: 'reg-1' },
        createdAt: new Date('2026-06-20T18:02:00.000Z'),
        updatedAt: new Date('2026-06-20T18:02:00.000Z'),
      },
      {
        id: 'bound-published',
        type: 'Photo',
        tags: ['gallery', 'curated'],
        data: {
          url: '/uploads/party.jpg',
          status: 'APPROVED',
          isVisible: true,
          mediaId: 'party-1',
          publishToGallery: true,
        },
        createdAt: new Date('2026-06-20T18:01:00.000Z'),
        updatedAt: new Date('2026-06-20T18:01:00.000Z'),
      },
    ]);
    mockPrisma.media.findMany.mockResolvedValueOnce([{ id: 'reg-1' }]);

    const result = await repo.getPublicPhotos();

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['reg-1'] },
        OR: [
          { weddingPartyMembers: { some: {} } },
          { attractions: { some: {} } },
          { registryItems: { some: {} } },
        ],
      },
      select: { id: true },
    });
    expect(result.map((n) => n.id)).toEqual(['legacy-approved', 'bound-published']);
  });
});

describe('ContentRepository.approvePhotosBatch & rejectPhotosBatch', () => {
  it('returns empty array immediately when given empty IDs without starting a transaction', async () => {
    const mockClient = {
      $transaction: jest.fn(),
    };
    const repo = new ContentRepository(mockClient);

    await expect(repo.approvePhotosBatch([])).resolves.toEqual([]);
    await expect(repo.rejectPhotosBatch([])).resolves.toEqual([]);
    expect(mockClient.$transaction).not.toHaveBeenCalled();
  });

  it('approves photo nodes via fallback findMany + update when $queryRaw is absent and records bulk audit snapshots', async () => {
    const now = new Date('2026-06-20T18:00:00.000Z');
    const txClient = {
      contentNode: {
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: 'p1',
            type: 'Photo',
            tags: ['gallery', 'guest-upload'],
            data: { url: '/uploads/photos/p1.jpg', status: 'PENDING', isVisible: false, caption: 'Toast' },
            createdAt: now,
            updatedAt: now,
          },
        ]),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => ({
          id: where.id,
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: data.data,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })),
      },
      snapshotVersion: {
        createMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
      },
    };
    const mockClient = {
      $transaction: jest.fn(async (fn: (_tx: typeof txClient) => Promise<unknown>) => fn(txClient)),
    };

    const repo = new ContentRepository(mockClient);
    const updated = await repo.approvePhotosBatch(['p1', 'p1', 'missing'], 'AdminTest');

    expect(mockClient.$transaction).toHaveBeenCalledTimes(1);
    expect(txClient.contentNode.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1', 'missing'] }, type: 'Photo' },
    });
    expect(txClient.snapshotVersion.createMany).toHaveBeenCalledTimes(1);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual(
      expect.objectContaining({
        id: 'p1',
        data: expect.objectContaining({
          status: 'APPROVED',
          isVisible: true,
          caption: 'Toast',
        }),
      })
    );
  });

  it('rejects photo nodes via fallback findMany + deleteMany, skips entity-bound and still-referenced media, and unlinks standalone URLs after commit', async () => {
    const events: string[] = [];
    const { LocalStorageProvider, resetStorageProvider } = await import('@/utils/storage');
    resetStorageProvider();
    const deleteSpy = jest
      .spyOn(LocalStorageProvider.prototype, 'delete')
      .mockImplementation(async (url: string) => {
        events.push(`unlink:${url}`);
      });

    const now = new Date('2026-06-20T18:00:00.000Z');
    const txClient = {
      contentNode: {
        findMany: jest.fn().mockResolvedValueOnce([
          {
            id: 'p-bound',
            type: 'Photo',
            tags: ['gallery'],
            data: { url: '/uploads/photos/bound.jpg', mediaId: 'm-bound', status: 'PENDING', isVisible: false },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'p-shared',
            type: 'Photo',
            tags: ['gallery'],
            data: { url: '/uploads/photos/shared.jpg', mediaId: 'm-shared', status: 'PENDING', isVisible: false },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'p-standalone',
            type: 'Photo',
            tags: ['gallery', 'guest-upload'],
            data: { url: '/uploads/photos/standalone.jpg', status: 'PENDING', isVisible: false },
            createdAt: now,
            updatedAt: now,
          },
        ]),
        deleteMany: jest.fn(async () => {
          events.push('tx.contentNode.deleteMany');
          return { count: 3 };
        }),
      },
      media: {
        findMany: jest
          .fn()
          // 1st call: getEntityBoundMediaIds
          .mockResolvedValueOnce([{ id: 'm-bound' }])
          // 2nd call: MediaRepository.deleteMediaBatch fallback candidateMedia (m-shared not deletable)
          .mockResolvedValueOnce([])
          // 3rd call: remainingIds check -> m-shared still exists in Media
          .mockResolvedValueOnce([{ id: 'm-shared' }]),
        deleteMany: jest.fn(),
      },
      snapshotVersion: {
        createMany: jest.fn(async () => {
          events.push('tx.snapshot.createMany');
          return { count: 3 };
        }),
      },
    };
    const mockClient = {
      $transaction: jest.fn(async (fn: (_tx: typeof txClient) => Promise<unknown>) => {
        events.push('tx.begin');
        const res = await fn(txClient);
        events.push('tx.commit');
        return res;
      }),
    };

    try {
      const repo = new ContentRepository(mockClient);
      const deletedIds = await repo.rejectPhotosBatch(
        ['p-bound', 'p-shared', 'p-standalone'],
        'AdminReject'
      );

      expect(mockClient.$transaction).toHaveBeenCalledTimes(1);
      expect(deletedIds).toEqual(['p-bound', 'p-shared', 'p-standalone']);
      expect(txClient.media.deleteMany).not.toHaveBeenCalled();
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith('/uploads/photos/standalone.jpg');
      expect(events.indexOf('unlink:/uploads/photos/standalone.jpg')).toBeGreaterThan(
        events.indexOf('tx.commit')
      );
    } finally {
      deleteSpy.mockRestore();
      resetStorageProvider();
    }
  });
});


