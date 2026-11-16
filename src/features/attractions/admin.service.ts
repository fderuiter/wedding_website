import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { AttractionSchema, AttractionDTO } from './schemas';
import { z } from 'zod';
import { deriveAdminInputSchema } from '@/utils/validation';

const AttractionInputSchema = deriveAdminInputSchema(AttractionSchema);
export type AttractionInput = z.infer<typeof AttractionInputSchema>;

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
