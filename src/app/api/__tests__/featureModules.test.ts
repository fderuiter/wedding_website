import { GET as weatherGET } from '@/app/api/weather/route';
import { GET as mediaGET } from '@/app/api/media/route';
import { GET as registryGET } from '@/features/registry/api/get-items';
import { POST as contributePOST } from '@/features/registry/api/contribute';
import { getAppConfig } from '@/lib/config';
import { NextRequest } from 'next/server';

jest.mock('@/lib/config');

describe('API Route Behavior for Disabled Feature Modules', () => {
  const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Weather API (/api/weather)', () => {
    it('returns 404 when weather feature module is disabled', async () => {
      mockGetAppConfig.mockResolvedValue({
        id: 'global',
        modules: { weather: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/weather');
      const res = await weatherGET(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("Feature 'weather' is disabled");
    });
  });

  describe('Media API (/api/media)', () => {
    it('returns 404 when gallery feature module is disabled', async () => {
      mockGetAppConfig.mockResolvedValue({
        id: 'global',
        modules: { gallery: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/media');
      const res = await mediaGET(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("Feature 'gallery' is disabled");
    });
  });

  describe('Registry API (/api/registry/*)', () => {
    it('returns 404 when registry feature module is disabled', async () => {
      mockGetAppConfig.mockResolvedValue({
        id: 'global',
        modules: { registry: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/registry/items');
      const res = await registryGET(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("Feature 'registry' is disabled");
    });

    it('rejects partial group gift contributions when groupGifting is disabled', async () => {
      mockGetAppConfig.mockResolvedValue({
        id: 'global',
        modules: { registry: true, groupGifting: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'test-item-id',
          name: 'Jane Doe',
          amount: 25,
          code: 'TESTCODE',
        }),
      });

      // Mock registryService.getItemById
      const { registryService } = await import('@/features/registry/service');
      jest.spyOn(registryService, 'getItemById').mockResolvedValue({
        id: 'test-item-id',
        name: 'Mixer',
        price: 100,
        isGroupGift: true,
      } as any);

      const res = await contributePOST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Group gifting is currently disabled.');
    });
  });
});
