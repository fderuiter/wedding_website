import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { RegistryItemInputSchema, RegistryItemDTO } from './schemas';
import { handleMediaFields } from '@/features/admin';
import { z } from 'zod';

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
