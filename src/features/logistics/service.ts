import { ILogisticsRepository } from './types';
import { logisticsRepository } from './repository';
import { ContentNode } from '@prisma/client';

export class LogisticsService {
  constructor(private readonly repo: ILogisticsRepository) {}

  async getHomepageLogistics(): Promise<ContentNode[]> {
    return await this.repo.getLogisticsNodes();
  }
}

export const logisticsService = new LogisticsService(logisticsRepository);
