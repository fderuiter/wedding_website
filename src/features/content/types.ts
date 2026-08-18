import { ContentNodeDTO, AppConfigDTO } from './schemas';

export interface IContentRepository {
  getFeatures(): Promise<any[]>;
  updateFeatures(features: any[]): Promise<AppConfigDTO>;
  getNodesByType(type: string): Promise<ContentNodeDTO[]>;
}

