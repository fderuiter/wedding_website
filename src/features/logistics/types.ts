import { ContentNodeDTO } from '../content/schemas';

export interface ILogisticsRepository {
  getLogisticsNodes(): Promise<ContentNodeDTO[]>;
  getScheduleNodes?(): Promise<ContentNodeDTO[]>;
}
