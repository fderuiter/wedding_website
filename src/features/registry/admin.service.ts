import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';
import { formatZodError, deriveAdminInputSchema } from '@/utils/validation';
import { handleMediaFields } from '@/features/admin/utils';
import { z } from 'zod';

const RegistryItemInputSchema = deriveAdminInputSchema(RegistryItemSchema);
export type RegistryItemInput = z.infer<typeof RegistryItemInputSchema>;

function validateRegistryItem(data: any): string | null {
  const result = RegistryItemInputSchema.safeParse(data);
  if (!result.success) {
    return formatZodError(result.error);
  }
  return null;
}

export class RegistryItemAdminService extends BaseService<RegistryItemDTO> {
  static ENTITY_KEY = 'registry-items';
  
  protected defaultQueryArgs = {
    include: { image: true, contributors: true }
  };
    
  constructor() {
    super(new BaseRepository<RegistryItemDTO>('registryItem'), 'RegistryItem');
  }

  protected async validate(data: any, client?: any): Promise<void> {
    const error = validateRegistryItem(data);
    if (error) throw new Error(`Validation Error: ${error}`);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', client, author);
  }
}
