/** @jest-environment node */

import { ContentService } from '../service';
import { IContentRepository } from '../types';

describe('Photo Moderation Service & Visibility Rules', () => {
  let mockRepo: jest.Mocked<
    Omit<
      Required<IContentRepository>,
      'getPendingPhotos' | 'getPublicPhotos' | 'approvePhotosBatch' | 'rejectPhotosBatch'
    >
  > & {
    getPendingPhotos?: jest.Mock;
    getPublicPhotos?: jest.Mock;
    approvePhotosBatch?: jest.Mock;
    rejectPhotosBatch?: jest.Mock;
  };
  let service: ContentService;

  beforeEach(() => {
    mockRepo = {
      getFeatures: jest.fn(),
      updateFeatures: jest.fn(),
      getNodesByType: jest.fn(),
      getNodeById: jest.fn(),
      createNode: jest.fn(),
      updateNode: jest.fn(),
      deleteNode: jest.fn(),
      getEntityBoundMediaIds: jest.fn().mockResolvedValue(new Set()),
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

    it('delegates to repo.getPublicPhotos when repo implements it', async () => {
      const since = new Date('2026-06-20T18:00:00.000Z');
      const delegatedPhotos = [
        {
          id: 'photo-delegated',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: { url: '/delegated.png', status: 'APPROVED' as const, isVisible: true },
          createdAt: new Date('2026-06-20T18:05:00.000Z'),
          updatedAt: new Date('2026-06-20T18:05:00.000Z'),
        },
      ];

      mockRepo.getPublicPhotos = jest.fn().mockResolvedValueOnce(delegatedPhotos);

      const result = await service.getPublicPhotos({ since, limit: 25 });

      expect(mockRepo.getPublicPhotos).toHaveBeenCalledWith({ since, limit: 25 });
      expect(mockRepo.getNodesByType).not.toHaveBeenCalled();
      expect(result).toEqual(delegatedPhotos);

      mockRepo.getPublicPhotos.mockResolvedValueOnce(delegatedPhotos);
      await service.getPublicPhotos();
      expect(mockRepo.getPublicPhotos).toHaveBeenLastCalledWith();
    });

    it('includes out-of-order approved guest uploads where createdAt < since and updatedAt > since', async () => {
      const sinceCursor = new Date('2026-06-20T19:00:00.000Z');
      mockRepo.getNodesByType.mockResolvedValueOnce([
        {
          id: 'photo-out-of-order',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: {
            url: '/uploads/photos/early-upload-late-approve.jpg',
            title: 'Cocktail Hour',
            status: 'APPROVED',
            isVisible: true,
          },
          createdAt: new Date('2026-06-20T18:15:00.000Z'), // uploaded BEFORE since
          updatedAt: new Date('2026-06-20T19:10:00.000Z'), // approved AFTER since
        },
        {
          id: 'photo-already-seen',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: { url: '/uploads/photos/old.jpg', status: 'APPROVED', isVisible: true },
          createdAt: new Date('2026-06-20T18:00:00.000Z'),
          updatedAt: new Date('2026-06-20T18:30:00.000Z'),
        },
      ]);

      const incremental = await service.getPublicPhotos({ since: sinceCursor });
      expect(mockRepo.getNodesByType).toHaveBeenCalledWith('Photo', {
        since: sinceCursor,
        limit: undefined,
      });
      expect(incremental.map((p) => p.id)).toEqual(['photo-out-of-order']);
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

    it('overrides or clears caption and uploaderName during approval and refreshes auto-derived guest title/altText', async () => {
      const pendingNode = {
        id: 'photo-edit-mod-1',
        type: 'Photo' as const,
        tags: ['gallery', 'guest-upload'],
        data: {
          url: '/uploads/photos/sparklers.jpg',
          title: 'Typo captoin!',
          altText: 'Typo captoin!',
          caption: 'Typo captoin!',
          uploaderName: 'Aunt Clara',
          status: 'PENDING',
          isVisible: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepo.getNodeById!.mockResolvedValueOnce(pendingNode);
      mockRepo.updateNode!.mockImplementationOnce(async (_id, update) => ({
        ...pendingNode,
        data: update.data as any,
      }));

      const edited = await service.moderatePhoto('photo-edit-mod-1', 'approve', 'AdminUser', {
        caption: '  Sparkler Send-Off!  ',
        uploaderName: '  Aunt Clara & Uncle Joe  ',
      });

      expect(edited.data).toEqual(
        expect.objectContaining({
          status: 'APPROVED',
          isVisible: true,
          caption: 'Sparkler Send-Off!',
          uploaderName: 'Aunt Clara & Uncle Joe',
          title: 'Sparkler Send-Off!',
          altText: 'Sparkler Send-Off!',
        })
      );

      // Clearing caption falls back to uploaderName and deletes stale caption key
      mockRepo.getNodeById!.mockResolvedValueOnce({
        ...pendingNode,
        data: edited.data,
      });
      mockRepo.updateNode!.mockImplementationOnce(async (_id, update) => ({
        ...pendingNode,
        data: update.data as any,
      }));

      const cleared = await service.moderatePhoto('photo-edit-mod-1', 'approve', 'AdminUser', {
        caption: '   ',
        uploaderName: '',
      });

      expect(cleared.data.caption).toBeUndefined();
      expect(cleared.data.uploaderName).toBeUndefined();
      expect(cleared.data.title).toBe('Guest Photo');
      expect(cleared.data.altText).toBe('Guest Photo');
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

    it('avoids duplicate getStorageProvider().delete calls when mediaRepository.deleteMedia already cleaned up storage', async () => {
      const mediaFeature = await import('@/features/media');
      const { LocalStorageProvider, resetStorageProvider } = await import('@/utils/storage');
      resetStorageProvider();
      const deleteMediaSpy = jest
        .spyOn(mediaFeature.mediaRepository, 'deleteMedia')
        .mockResolvedValueOnce({
          id: 'media-dedup-1',
          url: '/uploads/photos/dedup.jpg',
          altText: 'Dedup',
          isDecorative: false,
          isSample: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      const directStorageDelete = jest
        .spyOn(LocalStorageProvider.prototype, 'delete')
        .mockResolvedValue(undefined);

      try {
        mockRepo.getNodeById!.mockResolvedValueOnce({
          id: 'photo-dedup-1',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: {
            url: '/uploads/photos/dedup.jpg',
            mediaId: 'media-dedup-1',
            status: 'PENDING',
            isVisible: false,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        mockRepo.deleteNode!.mockResolvedValueOnce(undefined);

        const result = await service.moderatePhoto('photo-dedup-1', 'reject', 'AdminUser');
        expect(result.deleted).toBe(true);
        expect(deleteMediaSpy).toHaveBeenCalledWith('media-dedup-1', 'AdminUser');
        expect(directStorageDelete).not.toHaveBeenCalled();
        expect(mockRepo.deleteNode).not.toHaveBeenCalled();
      } finally {
        deleteMediaSpy.mockRestore();
        directStorageDelete.mockRestore();
        resetStorageProvider();
      }
    });

    it('still calls deleteNode when deleteMedia succeeded without removing the target photo node', async () => {
      const mediaFeature = await import('@/features/media');
      const mediaResult = {
        id: 'media-unlinked-1',
        url: '/uploads/photos/unlinked.jpg',
        altText: 'Unlinked',
        isDecorative: false,
        isSample: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      Object.defineProperty(mediaResult, 'deletedNodeIds', {
        value: ['other-photo-node'],
        enumerable: false,
      });
      const deleteMediaSpy = jest
        .spyOn(mediaFeature.mediaRepository, 'deleteMedia')
        .mockResolvedValueOnce(mediaResult);

      try {
        mockRepo.getNodeById!.mockResolvedValueOnce({
          id: 'photo-still-present',
          type: 'Photo' as const,
          tags: ['gallery', 'guest-upload'],
          data: {
            url: '/uploads/photos/unlinked.jpg',
            mediaId: 'media-unlinked-1',
            status: 'PENDING',
            isVisible: false,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        mockRepo.deleteNode!.mockResolvedValueOnce(undefined);

        const result = await service.moderatePhoto('photo-still-present', 'reject', 'AdminUser');
        expect(result.deleted).toBe(true);
        expect(mockRepo.deleteNode).toHaveBeenCalledWith('photo-still-present', 'AdminUser');
      } finally {
        deleteMediaSpy.mockRestore();
      }
    });

    it('preserves entity-bound media and storage blobs when rejecting a photo linked to a registry or party record', async () => {
      const mediaFeature = await import('@/features/media');
      const { LocalStorageProvider, resetStorageProvider } = await import('@/utils/storage');
      resetStorageProvider();
      const deleteMediaSpy = jest.spyOn(mediaFeature.mediaRepository, 'deleteMedia');
      const directStorageDelete = jest
        .spyOn(LocalStorageProvider.prototype, 'delete')
        .mockResolvedValue(undefined);

      try {
        mockRepo.getEntityBoundMediaIds.mockResolvedValueOnce(new Set(['media-bound-1']));
        mockRepo.getNodeById!.mockResolvedValueOnce({
          id: 'photo-bound-reject',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: {
            url: '/uploads/photos/registry-item.jpg',
            mediaId: 'media-bound-1',
            status: 'PENDING',
            isVisible: false,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        mockRepo.deleteNode!.mockResolvedValueOnce(undefined);

        const result = await service.moderatePhoto('photo-bound-reject', 'reject', 'AdminUser');
        expect(result.deleted).toBe(true);
        expect(deleteMediaSpy).not.toHaveBeenCalled();
        expect(directStorageDelete).not.toHaveBeenCalled();
        expect(mockRepo.deleteNode).toHaveBeenCalledWith('photo-bound-reject', 'AdminUser');
      } finally {
        deleteMediaSpy.mockRestore();
        directStorageDelete.mockRestore();
        resetStorageProvider();
      }
    });

    it('deletes the database row without unlinking out-of-root files when rejecting a legacy out-of-root Photo node', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      const canaryName = `__moderation_canary_${process.pid}.txt`;
      const canaryPath = path.resolve(process.cwd(), canaryName);
      await fs.writeFile(canaryPath, 'HARMLESS_CANARY_OUTSIDE_PUBLIC\n', 'utf8');

      try {
        const legacyOutOfRootNode = {
          id: 'photo-legacy-traversal',
          type: 'Photo' as const,
          tags: ['gallery'],
          data: {
            url: `/../${canaryName}`,
            status: 'PENDING',
            isVisible: false,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        mockRepo.getNodeById!.mockResolvedValueOnce(legacyOutOfRootNode);
        mockRepo.deleteNode!.mockResolvedValueOnce(undefined);

        const result = await service.moderatePhoto('photo-legacy-traversal', 'reject', 'AdminUser');

        expect(mockRepo.deleteNode).toHaveBeenCalledWith('photo-legacy-traversal', 'AdminUser');
        expect(result.deleted).toBe(true);
        expect(await fs.readFile(canaryPath, 'utf8')).toBe('HARMLESS_CANARY_OUTSIDE_PUBLIC\n');
      } finally {
        await fs.rm(canaryPath, { force: true });
      }
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

    it('delegates batch approval to repo.approvePhotosBatch and preserves input order for mixed valid and missing IDs', async () => {
      const now = new Date();
      const approvedP2 = {
        id: 'p2',
        type: 'Photo' as const,
        tags: ['gallery', 'guest-upload'],
        data: { url: '/uploads/photos/p2.jpg', status: 'APPROVED' as const, isVisible: true },
        createdAt: now,
        updatedAt: now,
      };
      const approvedP1 = {
        id: 'p1',
        type: 'Photo' as const,
        tags: ['gallery', 'guest-upload'],
        data: { url: '/uploads/photos/p1.jpg', status: 'APPROVED' as const, isVisible: true },
        createdAt: now,
        updatedAt: now,
      };

      mockRepo.approvePhotosBatch = jest.fn().mockResolvedValueOnce([approvedP1, approvedP2]);

      const res = await service.moderatePhotosBatch(
        ['p2', 'missing-id', 'p1'],
        'approve',
        'CoupleAdmin'
      );

      expect(mockRepo.approvePhotosBatch).toHaveBeenCalledTimes(1);
      expect(mockRepo.approvePhotosBatch).toHaveBeenCalledWith(
        ['p2', 'missing-id', 'p1'],
        'CoupleAdmin'
      );
      expect(mockRepo.getNodeById).not.toHaveBeenCalled();
      expect(mockRepo.updateNode).not.toHaveBeenCalled();
      expect(res.total).toBe(3);
      expect(res.succeededCount).toBe(2);
      expect(res.failedCount).toBe(1);
      expect(res.results).toEqual([
        { id: 'p2', success: true, action: 'approve', data: approvedP2 },
        {
          id: 'missing-id',
          success: false,
          action: 'approve',
          error: 'Photo node with ID missing-id not found',
        },
        { id: 'p1', success: true, action: 'approve', data: approvedP1 },
      ]);
    });

    it('delegates batch rejection to repo.rejectPhotosBatch without calling deleteNode per item and preserves input order', async () => {
      mockRepo.rejectPhotosBatch = jest.fn().mockResolvedValueOnce(['p1', 'p3']);

      const res = await service.moderatePhotosBatch(
        ['p3', 'ghost-photo', 'p1'],
        'reject',
        'CoupleAdmin'
      );

      expect(mockRepo.rejectPhotosBatch).toHaveBeenCalledTimes(1);
      expect(mockRepo.rejectPhotosBatch).toHaveBeenCalledWith(
        ['p3', 'ghost-photo', 'p1'],
        'CoupleAdmin'
      );
      expect(mockRepo.getNodeById).not.toHaveBeenCalled();
      expect(mockRepo.deleteNode).not.toHaveBeenCalled();
      expect(res.total).toBe(3);
      expect(res.succeededCount).toBe(2);
      expect(res.failedCount).toBe(1);
      expect(res.results).toEqual([
        {
          id: 'p3',
          success: true,
          action: 'reject',
          data: { id: 'p3', deleted: true, status: 'REJECTED' },
        },
        {
          id: 'ghost-photo',
          success: false,
          action: 'reject',
          error: 'Photo node with ID ghost-photo not found',
        },
        {
          id: 'p1',
          success: true,
          action: 'reject',
          data: { id: 'p1', deleted: true, status: 'REJECTED' },
        },
      ]);
    });
  });
});
