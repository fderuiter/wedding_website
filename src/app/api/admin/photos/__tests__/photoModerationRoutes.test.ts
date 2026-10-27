/** @jest-environment node */

import { GET as getModerationQueue, PATCH as patchModerationQueue, POST as postModerationQueue } from '../moderation/route';
import { POST as postBatchModeration, PATCH as patchBatchModeration } from '../moderation/batch/route';
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
      moderatePhotosBatch: jest.fn(),
      batchModeratePhotos: jest.fn(),
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

    it('returns 400 if action is invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'p1', action: 'invalid' }),
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

    it('returns 400 if action is invalid in params id route', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/p1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'invalid' }),
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

  describe('POST & PATCH /api/admin/photos/moderation/batch', () => {
    it('returns 404 if gallery feature is disabled', async () => {
      mockGetAppConfig.mockResolvedValueOnce({
        id: 'default',
        modules: { gallery: false },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: ['p1', 'p2'], action: 'approve' }),
      });
      const res = await postBatchModeration(req);
      expect(res.status).toBe(404);
    });

    it('returns 400 if photo IDs list is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: [], action: 'approve' }),
      });
      const res = await postBatchModeration(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 if batch size exceeds 100', async () => {
      const over100Ids = Array.from({ length: 101 }, (_, i) => `p-${i}`);
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: over100Ids, action: 'approve' }),
      });
      const res = await postBatchModeration(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 if action/status is missing or invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: ['p1'] }),
      });
      const res = await postBatchModeration(req);
      expect(res.status).toBe(400);
    });

    it('successfully processes batch approval via POST /batch', async () => {
      const mockBatchResult = {
        total: 2,
        succeededCount: 2,
        failedCount: 0,
        results: [
          { id: 'p1', success: true, action: 'approve', data: { id: 'p1', status: 'APPROVED' } },
          { id: 'p2', success: true, action: 'approve', data: { id: 'p2', status: 'APPROVED' } },
        ],
      };
      (mockContentService.moderatePhotosBatch as jest.Mock).mockResolvedValueOnce(mockBatchResult);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: ['p1', 'p2'], action: 'approve' }),
      });
      const res = await postBatchModeration(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.succeededCount).toBe(2);
      expect(json.failedCount).toBe(0);
      expect(json.results).toEqual(mockBatchResult.results);
      expect(mockContentService.moderatePhotosBatch).toHaveBeenCalledWith(['p1', 'p2'], 'approve', 'Admin');
    });

    it('successfully processes batch rejection via PATCH /moderation with array ids', async () => {
      const mockBatchResult = {
        total: 2,
        succeededCount: 2,
        failedCount: 0,
        results: [
          { id: 'p1', success: true, action: 'reject', data: { id: 'p1', deleted: true } },
          { id: 'p2', success: true, action: 'reject', data: { id: 'p2', deleted: true } },
        ],
      };
      (mockContentService.moderatePhotosBatch as jest.Mock).mockResolvedValueOnce(mockBatchResult);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ ids: ['p1', 'p2'], action: 'reject' }),
      });
      const res = await patchModerationQueue(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.succeededCount).toBe(2);
      expect(mockContentService.moderatePhotosBatch).toHaveBeenCalledWith(['p1', 'p2'], 'reject', 'Admin');
    });

    it('returns 400 for invalid JSON in batch request', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: 'invalid-json',
      });
      const res = await postBatchModeration(req);
      expect(res.status).toBe(400);
    });

    it('supports photoIds and status properties in batch endpoint', async () => {
      const mockBatchResult = {
        total: 1,
        succeededCount: 1,
        failedCount: 0,
        results: [{ id: 'p1', success: true, action: 'approve' }],
      };
      (mockContentService.moderatePhotosBatch as jest.Mock).mockResolvedValueOnce(mockBatchResult);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'PATCH',
        body: JSON.stringify({ photoIds: ['p1'], status: 'APPROVED' }),
      });
      const res = await patchBatchModeration(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhotosBatch).toHaveBeenCalledWith(['p1'], 'approve', 'Admin');
    });

    it('supports nodeIds in batch endpoint', async () => {
      const mockBatchResult = {
        total: 1,
        succeededCount: 1,
        failedCount: 0,
        results: [{ id: 'p1', success: true, action: 'reject' }],
      };
      (mockContentService.moderatePhotosBatch as jest.Mock).mockResolvedValueOnce(mockBatchResult);

      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ nodeIds: ['p1'], status: 'REJECTED' }),
      });
      const res = await postBatchModeration(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockContentService.moderatePhotosBatch).toHaveBeenCalledWith(['p1'], 'reject', 'Admin');
    });

    it('returns 400 when invalid action is supplied to moderation queue with batch array', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ ids: ['p1'], action: 'invalid_action' }),
      });
      const res = await patchModerationQueue(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when batch array on moderation route exceeds 100 items', async () => {
      const over100 = Array.from({ length: 101 }, (_, i) => `p-${i}`);
      const req = new NextRequest('http://localhost:3000/api/admin/photos/moderation', {
        method: 'PATCH',
        body: JSON.stringify({ ids: over100, action: 'approve' }),
      });
      const res = await patchModerationQueue(req);
      expect(res.status).toBe(400);
    });
  });
});
