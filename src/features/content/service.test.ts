import { ContentService } from './service';
import { IContentRepository } from './types';
import { ContentNode } from '@prisma/client';

class MockContentRepository implements IContentRepository {
  async getFeatures(): Promise<any[]> { return []; }
  async updateFeatures(_features: any[], _author?: string): Promise<any> { return {} as any; }
  async getNodesByType(_type: string): Promise<any[]> { return []; }
}

describe('ContentService', () => {
  let mockRepo: MockContentRepository;
  let service: ContentService;

  beforeEach(() => {
    mockRepo = new MockContentRepository();
    service = new ContentService(mockRepo);
  });

  describe('getFeatures & updateFeatures', () => {
    it('delegates getFeatures and updateFeatures to repository', async () => {
      const mockFeatures = [{ id: 'f1', type: 'hero', visible: true }];
      jest.spyOn(mockRepo, 'getFeatures').mockResolvedValue(mockFeatures);
      jest.spyOn(mockRepo, 'updateFeatures').mockResolvedValue({ id: 'global', features: mockFeatures } as any);

      const features = await service.getFeatures();
      expect(features).toEqual(mockFeatures);
      expect(mockRepo.getFeatures).toHaveBeenCalledTimes(1);

      const updated = await service.updateFeatures(mockFeatures);
      expect(updated).toEqual({ id: 'global', features: mockFeatures });
      expect(mockRepo.updateFeatures).toHaveBeenCalledWith(mockFeatures);
    });
  });

  describe('getPublicPhotos', () => {
    it('returns nodes of type Photo, sorted by createdAt descending, checking visibility flag in data', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000);
      const tomorrow = new Date(now.getTime() + 86400000);

      const mockNodes: ContentNode[] = [
        {
          id: '1',
          type: 'Photo',
          tags: [],
          data: { url: 'old.jpg' },
          createdAt: yesterday,
          updatedAt: yesterday,
        },
        {
          id: '2',
          type: 'Photo',
          tags: [],
          data: { url: 'hidden.jpg', isVisible: false },
          createdAt: tomorrow,
          updatedAt: tomorrow,
        },
        {
          id: '3',
          type: 'Photo',
          tags: [],
          data: { url: 'new.jpg', isVisible: true },
          createdAt: now,
          updatedAt: now,
        },
      ];

      jest.spyOn(mockRepo, 'getNodesByType').mockResolvedValue(mockNodes);

      const result = await service.getPublicPhotos();

      expect(mockRepo.getNodesByType).toHaveBeenCalledWith('Photo');
      
      // Node 2 should be filtered out
      expect(result).toHaveLength(2);

      // Should be sorted by createdAt descending
      expect(result[0].id).toBe('3');
      expect(result[1].id).toBe('1');
    });

    it('passes options to repository and filters out photos created before since timestamp', async () => {
      const now = new Date('2026-06-20T18:30:00.000Z');
      const earlier = new Date('2026-06-20T18:00:00.000Z');
      const older = new Date('2026-06-20T17:30:00.000Z');

      const mockNodes: ContentNode[] = [
        {
          id: '1',
          type: 'Photo',
          tags: [],
          data: { url: 'older.jpg', status: 'APPROVED', isVisible: true },
          createdAt: older,
          updatedAt: older,
        },
        {
          id: '2',
          type: 'Photo',
          tags: [],
          data: { url: 'new.jpg', status: 'APPROVED', isVisible: true },
          createdAt: now,
          updatedAt: now,
        },
      ];

      jest.spyOn(mockRepo, 'getNodesByType').mockResolvedValue(mockNodes);

      const result = await service.getPublicPhotos({ since: earlier });

      expect(mockRepo.getNodesByType).toHaveBeenCalledWith('Photo', { since: earlier });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('excludes registry, party, and attraction images unless publishToGallery is enabled', async () => {
      const now = new Date('2026-06-20T18:30:00.000Z');
      (mockRepo as IContentRepository).getEntityBoundMediaIds = jest
        .fn()
        .mockResolvedValue(new Set(['registry-media-1', 'party-media-2']));

      jest.spyOn(mockRepo, 'getNodesByType').mockResolvedValue([
        {
          id: 'n-registry-hidden',
          type: 'Photo',
          tags: ['gallery'],
          data: {
            url: '/uploads/mixer.jpg',
            status: 'APPROVED',
            isVisible: true,
            mediaId: 'registry-media-1',
          },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'n-party-published',
          type: 'Photo',
          tags: ['gallery', 'curated'],
          data: {
            url: '/uploads/bridesmaid.jpg',
            status: 'APPROVED',
            isVisible: true,
            mediaId: 'party-media-2',
            publishToGallery: true,
          },
          createdAt: now,
          updatedAt: now,
        },
      ] as any);

      const result = await service.getPublicPhotos();
      expect(result.map((r) => r.id)).toEqual(['n-party-published']);
    });
  });
});
