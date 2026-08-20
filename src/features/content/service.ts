import { IContentRepository } from './types';
import { contentRepository } from './repository';
import type { ContentNodeDTO } from './schemas';

export class ContentService {
  constructor(private readonly repo: IContentRepository) {}

  async getFeatures() {
    return await this.repo.getFeatures();
  }

  async updateFeatures(features: any[]) {
    return await this.repo.updateFeatures(features);
  }

  async reorderFeatures(orderedIds: string[]) {
    const features = await this.repo.getFeatures();
    const orderedFeatures = orderedIds.map(id => features.find((f: any) => f.id === id)).filter(Boolean);
    return await this.repo.updateFeatures(orderedFeatures);
  }

  async toggleFeatureVisibility(featureId: string, visible: boolean) {
    const features = await this.repo.getFeatures();
    const updated = features.map((f: any) => f.id === featureId ? { ...f, visible } : f);
    return await this.repo.updateFeatures(updated);
  }

  async getAllNodes(): Promise<ContentNodeDTO[]> {
    return await this.repo.getAllNodes();
  }

  async createCustomSection(title: string, content: string) {
    const features = await this.repo.getFeatures();
    const newId = 'custom-' + Date.now();
    features.push({
      id: newId,
      type: 'custom',
      title,
      content,
      visible: true
    });
    return await this.repo.updateFeatures(features);
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
