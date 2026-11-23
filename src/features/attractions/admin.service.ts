import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { AttractionInputSchema, AttractionDTO } from './schemas';

async function mapAttractionData(data: any, client?: any, author?: string): Promise<any> {
  // Since validation ensures coordinates are numbers, we don't need manual parsing here anymore
  const mapped = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', client, author);
  return mapped;
}

export class AttractionAdminService extends BaseService<AttractionDTO> {
  static ENTITY_KEY = 'attractions';
  
  protected defaultQueryArgs = {
    include: { image: true }
  };
    
  constructor() {
    super(new BaseRepository<AttractionDTO>('attraction'), 'Attraction', AttractionInputSchema);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await mapAttractionData(data, client, author);
  }
}
