/** @jest-environment node */

import { WeddingPartyRepository } from '../repository';

describe('WeddingPartyRepository', () => {
  let mockClient: any;
  let repo: WeddingPartyRepository;

  beforeEach(() => {
    mockClient = {
      weddingPartyMember: {
        findMany: jest.fn(),
      },
    };
    repo = new WeddingPartyRepository(mockClient);
  });

  describe('getMembers', () => {
    it('queries members ordered by display order asc', async () => {
      mockClient.weddingPartyMember.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'Jane Doe',
          role: 'Maid of Honor',
          bio: 'Bio text',
          side: 'BRIDE',
          link: 'https://example.com',
          order: 0,
          isSample: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await repo.getMembers();
      expect(mockClient.weddingPartyMember.findMany).toHaveBeenCalledWith({
        orderBy: { order: 'asc' },
        include: { photo: true },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Jane Doe');
    });

    it('skips Prisma queries and returns validated mock members during STATIC_EXPORT builds', async () => {
      const prevStaticExport = process.env.STATIC_EXPORT;
      process.env.STATIC_EXPORT = 'true';

      try {
        const result = await repo.getMembers();
        expect(mockClient.weddingPartyMember.findMany).not.toHaveBeenCalled();
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].name).toBe('Jessica Davis');
        expect(result[0].photo?.url).toBeTruthy();
      } finally {
        if (prevStaticExport === undefined) {
          delete process.env.STATIC_EXPORT;
        } else {
          process.env.STATIC_EXPORT = prevStaticExport;
        }
      }
    });
  });
});
