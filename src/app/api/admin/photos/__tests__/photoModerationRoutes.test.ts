/** @jest-environment node */

import { GET as getModerationQueue, PATCH as patchModerationQueue, POST as postModerationQueue } from '../moderation/route';
import { PATCH as patchPhotoById, PUT as putPhotoById } from '../[id]/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findFirst: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    media: {
      delete: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/features/content', () => {
  const original = jest.requireActual('@/features/content');
  return {
    ...original,
    contentService: {
      getPendingPhotos: jest.fn(),
      moderatePhoto: jest.fn(),
    },
  };
});

import { getAppConfig } from '@/lib/config';
import { contentService } from '@/features/content';

const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockContentService = contentService as jest.Mocked<typeof contentService>;

describe('Admin Photo Moderation Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      id: 'default',
      modules: { gallery: true },
    } as any);
  });

  describe('GET /api/admin/photos/moderation', () => {
    it('returns 404 if gallery feature is disabled', async () => {
      mockGetAppConfig.mockResolvedValueOnce({
        id: 'default',
        modules: { gallery: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation');
      const res = await getModerationQueue(req);
      expect(res.status).toBe(404);
    });

    it('returns pending photos queue when gallery is enabled', async () => {
      const mockPhotos = [
        { id: 'p1', title: 'Pending Photo 1', data: { status: 'PENDING', isVisible: false } },
      ];
      (mockContentService.getPendingPhotos as jest.Mock).mockResolvedValueOnce(mockPhotos);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation');
      const res = await getModerationQueue(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.pendingCount).toBe(1);
      expect(json.photos).toEqual(mockPhotos);
    });
  });

  describe('PATCH & POST /api/admin/photos/moderation', () => {
    it('returns 404 if gallery feature is disabled', async () => {
      mockGetAppConfig.mockResolvedValueOnce({
        id: 'default',
        modules: { gallery: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'p1', action: 'approve' }),
      });
      const res = await patchModerationQueue(req);
      expect(res.status).toBe(404);
    });

    it('returns 400 if photo ID is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      });
      const res = await patchModerationQueue(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 if action/status is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'p1' }),
      });
      const res = await patchModerationQueue(req);
      expect(res.status).toBe(400);
    });

    it('approves photo using id and action', async () => {
      (mockContentService.moderatePhoto as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        data: { status: 'APPROVED', isVisible: true },
      });

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'p1', action: 'approve' }),
      });
      const res = await patchModerationQueue(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhoto).toHaveBeenCalledWith('p1', 'approve', 'Admin');
    });

    it('rejects photo using nodeId and status APPROVED/REJECTED', async () => {
      (mockContentService.moderatePhoto as jest.Mock).mockResolvedValueOnce(true);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'POST',
        body: JSON.stringify({ nodeId: 'p1', status: 'REJECTED' }),
      });
      const res = await postModerationQueue(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhoto).toHaveBeenCalledWith('p1', 'reject', 'Admin');
    });
  });

  describe('PATCH & PUT /api/admin/photos/[id]', () => {
    it('returns 404 if gallery feature is disabled', async () => {
      mockGetAppConfig.mockResolvedValueOnce({
        id: 'default',
        modules: { gallery: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/p1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      });
      const res = await patchPhotoById(req, { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 if action or status is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/p1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      const res = await patchPhotoById(req, { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(400);
    });

    it('approves photo via params id', async () => {
      (mockContentService.moderatePhoto as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        data: { status: 'APPROVED', isVisible: true },
      });

      const req = new NextRequest('http://localhost:3000/api/admin/photos/p1', {
        method: 'PUT',
        body: JSON.stringify({ action: 'approve' }),
      });
      const res = await putPhotoById(req, { params: Promise.resolve({ id: 'p1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhoto).toHaveBeenCalledWith('p1', 'approve', 'Admin');
    });

    it('rejects photo via params id with status property', async () => {
      (mockContentService.moderatePhoto as jest.Mock).mockResolvedValueOnce(true);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/p1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED' }),
      });
      const res = await patchPhotoById(req, { params: Promise.resolve({ id: 'p1' }) });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhoto).toHaveBeenCalledWith('p1', 'reject', 'Admin');
    });
  });
});
