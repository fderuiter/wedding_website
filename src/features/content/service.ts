import { IContentRepository } from './types';
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

  async getPendingPhotos() {
    const nodes = await this.repo.getNodesByType('Photo');
    return nodes
      .filter((node) => {
        const data = node.data as any;
        if (data?.status === 'PENDING') return true;
        if (data?.status === undefined && data?.isVisible === false && node.tags?.includes('guest-upload')) return true;
        return false;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

  async batchModeratePhotos(
    ids: string[],
    action: 'approve' | 'reject',
    author: string = 'Admin'
  ) {
    return this.moderatePhotosBatch(ids, action, author);
  }
}

export const contentService = new ContentService(contentRepository);
