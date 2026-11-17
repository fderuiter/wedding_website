import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { BaseRepository } from './repository';
import { z } from 'zod';
import { formatZodError } from '@/utils/validation';

export class BaseService<T extends { id: string }> {
  protected defaultQueryArgs?: any;

  constructor(
    public repo: BaseRepository<T>,
    public entityType: string,
    protected schema?: z.ZodSchema<any>
  ) {}

  async findMany(args?: any): Promise<T[]> {
    if (!this.defaultQueryArgs) {
      return this.repo.findMany(args);
    }

    const merged = { ...this.defaultQueryArgs, ...args };

    if (this.defaultQueryArgs.include && args?.include) {
      merged.include = {
        ...this.defaultQueryArgs.include,
        ...args.include,
      };
    }

    if (this.defaultQueryArgs.orderBy && args?.orderBy) {
      if (Array.isArray(args.orderBy)) {
        merged.orderBy = args.orderBy;
      } else if (Array.isArray(this.defaultQueryArgs.orderBy)) {
        if (typeof args.orderBy === 'object') {
          merged.orderBy = [args.orderBy, ...this.defaultQueryArgs.orderBy];
        } else {
          merged.orderBy = this.defaultQueryArgs.orderBy;
        }
      } else {
        merged.orderBy = {
          ...this.defaultQueryArgs.orderBy,
          ...args.orderBy,
        };
      }
    }

    return this.repo.findMany(merged);
  }

  async count(args?: any): Promise<number> {
    if (!this.defaultQueryArgs) {
      return this.repo.count(args);
    }

    const merged = { ...args };

    if (this.defaultQueryArgs.where) {
      merged.where = {
        ...this.defaultQueryArgs.where,
        ...(args?.where || {}),
      };
    }

    return this.repo.count(merged);
  }

  async findById(id: string): Promise<T | null> {
    return this.repo.findUnique(id);
  }

  protected async validate(data: any, _client?: any): Promise<void> {
    if (this.schema) {
      const result = this.schema.safeParse(data);
      if (!result.success) {
        throw new Error(`Validation Error: ${formatZodError(result.error)}`);
      }
    }
  }

  protected async preSave(data: any, _client?: any, _author?: string): Promise<any> {
    // Default: returns data unchanged
    return data;
  }

  async create(data: any, author: string = 'Admin'): Promise<T> {
    return this.repo.transaction(async (txRepo) => {
      await this.validate(data, txRepo.client);
      const processedData = await this.preSave(data, txRepo.client, author);
      const record = await txRepo.create(processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async update(id: string, data: any, author: string = 'Admin'): Promise<T> {
    return this.repo.transaction(async (txRepo) => {
      await this.validate(data, txRepo.client);
      const processedData = await this.preSave(data, txRepo.client, author);
      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async updateBatch(ids: string[], data: any, author: string = 'Admin'): Promise<T[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: At least one ID is required.');
    }
    if (ids.length > 100) {
      throw new Error('Validation Error: Maximum of 100 items allowed per batch request.');
    }
    return this.repo.transaction(async (txRepo) => {
      await this.validate(data, txRepo.client);
      const processedData = await this.preSave(data, txRepo.client, author);

      let records: T[];
      if (typeof txRepo.updateManyAndReturn === 'function') {
        records = await txRepo.updateManyAndReturn({
          where: { id: { in: ids } },
          data: processedData,
        });
      } else if (typeof txRepo.model?.updateManyAndReturn === 'function') {
        records = await txRepo.model.updateManyAndReturn({
          where: { id: { in: ids } },
          data: processedData,
        });
      } else if (typeof txRepo.updateMany === 'function') {
        await txRepo.updateMany({
          where: { id: { in: ids } },
          data: processedData,
        });
        records = await txRepo.findMany({
          where: { id: { in: ids } },
        });
      } else if (typeof txRepo.model?.updateMany === 'function') {
        await txRepo.model.updateMany({
          where: { id: { in: ids } },
          data: processedData,
        });
        records = await txRepo.findMany({
          where: { id: { in: ids } },
        });
      } else {
        records = await Promise.all(
          ids.map((id) => txRepo.update(id, processedData))
        );
      }

      await this.createBatchSnapshots(records, author, txRepo.client);
      return records;
    });
  }

  async delete(id: string, author: string = 'Admin'): Promise<T> {
    const record = await this.repo.delete(id, author);
    return record;
  }

  async deleteBatch(ids: string[], author: string = 'Admin'): Promise<T[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: At least one ID is required.');
    }
    if (ids.length > 100) {
      throw new Error('Validation Error: Maximum of 100 items allowed per batch request.');
    }
    return this.repo.transaction(async (txRepo) => {
      const records = await txRepo.findMany({
        where: { id: { in: ids } },
      });

      if (records.length > 0) {
        const targetIds = records.map((r: T) => r.id);
        if (typeof txRepo.deleteMany === 'function') {
          await txRepo.deleteMany({
            where: { id: { in: targetIds } },
          });
        } else if (typeof txRepo.model?.deleteMany === 'function') {
          await txRepo.model.deleteMany({
            where: { id: { in: targetIds } },
          });
        } else {
          await Promise.all(targetIds.map((id: string) => txRepo.delete(id, author)));
        }

        await this.createBatchSnapshots(
          records.map((r: T) => ({ deleted: true, ...r })),
          author,
          txRepo.client
        );
      }

      return records;
    });
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await this.repo.transaction(async (txRepo) => {
      await Promise.all(
        orderedIds.map((id, index) => txRepo.update(id, { order: index }))
      );
    });
  }

  async toggleVisibility(id: string, isVisible: boolean): Promise<T> {
    return this.update(id, { isVisible });
  }

  protected async createSnapshot(entityId: string, data: any, author: string, client?: any) {
    await createAuditSnapshot(this.entityType, entityId, data, author, client || this.repo.client);
  }

  protected async createBatchSnapshots(records: any[], author: string, client?: any) {
    await createBatchAuditSnapshots(this.entityType, records, author, client || this.repo.client);
  }
}
