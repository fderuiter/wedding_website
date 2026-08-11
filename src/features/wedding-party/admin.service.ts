import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin/utils';
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
  
  protected defaultQueryArgs = {
    orderBy: { order: 'asc' },
    include: { photo: true }
  };
    
  constructor() {
    super(new BaseRepository('weddingPartyMember'), 'WeddingPartyMember');
  }

  protected async validate(data: any, client?: any): Promise<void> {
    const error = validateWeddingParty(data);
    if (error) throw new Error(`Validation Error: ${error}`);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative', client, author);
  }
}
