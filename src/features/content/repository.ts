import { prisma } from '@/lib/prisma';
import type { IContentRepository } from './types';
import { ContentNodeSchema, AppConfigSchema, ContentNodeDTO, AppConfigDTO } from './schemas';

export class ContentRepository implements IContentRepository {
  async getFeatures() {
    const config = await prisma.appConfig.findUnique({ where: { id: 'global' } });
    if (!config) return [];
    
    const parsed = AppConfigSchema.parse(config);
    return parsed.features || [];
  }

  async updateFeatures(features: any[]): Promise<AppConfigDTO> {
    const updated = await prisma.appConfig.update({
      where: { id: 'global' },
      data: { features }
    });
    return AppConfigSchema.parse(updated);
  }

  async getAllNodes(): Promise<ContentNodeDTO[]> {
    const nodes = await prisma.contentNode.findMany();
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

  async getNodesByType(type: string): Promise<ContentNodeDTO[]> {
    const nodes = await prisma.contentNode.findMany({
      where: { type }
    });
    return nodes.map((n: any) => ContentNodeSchema.parse(n));
  }

  async createNode(data: Omit<ContentNodeDTO, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentNodeDTO> {
    const created = await prisma.contentNode.create({
      data: {
        type: data.type,
        tags: data.tags,
        data: data.data || {}
      }
    });
    return ContentNodeSchema.parse(created);
  }

  async updateNode(id: string, data: Partial<ContentNodeDTO>): Promise<ContentNodeDTO> {
    const updateData = { ...data } as any;
    const updated = await prisma.contentNode.update({
      where: { id },
      data: updateData
    });
    return ContentNodeSchema.parse(updated);
  }

  async deleteNode(id: string): Promise<ContentNodeDTO> {
    const deleted = await prisma.contentNode.delete({
      where: { id }
    });
    return ContentNodeSchema.parse(deleted);
  }
}

export const contentRepository = new ContentRepository();
