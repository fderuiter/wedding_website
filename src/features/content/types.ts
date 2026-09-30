import { ContentNodeDTO, AppConfigDTO } from './schemas';

export interface IContentRepository {
  getFeatures(configIdOrSubdomain?: string): Promise<any[]>;
  updateFeatures(features: any[], author?: string, configIdOrSubdomain?: string): Promise<AppConfigDTO>;
  getNodesByType(type: string): Promise<ContentNodeDTO[]>;
  getAllNodes(): Promise<ContentNodeDTO[]>;
}

