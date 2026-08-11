import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin/utils';
import { WeddingPartyMemberSchema } from './schemas';
import { formatZodError, deriveAdminInputSchema } from '@/utils/validation';

const WeddingPartyInputSchema = deriveAdminInputSchema(WeddingPartyMemberSchema, false);

function validateWeddingParty(data: any): string | null {
  const result = WeddingPartyInputSchema.safeParse(data);
  if (!result.success) {
    return formatZodError(result.error);
  }
  return null;
}

export class WeddingPartyAdminService extends BaseService<any> {
  static ENTITY_KEY = 'wedding-party';
    
  constructor() {
    super(new BaseRepository('weddingPartyMember'), 'WeddingPartyMember');
  }

  async findMany(args?: any): Promise<any[]> {
    // Override with custom sorting and includes
    const customArgs = {
      ...args,
      orderBy: { order: 'asc' },
      include: { photo: true }
    };
    return super.findMany(customArgs);
  }

  async create(data: any, author?: string): Promise<any> {
    const error = validateWeddingParty(data);
    if (error) throw new Error(`Validation Error: ${error}`);
        
    return this.repo.transaction(async (txRepo) => {
      const mappedData = await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative', txRepo.client, author);
      const record = await txRepo.create(mappedData);
      await this.createSnapshot(record.id, record, author || 'Admin', txRepo.client);
      return record;
    });
  }

  async update(id: string, data: any, author?: string): Promise<any> {
    const error = validateWeddingParty(data);
    if (error) throw new Error(`Validation Error: ${error}`);
        
    return this.repo.transaction(async (txRepo) => {
      const mappedData = await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative', txRepo.client, author);
      const record = await txRepo.update(id, mappedData);
      await this.createSnapshot(record.id, record, author || 'Admin', txRepo.client);
      return record;
    });
  }
}
