import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';

type DbClient = any;

export class BaseRepository<T extends { id: string }> {
  constructor(public modelName: string, public client?: DbClient) {}

  private async getClient(): Promise<DbClient> {
    return this.client || (await import('@/lib/prisma')).prisma;
  }

  withClient(client: DbClient): this {
    return new (this.constructor as any)(this.modelName, client);
  }

  async transaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R> {
    const client = await this.getClient();
    return executeInTransaction(client, (tx: any) => fn(this.withClient(tx)));
  }

  async getModel() {
    const client = await this.getClient();
    return (client as any)[this.modelName];
  }

  async findMany(args?: any): Promise<T[]> {
    const model = await this.getModel();
    return model.findMany(args);
  }

  async findUnique(id: string): Promise<T | null> {
    const model = await this.getModel();
    return model.findUnique({ where: { id } });
  }

  async create(data: any): Promise<T> {
    const model = await this.getModel();
    return model.create({ data });
  }

  async update(id: string, data: any): Promise<T> {
    const model = await this.getModel();
    return model.update({ where: { id }, data });
  }

  async delete(id: string, author: string = 'System'): Promise<T> {
    const client = await this.getClient();
    const model = (client as any)[this.modelName];
    const record = await model.delete({ where: { id } });
    await createAuditSnapshot(this.modelName, id, { deleted: true, ...record }, author, client);
    return record;
  }
}
