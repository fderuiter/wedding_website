import { prisma } from '@/lib/prisma';
import { ContentNode, Prisma } from '@prisma/client';

export interface IContentRepository {
  getAllNodes(): Promise<ContentNode[]>;
  getNodeById(id: string): Promise<ContentNode | null>;
  createNode(data: Prisma.ContentNodeCreateInput): Promise<ContentNode>;
  updateNode(id: string, data: Prisma.ContentNodeUpdateInput): Promise<ContentNode>;
  deleteNode(id: string): Promise<ContentNode>;
}

export class ContentRepository implements IContentRepository {
  async getAllNodes() {
    return prisma.contentNode.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async getNodeById(id: string) {
    return prisma.contentNode.findUnique({
      where: { id }
    });
  }

  async createNode(data: Prisma.ContentNodeCreateInput) {
    return prisma.contentNode.create({
      data
    });
  }

  async updateNode(id: string, data: Prisma.ContentNodeUpdateInput) {
    return prisma.contentNode.update({
      where: { id },
      data
    });
  }

  async deleteNode(id: string) {
    return prisma.contentNode.delete({
      where: { id }
    });
  }
}

export const contentRepository = new ContentRepository();
