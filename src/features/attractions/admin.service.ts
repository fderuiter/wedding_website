import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
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

async function mapAttractionData(data: any, client?: any): Promise<any> {
  // Since validation ensures coordinates are numbers, we don't need manual parsing here anymore
  const mapped = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', client);
  return mapped;
}

export class AttractionAdminService extends BaseService<AttractionDTO> {
  static ENTITY_KEY = 'attractions';
    
  constructor() {
    super(new BaseRepository<AttractionDTO>('attraction'), 'Attraction');
  }

  async findMany(args?: any): Promise<AttractionDTO[]> {
    const customArgs = {
      ...args,
      include: { image: true, ...(args?.include || {}) }
    };
    return super.findMany(customArgs);
  }

  async create(data: AttractionInput, author?: string): Promise<AttractionDTO> {
    const error = validateAttraction(data);
    if (error) throw new Error(`Validation Error: ${error}`);

    return this.repo.transaction(async (txRepo) => {
      const mappedData = await mapAttractionData(data, txRepo.client);
      const record = await txRepo.create(mappedData);
      await this.createSnapshot(record.id, record, author || 'Admin', txRepo.client);
      return record;
    });
  }

  async update(id: string, data: AttractionInput, author?: string): Promise<AttractionDTO> {
    const error = validateAttraction(data);
    if (error) throw new Error(`Validation Error: ${error}`);

    return this.repo.transaction(async (txRepo) => {
      const mappedData = await mapAttractionData(data, txRepo.client);
      const record = await txRepo.update(id, mappedData);
      await this.createSnapshot(record.id, record, author || 'Admin', txRepo.client);
      return record;
    });
  }
}
