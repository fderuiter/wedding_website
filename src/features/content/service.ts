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
      id: `custom-${Date.now()}`,
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
    return await this.repo.getAllNodes();
  }

  async getPublicPhotos() {
    const nodes = await this.repo.getNodesByType('Photo');
    // For ContentNodes, apply generic sorting by createdAt descending.
    // If there is any visibility flag in data, enforce it.
    return nodes
      .filter((node) => {
        const data = node.data as any;
        return data?.isVisible !== false;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export const contentService = new ContentService(contentRepository);
