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

  async reorderFeatures(orderedIds: string[]) {
    const existing = await this.getFeatures();
    const map = new Map(existing.map((f: any) => [f.id, f]));
    const reordered: any[] = [];
    for (const id of orderedIds) {
      if (map.has(id)) {
        reordered.push(map.get(id));
      }
    }
    return await this.updateFeatures(reordered);
  }

  async toggleFeatureVisibility(featureId: string, visible: boolean) {
    const existing = await this.getFeatures();
    const updated = existing.map((f: any) => f.id === featureId ? { ...f, visible } : f);
    return await this.updateFeatures(updated);
  }

  async createCustomSection(title: string, content: string) {
    const existing = await this.getFeatures();
    const newSection = {
      id: `custom-${Date.now()}`,
      type: 'custom',
      title,
      content,
      visible: true,
    };
    return await this.updateFeatures([...existing, newSection]);
  }

  async getAllNodes() {
    if (this.repo.getAllNodes) {
      return await this.repo.getAllNodes();
    }
    return [];
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
