import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SubEventDTO } from './schemas';

export class SubEventAdminService extends BaseService<SubEventDTO> {
  static ENTITY_KEY = 'sub-events';

  constructor() {
    super(new BaseRepository<SubEventDTO>('subEvent'), 'SubEvent');
  }

  protected async validate(data: any): Promise<void> {
    if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
      throw new Error('Validation Error: Title is required.');
    }
  }

  protected async preSave(data: any): Promise<any> {
    const finalData = { ...data };
    if (finalData.startTime && typeof finalData.startTime === 'string') {
      finalData.startTime = new Date(finalData.startTime);
    }
    if (finalData.endTime && typeof finalData.endTime === 'string') {
      finalData.endTime = new Date(finalData.endTime);
    }
    return finalData;
  }
}
