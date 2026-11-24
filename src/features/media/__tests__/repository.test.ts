/** @jest-environment node */

import { MediaRepository } from '../repository';

describe('MediaRepository.getAllMedia', () => {
  let mockPrisma: any;
  let repo: MediaRepository;

  beforeEach(() => {
    mockPrisma = {
      media: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repo = new MediaRepository(mockPrisma);
  });

  test('applies default pagination parameters (page=1, limit=20) when options are omitted', async () => {
    mockPrisma.media.count.mockResolvedValue(5);
    mockPrisma.media.findMany.mockResolvedValue([
      { id: '1', url: 'https://example.com/1.jpg', altText: 'One', isDecorative: false, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await repo.getAllMedia();

    expect(mockPrisma.media.count).toHaveBeenCalledTimes(1);
    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    expect(result).toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({ id: '1', url: 'https://example.com/1.jpg' }),
      ]),
      total: 5,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  test('applies explicit page and limit skip/take parameters', async () => {
    mockPrisma.media.count.mockResolvedValue(25);
    mockPrisma.media.findMany.mockResolvedValue([]);

    const result = await repo.getAllMedia({ page: 2, limit: 10 });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    expect(result).toEqual({
      data: [],
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
  });

  test('caps limit at maximum of 100 items', async () => {
    mockPrisma.media.count.mockResolvedValue(150);
    mockPrisma.media.findMany.mockResolvedValue([]);

    const result = await repo.getAllMedia({ page: 1, limit: 500 });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    expect(result.limit).toBe(100);
    expect(result.totalPages).toBe(2);
  });

  test('falls back safely to page=1 and limit=20 for invalid or out-of-bounds parameters', async () => {
    mockPrisma.media.count.mockResolvedValue(0);
    mockPrisma.media.findMany.mockResolvedValue([]);

    const result = await repo.getAllMedia({ page: -5, limit: -10 });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(0);
  });

  test('handles non-numeric strings or NaN parameters safely', async () => {
    mockPrisma.media.count.mockResolvedValue(12);
    mockPrisma.media.findMany.mockResolvedValue([]);

    const result = await repo.getAllMedia({ page: 'abc' as any, limit: 'xyz' as any });

    expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
  });
});

describe('MediaRepository.deleteMedia storage cleanup', () => {
  it('deletes underlying storage object after DB transaction commits and skips storage delete when transaction fails', async () => {
    const events: string[] = [];
    const { LocalStorageProvider, resetStorageProvider } = await import('@/utils/storage');
    resetStorageProvider();
    const deleteSpy = jest
      .spyOn(LocalStorageProvider.prototype, 'delete')
      .mockImplementation(async () => {
        events.push('storage.delete');
      });

    const now = new Date();
    const txClient = {
      contentNode: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'photo-node-1',
            type: 'Photo',
            tags: ['gallery'],
            data: { mediaId: 'media-1', url: '/uploads/photos/cleanup.jpg' },
          },
        ]),
        delete: jest.fn(async () => {
          events.push('tx.contentNode.delete');
        }),
      },
      media: {
        delete: jest.fn(async () => {
          events.push('tx.media.delete');
          return {
            id: 'media-1',
            url: '/uploads/photos/cleanup.jpg',
            altText: 'Cleanup Photo',
            isDecorative: false,
            isSample: false,
            createdAt: now,
            updatedAt: now,
          };
        }),
      },
      snapshotVersion: {
        create: jest.fn(async () => {
          events.push('tx.snapshot.create');
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
      const repo = new MediaRepository(mockClient);
      const deleted = await repo.deleteMedia('media-1', 'Admin');

      expect(deleted.id).toBe('media-1');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith('/uploads/photos/cleanup.jpg');
      expect(events.indexOf('tx.commit')).toBeGreaterThan(-1);
      expect(events.indexOf('storage.delete')).toBeGreaterThan(events.indexOf('tx.commit'));

      // Verify rollback does NOT invoke storage.delete
      deleteSpy.mockClear();
      const failingClient = {
        $transaction: jest.fn(async () => {
          throw new Error('DB deadlock rollback');
        }),
      };
      const failingRepo = new MediaRepository(failingClient);
      await expect(failingRepo.deleteMedia('media-1', 'Admin')).rejects.toThrow('DB deadlock rollback');
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      deleteSpy.mockRestore();
      resetStorageProvider();
    }
  });
});

describe('MediaRepository.deleteMediaBatch post-commit bounded storage cleanup', () => {
  it('commits batch deletion in one transaction, deduplicates shared URLs, caps concurrent storage deletes at 8 workers, and tolerates storage errors', async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const { LocalStorageProvider, resetStorageProvider } = await import('@/utils/storage');
    const { logger } = await import('@/lib/logger');
    resetStorageProvider();

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const deleteSpy = jest
      .spyOn(LocalStorageProvider.prototype, 'delete')
      .mockImplementation(async (url: string) => {
        events.push(`storage.delete:${url}`);
        inFlight += 1;
        if (inFlight > maxInFlight) {
          maxInFlight = inFlight;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        if (url === '/uploads/photos/fail-unlink.jpg') {
          throw new Error('Simulated S3 transient 503');
        }
      });

    const now = new Date();
    const mediaRows = Array.from({ length: 22 }, (_, i) => {
      const url =
        i < 3
          ? '/uploads/photos/shared-asset.jpg'
          : i === 3
            ? '/uploads/photos/fail-unlink.jpg'
            : i === 4
              ? '/../outside-root-canary.txt'
              : `/uploads/photos/batch-${i}.jpg`;
      return {
        id: `media-batch-${i}`,
        url,
        altText: `Photo ${i}`,
        isDecorative: false,
        isSample: false,
        createdAt: now,
        updatedAt: now,
      };
    });

    const txClient = {
      contentNode: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      media: {
        findMany: jest.fn().mockResolvedValue(mediaRows),
        deleteMany: jest.fn(async () => {
          events.push('tx.media.deleteMany');
          return { count: mediaRows.length };
        }),
      },
      snapshotVersion: {
        createMany: jest.fn(async () => {
          events.push('tx.snapshot.createMany');
          return { count: mediaRows.length };
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
      const repo = new MediaRepository(mockClient);
      const deleted = await repo.deleteMediaBatch(
        mediaRows.map((m) => m.id),
        'AdminBatch'
      );

      expect(mockClient.$transaction).toHaveBeenCalledTimes(1);
      expect(deleted).toHaveLength(22);

      // 3 items share '/uploads/photos/shared-asset.jpg' (1 call), 1 fails gracefully (1 call),
      // 1 is out-of-root '/../outside-root-canary.txt' (0 calls), and 17 are distinct '/uploads/photos/batch-*.jpg' = 19 calls
      expect(deleteSpy).toHaveBeenCalledTimes(19);
      expect(deleteSpy).not.toHaveBeenCalledWith('/../outside-root-canary.txt');
      expect(maxInFlight).toBeLessThanOrEqual(8);
      expect(maxInFlight).toBeGreaterThan(1);

      const commitIdx = events.indexOf('tx.commit');
      const firstStorageIdx = events.findIndex((entry) => entry.startsWith('storage.delete:'));
      expect(commitIdx).toBeGreaterThan(-1);
      expect(firstStorageIdx).toBeGreaterThan(commitIdx);
      expect(warnSpy).toHaveBeenCalledWith(
        '[MediaRepository.deleteMediaBatch] Storage cleanup failed after DB commit',
        expect.objectContaining({
          url: '/uploads/photos/fail-unlink.jpg',
          error: 'Simulated S3 transient 503',
        })
      );

      // Verify DB transaction failure aborts before any storage delete runs
      deleteSpy.mockClear();
      const rollbackClient = {
        $transaction: jest.fn(async () => {
          throw new Error('Serialization failure');
        }),
      };
      const rollbackRepo = new MediaRepository(rollbackClient);
      await expect(
        rollbackRepo.deleteMediaBatch(['media-batch-0', 'media-batch-1'], 'AdminBatch')
      ).rejects.toThrow('Serialization failure');
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      deleteSpy.mockRestore();
      resetStorageProvider();
    }
  });
});
