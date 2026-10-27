/** @jest-environment node */

import { WeddingPartyRepository } from '../repository';

describe('WeddingPartyRepository', () => {
  let mockClient: any;
  let repo: WeddingPartyRepository;

  beforeEach(() => {
    mockClient = {
      weddingPartyMember: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(mockClient)),
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
  });

  describe('reorderMembers', () => {
    it('updates sequence numbers transactionally for valid ordered IDs', async () => {
      const orderedIds = ['id-1', 'id-2'];
      mockClient.weddingPartyMember.findMany
        .mockResolvedValueOnce([{ id: 'id-1' }, { id: 'id-2' }]) // existence check
        .mockResolvedValueOnce([ // findMany in transaction
          {
            id: 'id-1',
            name: 'Member 1',
            role: 'Role 1',
            bio: 'Bio',
            side: 'BRIDE',
            link: 'https://example.com',
            order: 0,
            isSample: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'id-2',
            name: 'Member 2',
            role: 'Role 2',
            bio: 'Bio',
            side: 'GROOM',
            link: 'https://example.com',
            order: 1,
            isSample: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

      mockClient.weddingPartyMember.update.mockResolvedValue({ id: 'updated' });

      const reordered = await repo.reorderMembers(orderedIds);

      expect(mockClient.weddingPartyMember.findMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: orderedIds } },
        select: { id: true },
      });
      expect(mockClient.weddingPartyMember.update).toHaveBeenCalledTimes(2);
      expect(mockClient.weddingPartyMember.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'id-1' },
        data: { order: 0 },
      });
      expect(mockClient.weddingPartyMember.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'id-2' },
        data: { order: 1 },
      });
      expect(reordered).toHaveLength(2);
    });

    it('throws an error if empty orderedIds array is provided', async () => {
      await expect(repo.reorderMembers([])).rejects.toThrow('Ordered IDs array cannot be empty');
    });

    it('throws an error if any requested member ID does not exist', async () => {
      mockClient.weddingPartyMember.findMany.mockResolvedValueOnce([{ id: 'id-1' }]);

      await expect(repo.reorderMembers(['id-1', 'id-missing'])).rejects.toThrow(
        'Invalid member ID(s): id-missing'
      );
      expect(mockClient.weddingPartyMember.update).not.toHaveBeenCalled();
    });
  });
});
