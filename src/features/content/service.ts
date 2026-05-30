import { contentRepository } from './repository';
import type { IContentRepository } from './repository';
import { Prisma } from '@prisma/client';

export class ContentService {
  private repository: IContentRepository;

  constructor(repository: IContentRepository) {
    this.repository = repository;
  }

  async getAllNodes() {
    return this.repository.getAllNodes();
  }

  async getNodeById(id: string) {
    return this.repository.getNodeById(id);
  }

  async createNode(data: Prisma.ContentNodeCreateInput) {
    return this.repository.createNode(data);
  }

  async updateNode(id: string, data: Prisma.ContentNodeUpdateInput) {
    return this.repository.updateNode(id, data);
  }

  async deleteNode(id: string) {
    return this.repository.deleteNode(id);
  }
}

export const contentService = new ContentService(contentRepository);
