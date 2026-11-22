import { ContentNodeDTO } from '../content/schemas';

export interface ILogisticsRepository {
  getLogisticsNodes(): Promise<ContentNodeDTO[]>;
  getVisibleFaqs?(): Promise<Extract<ContentNodeDTO, { type: 'FAQ' }>[]>;
}
