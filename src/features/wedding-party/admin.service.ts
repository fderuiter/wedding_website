import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { WeddingPartyMemberSchema } from './schemas';
import { formatZodError } from '@/utils/validation';

const WeddingPartyInputSchema = WeddingPartyMemberSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial({ link: true, photo: true });

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
        
    const mappedData = await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative');
    return super.create(mappedData, author);
  }

  async update(id: string, data: any, author?: string): Promise<any> {
    const error = validateWeddingParty(data);
    if (error) throw new Error(`Validation Error: ${error}`);
        
    const mappedData = await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative');
    return super.update(id, mappedData, author);
  }
}
