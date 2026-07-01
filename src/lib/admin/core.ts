import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';

export class BaseRepository<T extends { id: string }> {
  constructor(public modelName: string) {}

  get model() {
    return (prisma as any)[this.modelName];
  }

  async findMany(args?: any): Promise<T[]> {
    return this.model.findMany(args);
  }

  async findUnique(id: string): Promise<T | null> {
    return this.model.findUnique({ where: { id } });
  }

  async create(data: any): Promise<T> {
    return this.model.create({ data });
  }

  async update(id: string, data: any): Promise<T> {
    return this.model.update({ where: { id }, data });
  }

  async delete(id: string): Promise<T> {
    return this.model.delete({ where: { id } });
  }
}

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

  async delete(id: string, author: string = 'Admin'): Promise<T> {
    const record = await this.repo.delete(id);
    // Might want to snapshot deletion or not, but usually yes to keep the final state before deletion or mark it deleted
    return record;
  }

  async reorder(orderedIds: string[]): Promise<void> {
    // Basic reorder logic for entities with 'order' field
    // To do it safely, run in transaction
    const updates = orderedIds.map((id, index) => {
      return this.repo.model.update({
        where: { id },
        data: { order: index }
      });
    });
    await prisma.$transaction(updates);
  }

  async toggleVisibility(id: string, isVisible: boolean): Promise<T> {
    // Generic toggle visibility if field exists
    return this.update(id, { isVisible });
  }

  protected async createSnapshot(entityId: string, data: any, author: string) {
    await createAuditSnapshot(this.entityType, entityId, data, author);
  }
}
