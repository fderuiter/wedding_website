import { ContentNode } from '@prisma/client';

export interface ILogisticsRepository {
  getLogisticsNodes(): Promise<ContentNode[]>;
}
