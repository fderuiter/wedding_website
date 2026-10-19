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
});
