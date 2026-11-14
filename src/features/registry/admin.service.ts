import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';
import { deriveAdminInputSchema } from '@/utils/validation';
import { handleMediaFields } from '@/features/admin/utils';
import { z } from 'zod';

const RegistryItemInputSchema = deriveAdminInputSchema(RegistryItemSchema);
export type RegistryItemInput = z.infer<typeof RegistryItemInputSchema>;

export class RegistryItemAdminService extends BaseService<RegistryItemDTO> {
  static ENTITY_KEY = 'registry-items';
  
  protected defaultQueryArgs = {
    include: { image: true, contributors: true }
  };
    
  constructor() {
    super(new BaseRepository<RegistryItemDTO>('registryItem'), 'RegistryItem', RegistryItemInputSchema);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', client, author);
  }
}
