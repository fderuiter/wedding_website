import { ContentNodeDTO, AppConfigDTO } from './schemas';
import type { AttractionDTO } from '@/features/attractions/schemas';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party/schemas';

export interface IContentRepository {
  getFeatures(): Promise<any[]>;
  updateFeatures(features: any[]): Promise<AppConfigDTO>;
  getAllNodes(): Promise<ContentNodeDTO[]>;
  getNodesByType(type: string): Promise<ContentNodeDTO[]>;
  createNode(data: Omit<ContentNodeDTO, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContentNodeDTO>;
  updateNode(id: string, data: Partial<ContentNodeDTO>): Promise<ContentNodeDTO>;
  deleteNode(id: string): Promise<ContentNodeDTO>;
  getAttractions(): Promise<AttractionDTO[]>;
  getWeddingPartyMembers(): Promise<WeddingPartyMemberDTO[]>;
}

