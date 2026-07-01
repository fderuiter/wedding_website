import { ContentNode, AppConfig, Attraction, WeddingPartyMember } from '@prisma/client';

export interface IContentRepository {
  getFeatures(): Promise<any[]>;
  updateFeatures(features: any[]): Promise<AppConfig>;
  getAllNodes(): Promise<ContentNode[]>;
  getNodesByType(type: string): Promise<ContentNode[]>;
  createNode(data: Omit<ContentNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentNode>;
  updateNode(id: string, data: Partial<ContentNode>): Promise<ContentNode>;
  deleteNode(id: string): Promise<ContentNode>;
  getAttractions(): Promise<Attraction[]>;
  getWeddingPartyMembers(): Promise<WeddingPartyMember[]>;
}

