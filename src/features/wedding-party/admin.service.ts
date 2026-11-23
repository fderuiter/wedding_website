import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { createBatchAuditSnapshots } from '@/lib/audit';
import { WeddingPartyInputSchema } from './schemas';

export class WeddingPartyAdminService extends BaseService<any> {
  static ENTITY_KEY = 'wedding-party';
  
  protected defaultQueryArgs = {
    orderBy: [{ order: 'asc' as const }],
    include: { photo: true }
  };

  override async findMany(args?: any): Promise<any[]> {
    if (
      args?.orderBy &&
      !Array.isArray(args.orderBy) &&
      typeof args.orderBy === 'object' &&
      Object.keys(args.orderBy).length === 1 &&
      args.orderBy.createdAt === 'desc'
    ) {
      return super.findMany({
        ...args,
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      });
    }
    return super.findMany(args);
  }
    
  constructor() {
    super(new BaseRepository('weddingPartyMember'), 'WeddingPartyMember', WeddingPartyInputSchema);
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

      const updatedRecords = await txRepo.reorder(orderedIds);

      await createBatchAuditSnapshots(
        this.entityType,
        updatedRecords,
        author,
        txRepo.client
      );
    });
  }
}

