/** @jest-environment node */

import { GET, POST } from '../export/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    media: {
      findMany: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as {
  media: { findMany: jest.Mock };
  contentNode: { findMany: jest.Mock };
};

const mockGetAppConfig = getAppConfig as jest.Mock;
const mockIsFeatureEnabled = isFeatureEnabled as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('GET & POST /api/media/export Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({ modules: ['gallery'] });
    mockIsFeatureEnabled.mockReturnValue(true);
    mockIsAdminRequest.mockResolvedValue(true);
  });

  describe('Authorization Guardrails', () => {
    test('returns 401 Unauthorized for unauthenticated GET /api/media/export requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/export');
      const res = await GET(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 401 Unauthorized for unauthenticated POST /api/media/export requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['m1'] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('Feature Flag Guardrails', () => {
    test('returns 404 when gallery module is disabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(false);

      const req = new NextRequest('http://localhost/api/media/export');
      const res = await GET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("Feature 'gallery' is disabled");
    });
  });

  describe('GET /api/media/export', () => {
    test('returns 404 if no matching media items exist', async () => {
      mockPrisma.media.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?tag=nonexistent');
      const res = await GET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('No media items found matching export criteria');
    });

    test('streams ZIP archive for requested tag with proper response headers', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'node-1',
          type: 'Photo',
          tags: ['guest-upload'],
          data: { url: '/uploads/photos/photo1.jpg', title: 'Guest Photo 1' },
        },
      ]);

      const req = new NextRequest('http://localhost/api/media/export?tag=guest-upload');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="wedding-photos.zip"'
      );
    });

    test('streams ZIP archive for requested comma-separated IDs', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/m1.jpg', altText: 'Media 1' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m1,m2');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });
  });

  describe('POST /api/media/export', () => {
    test('streams ZIP archive when given a JSON array of IDs', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/photo1.jpg', altText: 'Photo 1' },
        { id: 'm2', url: '/uploads/photo2.jpg', altText: 'Photo 2' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['m1', 'm2'] }),
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });

    test('streams ZIP archive when given JSON with tag property', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'node-2',
          type: 'Photo',
          tags: ['guest-upload'],
          data: { url: '/uploads/guest_photo.png', title: 'Party Pic' },
        },
      ]);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'guest-upload' }),
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });
  });
});
