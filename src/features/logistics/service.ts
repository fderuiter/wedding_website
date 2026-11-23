import { ILogisticsRepository } from './types';
import { logisticsRepository } from './repository';
import { compareFaqNodesByOrder, isFaqNodeVisible, type ContentNodeDTO } from '../content/schemas';

export class LogisticsService {
  constructor(private readonly repo: ILogisticsRepository) {}

  async getHomepageLogistics(): Promise<ContentNodeDTO[]> {
    return await this.repo.getLogisticsNodes();
  }

  async getVisibleFaqs(): Promise<Extract<ContentNodeDTO, { type: 'FAQ' }>[]> {
    if (typeof this.repo.getVisibleFaqs === 'function') {
      return await this.repo.getVisibleFaqs();
    }
    const nodes = await this.repo.getLogisticsNodes();
    return nodes
      .filter(
        (n): n is Extract<ContentNodeDTO, { type: 'FAQ' }> =>
          n.type === 'FAQ' && isFaqNodeVisible(n)
      )
      .sort(compareFaqNodesByOrder);
  }
}

export const logisticsService = new LogisticsService(logisticsRepository);
