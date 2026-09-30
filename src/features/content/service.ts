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
    const currentFeatures = await this.repo.getFeatures();
    const featureMap = new Map(currentFeatures.map((f: any) => [f.id, f]));
    const reordered = orderedIds
      .map((id) => featureMap.get(id))
      .filter(Boolean);
    return await this.repo.updateFeatures(reordered);
  }

  async toggleFeatureVisibility(featureId: string, visible: boolean) {
    const currentFeatures = await this.repo.getFeatures();
    const updated = currentFeatures.map((f: any) =>
      f.id === featureId ? { ...f, visible } : f
    );
    return await this.repo.updateFeatures(updated);
  }

  async createCustomSection(title: string, content: string) {
    const currentFeatures = await this.repo.getFeatures();
    const newSection = {
      id: `custom-${Math.random().toString(36).substr(2, 9)}`,
      type: 'custom',
      title,
      content,
      visible: true,
    };
    return await this.repo.updateFeatures([...currentFeatures, newSection]);
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
