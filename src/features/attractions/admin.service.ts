import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin/utils';
import { AttractionSchema, AttractionDTO } from './schemas';
import { z } from 'zod';
import { formatZodError } from '@/utils/validation';

const AttractionInputSchema = AttractionSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type AttractionInput = z.infer<typeof AttractionInputSchema>;

function validateAttraction(data: any): string | null {
  const result = AttractionInputSchema.safeParse(data);
  if (!result.success) {
    return formatZodError(result.error);
  }
  return null;
}

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
    super(new BaseRepository<AttractionDTO>('attraction'), 'Attraction');
  }

  protected async validate(data: any, client?: any): Promise<void> {
    const error = validateAttraction(data);
    if (error) throw new Error(`Validation Error: ${error}`);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await mapAttractionData(data, client, author);
  }
}
