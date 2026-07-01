import { ContentService } from './service';
import { IContentRepository } from './types';
import { Attraction, ContentNode } from '@prisma/client';

class MockContentRepository implements IContentRepository {
  async getFeatures() { return []; }
  async updateFeatures(features: any[]) { return {} as any; }
  async getAllNodes() { return []; }
  async getNodesByType(type: string) { return []; }
  async createNode(data: any) { return {} as any; }
  async updateNode(id: string, data: any) { return {} as any; }
  async deleteNode(id: string) { return {} as any; }
  async getAttractions() { return []; }
}

describe('ContentService', () => {
  let mockRepo: MockContentRepository;
  let service: ContentService;

  beforeEach(() => {
    mockRepo = new MockContentRepository();
    service = new ContentService(mockRepo);
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

  describe('getPublicAttractions', () => {
    it('returns attractions with isVisible=true, sorted by createdAt descending', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86400000);
      const tomorrow = new Date(now.getTime() + 86400000);

      const mockAttractions: Attraction[] = [
        {
          id: '1',
          name: 'Old Visible Attraction',
          description: '',
          image: null,
          category: '',
          website: '',
          directions: '',
          latitude: 0,
          longitude: 0,
          isVisible: true,
          createdAt: yesterday,
          updatedAt: yesterday,
        },
        {
          id: '2',
          name: 'Hidden Attraction',
          description: '',
          image: null,
          category: '',
          website: '',
          directions: '',
          latitude: 0,
          longitude: 0,
          isVisible: false,
          createdAt: tomorrow,
          updatedAt: tomorrow,
        },
        {
          id: '3',
          name: 'New Visible Attraction',
          description: '',
          image: null,
          category: '',
          website: '',
          directions: '',
          latitude: 0,
          longitude: 0,
          isVisible: true,
          createdAt: now,
          updatedAt: now,
        },
      ];

      jest.spyOn(mockRepo, 'getAttractions').mockResolvedValue(mockAttractions);

      const result = await service.getPublicAttractions();

      expect(mockRepo.getAttractions).toHaveBeenCalled();
      
      // Item 2 should be filtered out
      expect(result).toHaveLength(2);

      // Should be sorted by createdAt descending
      expect(result[0].id).toBe('3');
      expect(result[1].id).toBe('1');
    });
  });
});
