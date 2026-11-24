import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { createBatchAuditSnapshots } from '@/lib/audit';
import { WeddingPartyInputSchema } from './schemas';

export class WeddingPartyAdminService extends BaseService<any> {
  static ENTITY_KEY = 'wedding-party';
  
  protected defaultQueryArgs = {
    orderBy: [{ order: 'asc' }],
    include: { photo: true }
  };
    
  constructor(dbClient?: any) {
    super(
      dbClient
        ? new BaseRepository('weddingPartyMember', dbClient)
        : new BaseRepository('weddingPartyMember'),
      'WeddingPartyMember',
      WeddingPartyInputSchema
    );
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await handleMediaFields(data, 'photoId', 'photoUrl', 'photoAlt', 'photoDecorative', client, author);
  }

  async reorder(orderedIds: string[], author: string = 'Admin'): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('Ordered IDs array cannot be empty');
    }

    await this.repo.transaction(async (txRepo) => {
      const hasRawExecutor = typeof txRepo.client?.$executeRaw === 'function';
      const existingRecords = await txRepo.model.findMany(
        hasRawExecutor
          ? { where: { id: { in: orderedIds } } }
          : { where: { id: { in: orderedIds } }, select: { id: true } }
      );

      const existingById = new Map<string, any>(
        existingRecords.map((r: any) => [r.id, r])
      );
      const missingIds = orderedIds.filter((id) => !existingById.has(id));

      if (missingIds.length > 0) {
        throw new Error(`Invalid member ID(s): ${missingIds.join(', ')}`);
      }

      if (hasRawExecutor) {
        await txRepo.reorder(orderedIds);

        const lastIndexById = new Map<string, number>();
        orderedIds.forEach((id, index) => {
          lastIndexById.set(id, index);
        });
        const updatedRecords = Array.from(lastIndexById.entries()).map(([id, order]) => ({
          ...existingById.get(id),
          order,
        }));

        await createBatchAuditSnapshots(
          this.entityType,
          updatedRecords,
          author,
          txRepo.client
        );
        return;
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

