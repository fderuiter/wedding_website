import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { createBatchAuditSnapshots } from '@/lib/audit';
import { RegistryItemInputSchema, RegistryItemDTO } from './schemas';
import { handleMediaFields } from '@/features/admin';

function hasMediaFields(data: Record<string, unknown>): boolean {
  return (
    Boolean(data.imageId) ||
    Boolean(data.imageUrl) ||
    data.imageAlt !== undefined ||
    data.imageDecorative !== undefined
  );
}

function stripTransientMediaFields(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...data };
  delete cleaned.imageUrl;
  delete cleaned.imageAlt;
  delete cleaned.imageDecorative;
  delete cleaned.photo;
  delete cleaned.image;
  delete cleaned.contributors;
  if (!cleaned.imageId) {
    delete cleaned.imageId;
  }
  return cleaned;
}

export class RegistryItemAdminService extends BaseService<RegistryItemDTO> {
  static ENTITY_KEY = 'registry-items';

  protected defaultQueryArgs = {
    include: { image: true, contributors: true },
  };

  constructor(dbClient?: any) {
    super(
      dbClient
        ? new BaseRepository<RegistryItemDTO>('registryItem', dbClient)
        : new BaseRepository<RegistryItemDTO>('registryItem'),
      'RegistryItem',
      RegistryItemInputSchema
    );
  }

  protected async preSave(
    data: any,
    client?: any,
    author?: string,
    isPartialUpdate: boolean = false
  ): Promise<any> {
    const recordData = (data ?? {}) as Record<string, unknown>;
    const isPartialWithoutCreateFields =
      recordData.name === undefined ||
      recordData.price === undefined ||
      recordData.category === undefined;

    if (!hasMediaFields(recordData) && (isPartialUpdate || isPartialWithoutCreateFields)) {
      return stripTransientMediaFields(recordData);
    }

    return await handleMediaFields(
      data,
      'imageId',
      'imageUrl',
      'imageAlt',
      'imageDecorative',
      client,
      author
    );
  }

  async update(id: string, data: any, author: string = 'Admin'): Promise<RegistryItemDTO> {
    return this.repo.transaction(async (txRepo) => {
      await this.validate(data, txRepo.client);
      const processedData = await this.preSave(data, txRepo.client, author, true);
      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async updateBatch(ids: string[], data: any, author: string = 'Admin'): Promise<RegistryItemDTO[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: At least one ID is required.');
    }
    if (ids.length > 100) {
      throw new Error('Validation Error: Maximum of 100 items allowed per batch request.');
    }
    return this.repo.transaction(async (txRepo) => {
      await this.validate(data, txRepo.client);
      const processedData = await this.preSave(data, txRepo.client, author, true);
      const records = await txRepo.updateManyAndReturn({
        where: { id: { in: ids } },
        data: processedData,
      });
      await this.createBatchSnapshots(records, author, txRepo.client);
      return records;
    });
  }

  async reorder(orderedIds: string[], author: string = 'Admin'): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('Ordered IDs array cannot be empty');
    }

    const uniqueIds = new Set(orderedIds);
    if (uniqueIds.size !== orderedIds.length) {
      throw new Error('Duplicate registry item IDs are not allowed');
    }

    await this.repo.transaction(async (txRepo) => {
      const hasRawExecutor = typeof txRepo.client?.$executeRaw === 'function';
      const existingRecords = await txRepo.model.findMany(
        hasRawExecutor
          ? { where: { id: { in: orderedIds } } }
          : { where: { id: { in: orderedIds } }, select: { id: true } }
      );

      const existingById = new Map<string, any>(
        existingRecords.map((r: { id: string }) => [r.id, r])
      );
      const missingIds = orderedIds.filter((id) => !existingById.has(id));

      if (missingIds.length > 0) {
        throw new Error(`Invalid registry item ID(s): ${missingIds.join(', ')}`);
      }

      if (hasRawExecutor) {
        await txRepo.reorder(orderedIds, 'displayOrder');
        const updatedRecords = orderedIds.map((id, index) => ({
          ...existingById.get(id),
          displayOrder: index,
        }));

        await createBatchAuditSnapshots(
          this.entityType,
          updatedRecords,
          author,
          txRepo.client
        );
        return;
      }

      const updatedRecords = await Promise.all(
        orderedIds.map((id, index) =>
          txRepo.model.update({
            where: { id },
            data: { displayOrder: index },
          })
        )
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
