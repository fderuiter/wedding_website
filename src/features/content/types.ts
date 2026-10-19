import { ContentNodeDTO, AppConfigDTO } from './schemas';

export interface IContentRepository {
  getFeatures(configIdOrSubdomain?: string): Promise<any[]>;
  updateFeatures(features: any[], author?: string, configIdOrSubdomain?: string): Promise<AppConfigDTO>;
  getNodesByType(type: string): Promise<ContentNodeDTO[]>;
  getAllNodes(): Promise<ContentNodeDTO[]>;
  getNodeById?(id: string): Promise<ContentNodeDTO | null>;
  createNode?(data: { type: string; tags?: string[]; data: any }, author?: string): Promise<ContentNodeDTO>;
  updateNode?(id: string, data: { tags?: string[]; data?: any }, author?: string): Promise<ContentNodeDTO>;
  deleteNode?(id: string, author?: string): Promise<void>;
}

