import { ContentService } from './service';
import { IContentRepository } from './types';
import { ContentNode } from '@prisma/client';

class MockContentRepository implements IContentRepository {
  async getFeatures() { return []; }
  async updateFeatures(_features: any[]) { return {} as any; }
  async getAllNodes() { return []; }
  async getNodesByType(_type: string) { return []; }
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

  describe('reorderFeatures', () => {
    it('reorders features according to provided ID list and calls repository updateFeatures', async () => {
      const existingFeatures = [
        { id: 'feat-1', title: 'Feature 1' },
        { id: 'feat-2', title: 'Feature 2' },
        { id: 'feat-3', title: 'Feature 3' },
      ];
      jest.spyOn(mockRepo, 'getFeatures').mockResolvedValue(existingFeatures);
      jest.spyOn(mockRepo, 'updateFeatures').mockImplementation(async (f) => f as any);

      await service.reorderFeatures(['feat-3', 'feat-1', 'feat-2']);

      expect(mockRepo.getFeatures).toHaveBeenCalledTimes(1);
      expect(mockRepo.updateFeatures).toHaveBeenCalledWith([
        { id: 'feat-3', title: 'Feature 3' },
        { id: 'feat-1', title: 'Feature 1' },
        { id: 'feat-2', title: 'Feature 2' },
      ]);
    });

    it('filters out non-existent IDs during reordering', async () => {
      const existingFeatures = [
        { id: 'feat-1', title: 'Feature 1' },
        { id: 'feat-2', title: 'Feature 2' },
      ];
      jest.spyOn(mockRepo, 'getFeatures').mockResolvedValue(existingFeatures);
      jest.spyOn(mockRepo, 'updateFeatures').mockImplementation(async (f) => f as any);

      await service.reorderFeatures(['feat-2', 'missing-id', 'feat-1']);

      expect(mockRepo.updateFeatures).toHaveBeenCalledWith([
        { id: 'feat-2', title: 'Feature 2' },
        { id: 'feat-1', title: 'Feature 1' },
      ]);
    });
  });

  describe('toggleFeatureVisibility', () => {
    it('toggles visibility flag for target feature ID and calls repository updateFeatures', async () => {
      const existingFeatures = [
        { id: 'feat-1', visible: true },
        { id: 'feat-2', visible: true },
      ];
      jest.spyOn(mockRepo, 'getFeatures').mockResolvedValue(existingFeatures);
      jest.spyOn(mockRepo, 'updateFeatures').mockImplementation(async (f) => f as any);

      await service.toggleFeatureVisibility('feat-1', false);

      expect(mockRepo.updateFeatures).toHaveBeenCalledWith([
        { id: 'feat-1', visible: false },
        { id: 'feat-2', visible: true },
      ]);
    });
  });

  describe('createCustomSection', () => {
    it('appends custom section feature and calls repository updateFeatures', async () => {
      const existingFeatures = [{ id: 'hero-1', type: 'hero', visible: true }];
      jest.spyOn(mockRepo, 'getFeatures').mockResolvedValue(existingFeatures);
      jest.spyOn(mockRepo, 'updateFeatures').mockImplementation(async (f) => f as any);

      await service.createCustomSection('Custom Section Title', 'Custom content goes here');

      expect(mockRepo.updateFeatures).toHaveBeenCalledWith([
        { id: 'hero-1', type: 'hero', visible: true },
        expect.objectContaining({
          id: expect.stringMatching(/^custom-/),
          type: 'custom',
          title: 'Custom Section Title',
          content: 'Custom content goes here',
          visible: true,
        }),
      ]);
    });
  });

  describe('getAllNodes', () => {
    it('delegates getAllNodes to repository', async () => {
      const mockNodes = [{ id: 'n1', type: 'FAQ', tags: [], data: {}, createdAt: new Date(), updatedAt: new Date() }];
      jest.spyOn(mockRepo, 'getAllNodes').mockResolvedValue(mockNodes);

      const nodes = await service.getAllNodes();
      expect(nodes).toEqual(mockNodes);
      expect(mockRepo.getAllNodes).toHaveBeenCalledTimes(1);
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
  });
});
