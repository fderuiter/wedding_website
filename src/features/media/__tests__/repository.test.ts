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
