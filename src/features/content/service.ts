import { IContentRepository, PendingPhotosOptions, PaginatedPendingPhotosResult, GetNodesByTypeOptions } from './types';
import { ContentNodeDTO } from './schemas';
import { contentRepository } from './repository';

export class ContentService {
  constructor(private readonly repo: IContentRepository) {}

  async getFeatures() {
    return await this.repo.getFeatures();
  }

  async updateFeatures(features: any[]) {
    return await this.repo.updateFeatures(features);
  }

  async getPublicPhotos(options?: GetNodesByTypeOptions) {
    if (typeof this.repo.getPublicPhotos === 'function') {
      return options !== undefined
        ? await this.repo.getPublicPhotos(options)
        : await this.repo.getPublicPhotos();
    }

    const nodes = options !== undefined
      ? await this.repo.getNodesByType('Photo', options)
      : await this.repo.getNodesByType('Photo');

    const sinceDate = options?.since
      ? options.since instanceof Date
        ? options.since
        : new Date(options.since)
      : null;
    const sinceTime = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate.getTime() : null;

    let excludedMediaIds = new Set<string>();
    if (typeof this.repo.getEntityBoundMediaIds === 'function') {
      const candidateMediaIds = Array.from(
        new Set(
          nodes
            .map((node) => {
              const data = node.data as { mediaId?: string; publishToGallery?: boolean } | undefined;
              if (!data?.mediaId || data.publishToGallery === true || node.tags?.includes('guest-upload')) {
                return null;
              }
              return data.mediaId;
            })
            .filter((id): id is string => Boolean(id))
        )
      );
      if (candidateMediaIds.length > 0) {
        excludedMediaIds = await this.repo.getEntityBoundMediaIds(candidateMediaIds);
      }
    }

    // Public gallery endpoints return only photos with status APPROVED or isVisible true (excluding PENDING and REJECTED)
    return nodes
      .filter((node) => {
        const cursorDate = node.updatedAt ?? node.createdAt;
        if (sinceTime !== null && cursorDate && cursorDate.getTime() <= sinceTime) {
          return false;
        }

        const data = node.data as any;
        if (data?.mediaId && data?.publishToGallery !== true && excludedMediaIds.has(data.mediaId)) {
          return false;
        }
        const status = data?.status;
        const isVisible = data?.isVisible;

        if (status === 'PENDING' || status === 'REJECTED') {
          return false;
        }

        if (status === 'APPROVED') {
          return isVisible !== false;
        }

        // Fallback for legacy photo nodes where status is undefined
        return isVisible !== false;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getPendingPhotos(options: PendingPhotosOptions = {}): Promise<ContentNodeDTO[] & PaginatedPendingPhotosResult> {
    if (typeof this.repo.getPendingPhotos === 'function') {
      const res = await this.repo.getPendingPhotos(options);
      return Object.assign([...res.photos], {
        photos: res.photos,
        total: res.total,
        page: res.page,
        limit: res.limit,
        totalPages: res.totalPages,
      });
    }

    let page = Math.floor(Number(options?.page));
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    let limit = Math.floor(Number(options?.limit));
    if (isNaN(limit) || limit < 1) {
      limit = 50;
    }
    if (limit > 100) {
      limit = 100;
    }

    const nodes = await this.repo.getNodesByType('Photo');
    const filtered = nodes
      .filter((node) => {
        const data = node.data as any;
        if (data?.status === 'PENDING') return true;
        if (data?.status === undefined && data?.isVisible === false && node.tags?.includes('guest-upload')) return true;
        return false;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = filtered.length;
    const skip = (page - 1) * limit;
    const paginatedPhotos = filtered.slice(skip, skip + limit);
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return Object.assign([...paginatedPhotos], {
      photos: paginatedPhotos,
      total,
      page,
      limit,
      totalPages,
    }) as any;
  }

  async moderatePhoto(
    nodeId: string,
    action: 'approve' | 'reject',
    author: string = 'Admin',
    metadata?: { caption?: string; uploaderName?: string }
  ) {
    let node: any = null;
    if (typeof this.repo.getNodeById === 'function') {
      node = await this.repo.getNodeById(nodeId);
    } else {
      const nodes = await this.repo.getNodesByType('Photo');
      node = nodes.find((n) => n.id === nodeId);
    }

    if (!node) {
      throw new Error(`Photo node with ID ${nodeId} not found`);
    }

    const data = (node.data as any) || {};

    if (action === 'approve') {
      const updatedData: Record<string, any> = {
        ...data,
        status: 'APPROVED',
        isVisible: true,
      };

      const hasMetadataOverrides =
        metadata !== undefined &&
        (metadata.caption !== undefined || metadata.uploaderName !== undefined);

      if (hasMetadataOverrides) {
        if (metadata.caption !== undefined) {
          const trimmedCaption = metadata.caption.trim();
          if (trimmedCaption) {
            updatedData.caption = trimmedCaption;
          } else {
            delete updatedData.caption;
          }
        }
        if (metadata.uploaderName !== undefined) {
          const trimmedUploader = metadata.uploaderName.trim();
          if (trimmedUploader) {
            updatedData.uploaderName = trimmedUploader;
          } else {
            delete updatedData.uploaderName;
          }
        }

        const effectiveCaption =
          typeof updatedData.caption === 'string' && updatedData.caption.trim()
            ? updatedData.caption.trim()
            : undefined;
        const effectiveUploader =
          typeof updatedData.uploaderName === 'string' && updatedData.uploaderName.trim()
            ? updatedData.uploaderName.trim()
            : undefined;
        const isGuestNode = Boolean(node.tags?.includes('guest-upload'));
        const previousAutoLabel =
          data.caption || (data.uploaderName ? `Photo by ${data.uploaderName}` : 'Guest Photo');

        if (isGuestNode || !data.title || data.title === previousAutoLabel) {
          const nextTitle =
            effectiveCaption ||
            (effectiveUploader ? `Photo by ${effectiveUploader}` : 'Guest Photo');
          updatedData.title = nextTitle;
          updatedData.altText = nextTitle;
        }

        if (data.mediaId && updatedData.altText) {
          try {
            const { mediaRepository } = await import('@/features/media');
            await mediaRepository.client?.media?.update?.({
              where: { id: data.mediaId },
              data: { altText: String(updatedData.altText) },
            });
          } catch {
            // Ignore optional media altText sync failure
          }
        }
      }

      if (typeof this.repo.updateNode === 'function') {
        return await this.repo.updateNode(nodeId, { data: updatedData }, author);
      }
      return { ...node, data: updatedData };
    } else if (action === 'reject') {
      const updatedData = {
        ...data,
        status: 'REJECTED',
        isVisible: false,
      };

      if (data.url) {
        try {
          const { getStorageProvider } = await import('@/utils/storage');
          await getStorageProvider().delete(data.url);
        } catch {
          // Ignore storage cleanup failures
        }
      }

      if (data.mediaId) {
        try {
          const { mediaRepository } = await import('@/features/media');
          await mediaRepository.deleteMedia(data.mediaId);
        } catch {
          // Ignore media record cleanup failures
        }
      }

      if (typeof this.repo.deleteNode === 'function') {
        await this.repo.deleteNode(nodeId, author);
        return { id: nodeId, deleted: true, status: 'REJECTED' };
      } else if (typeof this.repo.updateNode === 'function') {
        return await this.repo.updateNode(nodeId, { data: updatedData }, author);
      }
      return { ...node, data: updatedData };
    } else {
      throw new Error(`Invalid moderation action: ${action}`);
    }
  }

  async moderatePhotosBatch(
    ids: string[],
    action: 'approve' | 'reject',
    author: string = 'Admin'
  ) {
    if (!Array.isArray(ids)) {
      throw new Error('Photo IDs must be an array');
    }
    if (ids.length === 0) {
      throw new Error('At least one photo ID is required');
    }
    if (ids.length > 100) {
      throw new Error('Batch request cannot exceed 100 items');
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const result = await this.moderatePhoto(id, action, author);
          return {
            id,
            success: true,
            action,
            data: result,
          };
        } catch (err: any) {
          return {
            id,
            success: false,
            action,
            error: err?.message || 'Failed to moderate photo',
          };
        }
      })
    );

    const succeededCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      total: ids.length,
      succeededCount,
      failedCount,
      results,
    };
  }
}

export const contentService = new ContentService(contentRepository);
