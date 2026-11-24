import { Prisma } from '@prisma/client';
import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
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

      const plannedById = new Map<string, { record: any; nextData: Record<string, unknown> }>();
      let nextOrder = 0;

      for (const id of orderedIds) {
        const current = existingById.get(id);
        if (!current) continue;

        const baseData =
          current.data && typeof current.data === 'object' && !Array.isArray(current.data)
            ? (current.data as Record<string, unknown>)
            : {};

        plannedById.set(id, {
          record: current,
          nextData: {
            ...baseData,
            displayOrder: nextOrder,
          },
        });
        nextOrder++;
      }

      if (plannedById.size === 0) {
        return;
      }

      const plannedEntries = Array.from(plannedById.entries());

      if (typeof txRepo.client?.$executeRaw === 'function') {
        const rows = plannedEntries.map(
          ([id, { nextData }]) => Prisma.sql`(${id}::text, ${JSON.stringify(nextData)}::jsonb)`
        );
        const values = Prisma.join(rows, ', ');
        const contentNodeTable = Prisma.raw(qualifyPostgresTable('ContentNode'));

        const bulkUpdateQuery = Prisma.sql`
          UPDATE ${contentNodeTable} AS t
          SET
            "data" = v."data",
            "updatedAt" = NOW()
          FROM (VALUES ${values}) AS v("id", "data")
          WHERE t."id" = v."id"
        `;

        await txRepo.client.$executeRaw(bulkUpdateQuery);

        const updatedRecords = plannedEntries.map(([, { record, nextData }]) => ({
          ...record,
          data: nextData,
        }));

        await this.createBatchSnapshots(updatedRecords, author, txRepo.client);
        return;
      }

      const updatedRecords: any[] = [];
      for (const [id, { nextData }] of plannedEntries) {
        const updated = await txRepo.update(id, {
          data: nextData,
        });
        updatedRecords.push(updated);
      }

      if (updatedRecords.length > 0) {
        await this.createBatchSnapshots(updatedRecords, author, txRepo.client);
      }
    });
  }
}
