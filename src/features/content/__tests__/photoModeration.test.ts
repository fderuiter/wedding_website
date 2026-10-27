import { ContentService } from '../service';
import { IContentRepository } from '../types';

describe('Photo Moderation Service & Visibility Rules', () => {
  let mockRepo: jest.Mocked<IContentRepository>;
  let service: ContentService;

  beforeEach(() => {
    mockRepo = {
      getFeatures: jest.fn(),
      updateFeatures: jest.fn(),
      getNodesByType: jest.fn(),
      getAllNodes: jest.fn(),
      getNodeById: jest.fn(),
      createNode: jest.fn(),
      updateNode: jest.fn(),
      deleteNode: jest.fn(),
    };
    service = new ContentService(mockRepo);
  });

  describe('getPublicPhotos', () => {
    it('returns only approved photos and legacy visible photos, filtering out PENDING and REJECTED uploads', async () => {
      const now = new Date();
      const mockPhotoNodes = [
        {
          id: 'photo-approved',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: { url: '/photo1.png', status: 'APPROVED', isVisible: true },
          createdAt: new Date(now.getTime() - 10000),
          updatedAt: new Date(),
        },
        {
          id: 'photo-pending',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: { url: '/photo2.png', status: 'PENDING', isVisible: false },
          createdAt: new Date(now.getTime() - 5000),
          updatedAt: new Date(),
        },
        {
          id: 'photo-rejected',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: { url: '/photo3.png', status: 'REJECTED', isVisible: false },
          createdAt: new Date(now.getTime() - 2000),
          updatedAt: new Date(),
        },
        {
          id: 'photo-legacy',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: { url: '/photo4.png', isVisible: true },
          createdAt: new Date(now.getTime() - 20000),
          updatedAt: new Date(),
        },
      ];

      mockRepo.getNodesByType.mockResolvedValueOnce(mockPhotoNodes);

      const publicPhotos = await service.getPublicPhotos();

      expect(publicPhotos).toHaveLength(2);
      expect(publicPhotos.map((p) => p.id)).toEqual(['photo-approved', 'photo-legacy']);
    });
  });

  describe('getPendingPhotos', () => {
    it('returns only photos waiting for moderation', async () => {
      const mockPhotoNodes = [
        {
          id: 'photo-approved',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: { url: '/photo1.png', status: 'APPROVED', isVisible: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'photo-pending-1',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: { url: '/photo2.png', status: 'PENDING', isVisible: false },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepo.getNodesByType.mockResolvedValueOnce(mockPhotoNodes);

      const pending = await service.getPendingPhotos();

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('photo-pending-1');
    });

    it('delegates to repo.getPendingPhotos when repo implements it', async () => {
      const mockResult = {
        photos: [
          {
            id: 'photo-pending-2',
            type: 'Photo' as const,
            tags: ['guest-upload'],
            data: { url: '/p2.png', status: 'PENDING', isVisible: false },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 10,
        page: 2,
        limit: 5,
        totalPages: 2,
      };

      mockRepo.getPendingPhotos = jest.fn().mockResolvedValueOnce(mockResult);

      const result = await service.getPendingPhotos({ page: 2, limit: 5 });

      expect(mockRepo.getPendingPhotos).toHaveBeenCalledWith({ page: 2, limit: 5 });
      expect(result.photos).toEqual(mockResult.photos);
      expect(result.total).toBe(10);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(5);
      expect(result.totalPages).toBe(2);
    });
  });

  describe('moderatePhoto', () => {
    it('approves a pending photo by setting status APPROVED and isVisible true', async () => {
      const pendingNode = {
        id: 'photo-1',
        type: 'Photo' as const,
        tags: ['gallery', 'guest-upload'],
        data: { url: '/photo1.png', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockResolvedValueOnce(pendingNode);
      mockRepo.updateNode!.mockResolvedValueOnce({
        ...pendingNode,
        data: { ...pendingNode.data, status: 'APPROVED', isVisible: true },
      });

      const result = await service.moderatePhoto('photo-1', 'approve', 'AdminUser');

      expect(mockRepo.updateNode).toHaveBeenCalledWith(
        'photo-1',
        {
          data: expect.objectContaining({
            status: 'APPROVED',
            isVisible: true,
          }),
        },
        'AdminUser'
      );
      expect(result.data.status).toBe('APPROVED');
      expect(result.data.isVisible).toBe(true);
    });

    it('rejects a photo and deletes storage/database references', async () => {
      const pendingNode = {
        id: 'photo-2',
        type: 'Photo' as const,
        tags: ['gallery', 'guest-upload'],
        data: { url: '/photo2.png', mediaId: 'media-2', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockResolvedValueOnce(pendingNode);
      mockRepo.deleteNode!.mockResolvedValueOnce(undefined);

      const result = await service.moderatePhoto('photo-2', 'reject', 'AdminUser');

      expect(mockRepo.deleteNode).toHaveBeenCalledWith('photo-2', 'AdminUser');
      expect(result.deleted).toBe(true);
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('moderatePhotosBatch', () => {
    it('batch approves multiple photos', async () => {
      const node1 = {
        id: 'p1',
        type: 'Photo' as const,
        tags: ['gallery'],
        data: { url: '/p1.png', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const node2 = {
        id: 'p2',
        type: 'Photo' as const,
        tags: ['gallery'],
        data: { url: '/p2.png', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockImplementation(async (id: string) => {
        if (id === 'p1') return node1;
        if (id === 'p2') return node2;
        return null;
      });
      mockRepo.updateNode!.mockImplementation(async (id: string, data: any) => ({
        id,
        type: 'Photo',
        tags: ['gallery'],
        data: { ...(id === 'p1' ? node1.data : node2.data), ...data.data },
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const res = await service.moderatePhotosBatch(['p1', 'p2'], 'approve', 'AdminUser');

      expect(res.total).toBe(2);
      expect(res.succeededCount).toBe(2);
      expect(res.failedCount).toBe(0);
      expect(res.results).toHaveLength(2);
      expect(res.results[0]).toEqual(expect.objectContaining({ id: 'p1', success: true }));
      expect(res.results[1]).toEqual(expect.objectContaining({ id: 'p2', success: true }));
    });

    it('batch rejects multiple photos and removes nodes/storage', async () => {
      const node1 = {
        id: 'p1',
        type: 'Photo' as const,
        tags: ['gallery'],
        data: { url: '/p1.png', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockResolvedValue(node1);
      mockRepo.deleteNode!.mockResolvedValue(undefined);

      const res = await service.moderatePhotosBatch(['p1'], 'reject', 'AdminUser');

      expect(res.total).toBe(1);
      expect(res.succeededCount).toBe(1);
      expect(res.failedCount).toBe(0);
      expect(mockRepo.deleteNode).toHaveBeenCalledWith('p1', 'AdminUser');
    });

    it('handles partial failures gracefully', async () => {
      const node1 = {
        id: 'p1',
        type: 'Photo' as const,
        tags: ['gallery'],
        data: { url: '/p1.png', status: 'PENDING', isVisible: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockImplementation(async (id: string) => {
        if (id === 'p1') return node1;
        return null;
      });
      mockRepo.updateNode!.mockResolvedValue({
        id: 'p1',
        type: 'Photo',
        tags: ['gallery'],
        data: { ...node1.data, status: 'APPROVED', isVisible: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.moderatePhotosBatch(['p1', 'nonexistent'], 'approve', 'AdminUser');

      expect(res.total).toBe(2);
      expect(res.succeededCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.results.find((r) => r.id === 'p1')?.success).toBe(true);
      expect(res.results.find((r) => r.id === 'nonexistent')?.success).toBe(false);
    });

    it('throws error when batch exceeds 100 items', async () => {
      const over100Ids = Array.from({ length: 101 }, (_, i) => `p-${i}`);
      await expect(service.moderatePhotosBatch(over100Ids, 'approve')).rejects.toThrow(
        'Batch request cannot exceed 100 items'
      );
    });
  });
});
