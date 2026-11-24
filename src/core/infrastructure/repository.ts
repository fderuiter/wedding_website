import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { qualifyPostgresTable, quotePostgresIdentifier } from '@/lib/postgres-url.js';
import { executeInTransaction } from '@/lib/transaction';

type DbClient = any;
type ReorderColumn = 'order' | 'displayOrder';

const ALLOWED_REORDER_COLUMNS = new Set<ReorderColumn>(['order', 'displayOrder']);

function resolvePrismaModelName(modelName: string): Prisma.ModelName | undefined {
  return Object.values(Prisma.ModelName).find(
    (name) => name.toLowerCase() === modelName.toLowerCase()
  );
}

export class BaseRepository<T extends { id: string }> {
  private isTransactionScoped = false;

  constructor(public modelName: string, public client: DbClient = prisma) {}

  withClient(client: DbClient): this {
    return new (this.constructor as any)(this.modelName, client);
  }

  async transaction<R>(fn: (txRepo: this) => Promise<R>): Promise<R> {
    if (this.isTransactionScoped) {
      return fn(this);
    }
    return executeInTransaction(this.client, (tx: any) => {
      const txRepo = this.withClient(tx);
      txRepo.isTransactionScoped = true;
      return fn(txRepo);
    });
  }

  async reorder(orderedIds: string[], column: ReorderColumn = 'order'): Promise<T[]> {
    if (!ALLOWED_REORDER_COLUMNS.has(column)) {
      throw new Error(`Invalid reorder column: ${String(column)}`);
    }
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return [];
    }

    const resolvedModelName = resolvePrismaModelName(this.modelName);
    const shouldEnterTransaction =
      Boolean(resolvedModelName) &&
      (typeof this.client?.$executeRaw === 'function' ||
        (typeof this.client?.$transaction === 'function' && typeof this.model?.update !== 'function'));

    if (resolvedModelName && shouldEnterTransaction) {
      return this.transaction(async (txRepo) => {
        if (typeof txRepo.client?.$executeRaw === 'function') {
          const lastIndexById = new Map<string, number>();
          orderedIds.forEach((id, index) => {
            lastIndexById.set(id, index);
          });
          const uniqueEntries = Array.from(lastIndexById.entries());

          const rows = uniqueEntries.map(
            ([id, orderValue]) => Prisma.sql`(${id}::text, ${orderValue}::integer)`
          );
          const values = Prisma.join(rows, ', ');
          const tableSql = Prisma.raw(qualifyPostgresTable(resolvedModelName));
          const columnSql = Prisma.raw(quotePostgresIdentifier(column, 'reorder column'));
          const scalarFields = (Prisma as Record<string, unknown>)[
            `${resolvedModelName}ScalarFieldEnum`
          ] as Record<string, string> | undefined;
          const updatedAtAssignment =
            !scalarFields || 'updatedAt' in scalarFields
              ? Prisma.raw(', "updatedAt" = NOW()')
              : Prisma.empty;

          const bulkUpdateQuery = Prisma.sql`
            UPDATE ${tableSql} AS t
            SET
              ${columnSql} = v.${columnSql}${updatedAtAssignment}
            FROM (VALUES ${values}) AS v("id", ${columnSql})
            WHERE t."id" = v."id"
          `;

          const updatedCount = await txRepo.client.$executeRaw(bulkUpdateQuery);
          if (typeof updatedCount === 'number' && updatedCount < uniqueEntries.length) {
            throw new Error('Record to update not found.');
          }

          return uniqueEntries.map(
            ([id, orderValue]) => ({ id, [column]: orderValue }) as unknown as T
          );
        }

        return Promise.all(
          orderedIds.map((id, index) =>
            txRepo.model.update({
              where: { id },
              data: { [column]: index },
            })
          )
        );
      });
    }

    const operations = orderedIds.map((id, index) =>
      this.model.update({
        where: { id },
        data: { [column]: index },
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

  async count(args?: any): Promise<number> {
    return this.model.count(args);
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
