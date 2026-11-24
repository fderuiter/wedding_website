import { ContentNodeDTO } from '../content/schemas';

export interface GetLogisticsNodesOptions {
  includePublicSubEvents?: boolean;
}

export interface ILogisticsRepository {
  getLogisticsNodes(options?: GetLogisticsNodesOptions): Promise<ContentNodeDTO[]>;
  getVisibleFaqs?(): Promise<Extract<ContentNodeDTO, { type: 'FAQ' }>[]>;
}
