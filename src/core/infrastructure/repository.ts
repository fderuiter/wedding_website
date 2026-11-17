import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';

type DbClient = any;

export class BaseRepository<T extends { id: string }> {
  constructor(public modelName: string, public client: DbClient = prisma) {}

  withClient(client: DbClient): this {
    return new (this.constructor as any)(this.modelName, client);
  }

  async transaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R> {
    return executeInTransaction(this.client, (tx: any) => fn(this.withClient(tx)));
  }

  async reorder(orderedIds: string[]): Promise<T[]> {
    if (orderedIds.length === 0) {
      return [];
    }
    const operations = orderedIds.map((id, index) =>
      this.model.update({
        where: { id },
        data: { order: index },
      })
    );
    if (typeof this.client?.$transaction === 'function') {
      return this.client.$transaction(operations);
    }
    return Promise.all(operations);
  }

  get model() {
    return (this.client as any)[this.modelName];
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

  async updateMany(args: any): Promise<{ count: number }> {
    return this.model.updateMany(args);
  }

  async updateManyAndReturn(args: any): Promise<T[]> {
    if (typeof this.model?.updateManyAndReturn === 'function') {
      return this.model.updateManyAndReturn(args);
    }
    if (typeof this.model?.updateMany === 'function') {
      await this.model.updateMany(args);
    }
    return this.findMany({ where: args.where });
  }

  async delete(id: string, author: string = 'System'): Promise<T> {
    const record = await this.model.delete({ where: { id } });
    await createAuditSnapshot(this.modelName, id, { deleted: true, ...record }, author, this.client);
    return record;
  }

  async deleteMany(args?: any): Promise<{ count: number }> {
    return this.model.deleteMany(args);
  }
}
