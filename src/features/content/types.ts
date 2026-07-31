import { ContentNodeDTO, AppConfigDTO } from './schemas';

export interface IContentRepository {
  getFeatures(): Promise<any[]>;
  updateFeatures(features: any[]): Promise<AppConfigDTO>;
  getAllNodes(): Promise<ContentNodeDTO[]>;
  getNodesByType(type: string): Promise<ContentNodeDTO[]>;
}

