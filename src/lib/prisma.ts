import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Global object extended with the prisma client type to prevent multiple instances
 * in development (hot-reloading).
 */
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export function createSqliteAdapter(connectionString: string) {
  let dbPath = connectionString;
  if (dbPath.startsWith('file:')) {
    dbPath = dbPath.slice(5);
  } else if (dbPath.startsWith('sqlite:')) {
    dbPath = dbPath.slice(7);
  }
  if (dbPath.includes('?')) {
    dbPath = dbPath.split('?')[0];
  }

  const createConnection = () => {
    const db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      try {
        db.exec('PRAGMA journal_mode = WAL;');
      } catch (e) {}
    }
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
    } catch (e) {}
    try {
      db.exec('PRAGMA synchronous = NORMAL;');
    } catch (e) {}
    return db;
  };

  const mainDb = createConnection();

  const mapSqliteType = (sqliteType: string) => {
    if (!sqliteType) return 7; // Text (default)
    const type = sqliteType.toUpperCase();
    if (type.includes('INT') || type.includes('INTEGER')) return 0; // Int32
    if (type.includes('CHAR') || type.includes('TEXT') || type.includes('CLOB')) return 7; // Text
    if (type.includes('BLOB')) return 13; // Bytes
    if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 3; // Double
    if (type.includes('BOOL')) return 5; // Boolean
    if (type.includes('DATE') || type.includes('TIME')) return 10; // DateTime
    return 7;
  };

  const convertArg = (arg: any): any => {
    if (arg === undefined || arg === null) return null;
    if (typeof arg === 'boolean') return arg ? 1 : 0;
    if (arg instanceof Date) return arg.toISOString();
    if (arg && typeof arg === 'object') {
      if (arg instanceof Uint8Array || Buffer.isBuffer(arg)) return arg;
      return JSON.stringify(arg);
    }
    return arg;
  };

  const makeQueryFunctions = (dbInstance: DatabaseSync) => {
    const queryRaw = async (query: { sql: string; args: Array<unknown> }) => {
      const args = query.args.map(convertArg);
      const stmt = dbInstance.prepare(query.sql);
      stmt.setReturnArrays(true);
      const cols = stmt.columns();
      const columnNames = cols.map(c => c.name);
      const columnTypes = cols.map(c => mapSqliteType(c.type || ''));
      const rows = stmt.all(...args);
      return {
        columnNames,
        columnTypes,
        rows
      };
    };

    const executeRaw = async (query: { sql: string; args: Array<unknown> }) => {
      const args = query.args.map(convertArg);
      const stmt = dbInstance.prepare(query.sql);
      const result = stmt.run(...args);
      return result.changes;
    };

    return { queryRaw, executeRaw };
  };

  const mainQuery = makeQueryFunctions(mainDb);

  const pool: DatabaseSync[] = [];
  const maxPoolSize = 20;

  const getTxConnection = () => {
    if (pool.length > 0) {
      return pool.pop()!;
    }
    return createConnection();
  };

  const releaseTxConnection = (conn: DatabaseSync) => {
    if (pool.length < maxPoolSize) {
      pool.push(conn);
    } else {
      try {
        conn.close();
      } catch (e) {}
    }
  };

  let txQueue = Promise.resolve();

  const driverAdapter = {
    provider: 'sqlite',
    adapterName: 'builtin-sqlite',
    queryRaw: mainQuery.queryRaw,
    executeRaw: mainQuery.executeRaw,
    async executeScript(script: string) {
      mainDb.exec(script);
    },
    async startTransaction() {
      const txDb = getTxConnection();

      let releaseQueueLock!: () => void;
      const prevQueue = txQueue;
      txQueue = new Promise<void>(resolve => {
        releaseQueueLock = resolve;
      });

      try {
        await prevQueue;
        let started = false;
        let retries = 0;
        while (!started && retries < 50) {
          try {
            txDb.exec('BEGIN IMMEDIATE');
            started = true;
          } catch (e: any) {
            if (e && e.message && (e.message.includes('locked') || e.message.includes('busy'))) {
              retries++;
              await new Promise(r => setTimeout(r, 10));
            } else {
              throw e;
            }
          }
        }
        if (!started) {
          throw new Error('Database busy, failed to acquire transaction lock');
        }
      } catch (err) {
        releaseQueueLock();
        releaseTxConnection(txDb);
        throw err;
      }

      const txQuery = makeQueryFunctions(txDb);

      return {
        provider: 'sqlite',
        adapterName: 'builtin-sqlite-tx',
        options: { usePhantomQuery: true },
        queryRaw: txQuery.queryRaw,
        executeRaw: txQuery.executeRaw,
        async commit() {
          try {
            txDb.exec('COMMIT');
          } finally {
            releaseQueueLock();
            releaseTxConnection(txDb);
          }
        },
        async rollback() {
          try {
            txDb.exec('ROLLBACK');
          } catch (e) {
            // ignore
          } finally {
            releaseQueueLock();
            releaseTxConnection(txDb);
          }
        }
      };
    },
    async dispose() {
      for (const conn of pool) {
        try {
          conn.close();
        } catch (e) {}
      }
      pool.length = 0;
      try {
        mainDb.close();
      } catch (e) {}
    }
  };

  return {
    provider: 'sqlite',
    adapterName: 'builtin-sqlite',
    async connect() {
      return driverAdapter;
    }
  };
}

const createPrismaClient = () => {
  let isSchemaSqlite = false;
  try {
    const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
    if (fs.existsSync(schemaPath)) {
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');
      isSchemaSqlite = schemaContent.includes('provider = "sqlite"') || schemaContent.includes('provider="sqlite"');
    }
    if (!isSchemaSqlite) {
      const compiledSchemaPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client', 'schema.prisma');
      if (fs.existsSync(compiledSchemaPath)) {
        const compiledContent = fs.readFileSync(compiledSchemaPath, 'utf8');
        isSchemaSqlite = compiledContent.includes('provider = "sqlite"') || compiledContent.includes('provider="sqlite"');
      }
    }
  } catch (e) {}

  let connectionString = env.DATABASE_URL;
  const isSqlite = isSchemaSqlite || connectionString.startsWith('file:') || connectionString.startsWith('sqlite:') || connectionString.includes('.db');

  if (isSqlite && !(connectionString.startsWith('file:') || connectionString.startsWith('sqlite:') || connectionString.includes('.db'))) {
    connectionString = 'file:./test.db';
  }

  console.log('DEBUG [createPrismaClient]:', { provider: isSqlite ? 'sqlite' : 'postgresql', isSqlite });

  let client: PrismaClient;
  if (isSqlite) {
    const adapter = createSqliteAdapter(connectionString) as any;
    const baseClient = new PrismaClient({ adapter });
    client = baseClient.$extends({
      query: {
        contentNode: {
          async $allOperations({ args, query }) {
            if (args && 'where' in args && args.where) {
              const rewriteWhere = (where: any) => {
                if (!where) return;
                if (where.tags && typeof where.tags === 'object') {
                  if ('has' in where.tags) {
                    const tagValue = where.tags.has;
                    delete where.tags.has;
                    where.tags.contains = `"${tagValue}"`;
                  }
                }
                if (Array.isArray(where.AND)) {
                  where.AND.forEach(rewriteWhere);
                }
                if (Array.isArray(where.OR)) {
                  where.OR.forEach(rewriteWhere);
                }
                if (Array.isArray(where.NOT)) {
                  where.NOT.forEach(rewriteWhere);
                }
              };
              rewriteWhere(args.where);
            }
            return query(args);
          }
        }
      }
    }) as any;
    return client;
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

/**
 * Singleton instance of the PrismaClient.
 * In development, it reuses the existing instance if available.
 * In production, it creates a new instance.
 * @type {PrismaClient}
 */
export const prisma = globalForPrisma.prisma || createPrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
