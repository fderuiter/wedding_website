import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { ContentNodeInputSchema } from './schemas';

export class ContentNodeAdminService extends BaseService<any> {
  static ENTITY_KEY = 'content-nodes';

  constructor(dbClient?: any) {
    super(
      dbClient ? new BaseRepository('contentNode', dbClient) : new BaseRepository('contentNode'),
      'ContentNode',
      ContentNodeInputSchema
    );
  }

  override async reorder(orderedIds: string[], author: string = 'Admin'): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return;
    }

    await this.repo.transaction(async (txRepo) => {
      const existingRecords = await txRepo.findMany({
        where: { id: { in: orderedIds } },
      });
      const existingById = new Map<string, any>(
        existingRecords.map((record: any) => [record.id, record])
      );

      const updatedRecords: any[] = [];
      let nextOrder = 0;

      for (const id of orderedIds) {
        const current = existingById.get(id);
        if (!current) continue;

        const baseData =
          current.data && typeof current.data === 'object' && !Array.isArray(current.data)
            ? (current.data as Record<string, unknown>)
            : {};

        const updated = await txRepo.update(id, {
          data: {
            ...baseData,
            displayOrder: nextOrder,
          },
        });
        updatedRecords.push(updated);
        nextOrder++;
      }

      if (updatedRecords.length > 0) {
        await this.createBatchSnapshots(updatedRecords, author, txRepo.client);
      }
    });
  }
}
