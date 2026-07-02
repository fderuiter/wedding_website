import { createAuditSnapshot } from '@/lib/audit';
import { BaseRepository } from './repository';

export class BaseService<T extends { id: string }> {
  constructor(public repo: BaseRepository<T>, public entityType: string) {}

  async findMany(args?: any): Promise<T[]> {
    return this.repo.findMany(args);
  }

  async findById(id: string): Promise<T | null> {
    return this.repo.findUnique(id);
  }

  async create(data: any, author: string = 'Admin'): Promise<T> {
    return this.repo.transaction(async (txRepo) => {
      const record = await txRepo.create(data);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async update(id: string, data: any, author: string = 'Admin'): Promise<T> {
    return this.repo.transaction(async (txRepo) => {
      const record = await txRepo.update(id, data);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async delete(id: string, _author: string = 'Admin'): Promise<T> {
    const record = await this.repo.delete(id);
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
