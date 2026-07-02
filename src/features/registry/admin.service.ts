import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { RegistryItemSchema } from '@/features/registry/schemas';

const RegistryItemInputSchema = RegistryItemSchema.omit({ id: true }).partial();

function validateRegistryItem(data: any): string | null {
  const result = RegistryItemInputSchema.safeParse(data);
  if (!result.success) {
    return result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  }
  return null;
}

export class RegistryItemAdminService extends BaseService<any> {
    static ENTITY_KEY = 'registry-items';
    
    constructor() {
        super(new BaseRepository('registryItem'), 'RegistryItem');
    }

    async findMany(args?: any): Promise<any[]> {
        const customArgs = {
            ...args,
            include: { image: true, contributors: true, ...(args?.include || {}) }
        };
        return super.findMany(customArgs);
    }

    async create(data: any, author?: string): Promise<any> {
        const error = validateRegistryItem(data);
        if (error) throw new Error(`Validation Error: ${error}`);
        return super.create(data, author);
    }

    async update(id: string, data: any, author?: string): Promise<any> {
        const error = validateRegistryItem(data);
        if (error) throw new Error(`Validation Error: ${error}`);
        return super.update(id, data, author);
    }
}
export default RegistryItemAdminService;
