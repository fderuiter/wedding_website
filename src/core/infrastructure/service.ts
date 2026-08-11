import { createAuditSnapshot } from '@/lib/audit';
import { BaseRepository } from './repository';

export class BaseService<T extends { id: string }> {
  protected defaultQueryArgs?: any;

  constructor(public repo: BaseRepository<T>, public entityType: string) {}

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

  async findById(id: string): Promise<T | null> {
    return this.repo.findUnique(id);
  }

  protected async validate(data: any, client?: any): Promise<void> {
    // Default: no-op
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
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


  async delete(id: string, author: string = 'Admin'): Promise<T> {
    const record = await this.repo.delete(id, author);
    return record;
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await this.repo.transaction(async (txRepo) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await txRepo.update(orderedIds[i], { order: i });
      }
    });
  }

  async toggleVisibility(id: string, isVisible: boolean): Promise<T> {
    return this.update(id, { isVisible });
  }

  protected async createSnapshot(entityId: string, data: any, author: string, client?: any) {
    await createAuditSnapshot(this.entityType, entityId, data, author, client || this.repo.client);
  }
}
