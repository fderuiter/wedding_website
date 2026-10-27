import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin/utils';
import { createBatchAuditSnapshots } from '@/lib/audit';
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
  
  protected defaultQueryArgs = {
    orderBy: { order: 'asc' },
    include: { photo: true }
  };
    
  constructor() {
    super(new BaseRepository('weddingPartyMember'), 'WeddingPartyMember');
  }

  protected async validate(data: any, _client?: any): Promise<void> {
    const error = validateWeddingParty(data);
    if (error) throw new Error(`Validation Error: ${error}`);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative', client, author);
  }

  async reorder(orderedIds: string[], author: string = 'Admin'): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('Ordered IDs array cannot be empty');
    }

    await this.repo.transaction(async (txRepo) => {
      const existingRecords = await txRepo.model.findMany({
        where: { id: { in: orderedIds } },
        select: { id: true }
      });

      const existingSet = new Set(existingRecords.map((r: any) => r.id));
      const missingIds = orderedIds.filter((id) => !existingSet.has(id));

      if (missingIds.length > 0) {
        throw new Error(`Invalid member ID(s): ${missingIds.join(', ')}`);
      }

      const updatedRecords = await Promise.all(
        orderedIds.map((id, index) => txRepo.update(id, { order: index }))
      );

      await createBatchAuditSnapshots(
        this.entityType,
        updatedRecords,
        author,
        txRepo.client
      );
    });
  }
}

