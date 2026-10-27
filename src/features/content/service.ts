import { IContentRepository, PendingPhotosOptions, PaginatedPendingPhotosResult } from './types';
import { contentRepository } from './repository';

export class ContentService {
  constructor(private readonly repo: IContentRepository) {}

  async getFeatures() {
    return await this.repo.getFeatures();
  }

  async updateFeatures(features: any[]) {
    return await this.repo.updateFeatures(features);
  }

  async reorderFeatures(orderedIds: string[], author?: string) {
    const features = await this.repo.getFeatures();
    const featureMap = new Map(features.map((f: any) => [f.id, f]));
    const reordered: any[] = [];
    for (const id of orderedIds) {
      if (featureMap.has(id)) {
        reordered.push(featureMap.get(id));
        featureMap.delete(id);
      }
    }
    for (const remaining of featureMap.values()) {
      reordered.push(remaining);
    }
    return author !== undefined
      ? await this.repo.updateFeatures(reordered, author)
      : await this.repo.updateFeatures(reordered);
  }

  async toggleFeatureVisibility(featureId: string, visible: boolean, author?: string) {
    const features = await this.repo.getFeatures();
    const updated = features.map((f: any) => (f.id === featureId ? { ...f, visible } : f));
    return author !== undefined
      ? await this.repo.updateFeatures(updated, author)
      : await this.repo.updateFeatures(updated);
  }

  async createCustomSection(title: string, content: string, author?: string) {
    const features = await this.repo.getFeatures();
    const newFeature = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'custom',
      title,
      content,
      visible: true,
    };
    return author !== undefined
      ? await this.repo.updateFeatures([...features, newFeature], author)
      : await this.repo.updateFeatures([...features, newFeature]);
  }

  async getAllNodes() {
    if (typeof this.repo.getAllNodes === 'function') {
      return await this.repo.getAllNodes();
    }
    return [];
  }

  async getPublicPhotos() {
    const nodes = await this.repo.getNodesByType('Photo');
    // Public gallery endpoints return only photos with status APPROVED or isVisible true (excluding PENDING and REJECTED)
    return nodes
      .filter((node) => {
        const data = node.data as any;
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

  async getPendingPhotos(options: PendingPhotosOptions = {}): Promise<PaginatedPendingPhotosResult> {
    if (typeof this.repo.getPendingPhotos === 'function') {
      const res = await this.repo.getPendingPhotos(options);
      return Object.assign([...res.photos], {
        photos: res.photos,
        total: res.total,
        page: res.page,
        limit: res.limit,
        totalPages: res.totalPages,
      }) as any;
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

  async moderatePhoto(nodeId: string, action: 'approve' | 'reject', author: string = 'Admin') {
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
      const updatedData = {
        ...data,
        status: 'APPROVED',
        isVisible: true,
      };
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
}

export const contentService = new ContentService(contentRepository);
