import { createAuditSnapshot } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
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
    const record = await this.repo.create(data);
    await this.createSnapshot(record.id, record, author);
    return record;
  }

  async update(id: string, data: any, author: string = 'Admin'): Promise<T> {
    const record = await this.repo.update(id, data);
    await this.createSnapshot(record.id, record, author);
    return record;
  }

  async delete(id: string, _author: string = 'Admin'): Promise<T> {
    const record = await this.repo.delete(id);
    return record;
  }

  async reorder(orderedIds: string[]): Promise<void> {
    const updates = orderedIds.map((id, index) => {
      return this.repo.model.update({
        where: { id },
        data: { order: index }
      });
    });
    await prisma.$transaction(updates);
  }

  async toggleVisibility(id: string, isVisible: boolean): Promise<T> {
    return this.update(id, { isVisible });
  }

  protected async createSnapshot(entityId: string, data: any, author: string) {
    await createAuditSnapshot(this.entityType, entityId, data, author);
  }
}
