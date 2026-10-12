import { ILogisticsRepository } from './types';
import { logisticsRepository } from './repository';
import type { ContentNodeDTO } from '../content/schemas';

export class LogisticsService {
  constructor(private readonly repo: ILogisticsRepository) {}

  async getHomepageLogistics(): Promise<ContentNodeDTO[]> {
    return await this.repo.getLogisticsNodes();
  }

  async getScheduleNodes(): Promise<ContentNodeDTO[]> {
    if (this.repo.getScheduleNodes) {
      return await this.repo.getScheduleNodes();
    }
    return await this.repo.getLogisticsNodes();
  }
}

export const logisticsService = new LogisticsService(logisticsRepository);
