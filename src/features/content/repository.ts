import { prisma } from '@/lib/prisma';
import type { IContentRepository } from './types';
import { ContentNode, AppConfig, Attraction, WeddingPartyMember } from '@prisma/client';

export class ContentRepository implements IContentRepository {
  async getFeatures() {
    const config = await prisma.appConfig.findUnique({ where: { id: 'global' } });
    if (!config || !config.features) return [];
    
    let features: any[] = [];
    if (typeof config.features === 'string') {
      try {
        features = JSON.parse(config.features);
      } catch(e) {}
    } else if (Array.isArray(config.features)) {
      features = config.features;
    }
    return features;
  }

  async updateFeatures(features: any[]): Promise<AppConfig> {
    return await prisma.appConfig.update({
      where: { id: 'global' },
      data: { features }
    });
  }

  async getAllNodes(): Promise<ContentNode[]> {
    return await prisma.contentNode.findMany();
  }

  async getNodesByType(type: string): Promise<ContentNode[]> {
    return await prisma.contentNode.findMany({
      where: { type }
    });
  }

  async createNode(data: Omit<ContentNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentNode> {
    return await prisma.contentNode.create({
      data: {
        type: data.type,
        tags: data.tags,
        data: data.data || {}
      }
    });
  }

  async updateNode(id: string, data: Partial<ContentNode>): Promise<ContentNode> {
    const updateData: any = { ...data };
    return await prisma.contentNode.update({
      where: { id },
      data: updateData
    });
  }

  async deleteNode(id: string): Promise<ContentNode> {
    return await prisma.contentNode.delete({
      where: { id }
    });
  }

  async getAttractions(): Promise<Attraction[]> {
    return await prisma.attraction.findMany();
  }

  async getWeddingPartyMembers(): Promise<WeddingPartyMember[]> {
    return await prisma.weddingPartyMember.findMany();
  }
}

export const contentRepository = new ContentRepository();
