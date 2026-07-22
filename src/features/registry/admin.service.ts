import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';
import { handleMediaFields } from '@/features/admin';
import { z } from 'zod';

const RegistryItemInputSchema = RegistryItemSchema.omit({ id: true }).partial();
export type RegistryItemInput = z.infer<typeof RegistryItemInputSchema>;

function validateRegistryItem(data: any): string | null {
  const result = RegistryItemInputSchema.safeParse(data);
  if (!result.success) {
    return result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  }
  return null;
}

export class RegistryItemAdminService extends BaseService<RegistryItemDTO> {
  static ENTITY_KEY = 'registry-items';
    
  constructor() {
    super(new BaseRepository<RegistryItemDTO>('registryItem'), 'RegistryItem');
  }

  async findMany(args?: any): Promise<RegistryItemDTO[]> {
    const customArgs = {
      ...args,
      include: { image: true, contributors: true, ...(args?.include || {}) }
    };
    return super.findMany(customArgs);
  }

  async create(data: RegistryItemInput, author: string = 'Admin'): Promise<RegistryItemDTO> {
    const error = validateRegistryItem(data);
    if (error) throw new Error(`Validation Error: ${error}`);

    return this.repo.transaction(async (txRepo) => {
      const mappedData = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', txRepo.client);
      const record = await txRepo.create(mappedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async update(id: string, data: RegistryItemInput, author: string = 'Admin'): Promise<RegistryItemDTO> {
    const error = validateRegistryItem(data);
    if (error) throw new Error(`Validation Error: ${error}`);

    return this.repo.transaction(async (txRepo) => {
      const mappedData = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', txRepo.client);
      const record = await txRepo.update(id, mappedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }
}
