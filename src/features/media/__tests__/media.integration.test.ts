/**
 * @jest-environment node
 */

import { MediaRepository } from '../repository';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { MediaSchema } from '../schemas';

// Unmock @prisma/client for this test file so we can interact with the real PostgreSQL container
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');

const connectionString = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
const isSqlite = connectionString.startsWith('file:') || connectionString.startsWith('sqlite:') || connectionString.includes('.db');

let realPrisma: any;
let pool: any;

if (isSqlite) {
  const { DatabaseSync } = require('node:sqlite');
  const createSqliteAdapter = (connStr: string) => {
    let path = connStr;
    if (path.startsWith('file:')) path = path.slice(5);
    if (path.includes('?')) path = path.split('?')[0];
    const db = new DatabaseSync(path);
    const mapSqliteType = (sqliteType: string) => {
      if (!sqliteType) return 7;
      const type = sqliteType.toUpperCase();
      if (type.includes('INT') || type.includes('INTEGER')) return 0;
      if (type.includes('CHAR') || type.includes('TEXT') || type.includes('CLOB')) return 7;
      if (type.includes('BLOB')) return 13;
      if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 3;
      if (type.includes('BOOL')) return 5;
      if (type.includes('DATE') || type.includes('TIME')) return 10;
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
    const queryRaw = async (query: any) => {
      const args = query.args.map(convertArg);
      const stmt = db.prepare(query.sql);
      stmt.setReturnArrays(true);
      const cols = stmt.columns();
      const columnNames = cols.map((c: any) => c.name);
      const columnTypes = cols.map((c: any) => mapSqliteType(c.type || ''));
      const rows = stmt.all(...args);
      return { columnNames, columnTypes, rows };
    };
    const executeRaw = async (query: any) => {
      const args = query.args.map(convertArg);
      const stmt = db.prepare(query.sql);
      const result = stmt.run(...args);
      return result.changes;
    };
    const driverAdapter = {
      provider: 'sqlite',
      adapterName: 'builtin-sqlite',
      queryRaw,
      executeRaw,
      async executeScript(script: string) { db.exec(script); },
      async startTransaction() {
        db.exec('BEGIN');
        return {
          provider: 'sqlite',
          adapterName: 'builtin-sqlite-tx',
          options: { usePhantomQuery: true },
          queryRaw,
          executeRaw,
          async commit() { db.exec('COMMIT'); },
          async rollback() { db.exec('ROLLBACK'); }
        };
      },
      async dispose() { db.close(); }
    };
    return {
      provider: 'sqlite',
      adapterName: 'builtin-sqlite',
      async connect() { return driverAdapter; }
    };
  };
  const adapter = createSqliteAdapter(connectionString);
  realPrisma = new PrismaClient({ adapter });
} else {
  pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  realPrisma = new PrismaClient({ adapter });
}

// Instantiate MediaRepository with the real PrismaClient
const realRepository = new MediaRepository(realPrisma);

describe('Media Repository & Rollback Database Integration', () => {
  beforeEach(async () => {
    // Clean up database tables before each test
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
  });

  afterAll(async () => {
    // Perform final cleanup and close connections
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
    await realPrisma.$disconnect();
    if (pool) {
      await pool.end();
    }
  });

  test('createMedia inserts media successfully and records an audit snapshot', async () => {
    const data = {
      url: 'https://example.com/sunset.jpg',
      altText: 'Beautiful Sunset',
      isDecorative: false,
    };

    const created = await realRepository.createMedia(data, 'AdminUser');

    expect(created.id).toBeDefined();
    expect(created.url).toBe(data.url);
    expect(created.altText).toBe(data.altText);
    expect(created.isDecorative).toBe(data.isDecorative);

    // Verify record in database
    const dbRecord = await realPrisma.media.findUnique({
      where: { id: created.id },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.url).toBe(data.url);

    // Verify audit snapshot was created
    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'Media', entityId: created.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].author).toBe('AdminUser');
    expect((snapshots[0].data as any).url).toBe(data.url);
  });

  test('updateMedia modifies media and creates updated audit snapshot', async () => {
    const created = await realRepository.createMedia({
      url: 'https://example.com/sunset.jpg',
      altText: 'Beautiful Sunset',
      isDecorative: false,
    });

    const updated = await realRepository.updateMedia(
      created.id,
      {
        altText: 'Stunning sunset over mountains',
        isDecorative: true,
      },
      'EditorUser'
    );

    expect(updated.altText).toBe('Stunning sunset over mountains');
    expect(updated.isDecorative).toBe(true);
    expect(updated.url).toBe('https://example.com/sunset.jpg');

    // Verify in database
    const dbRecord = await realPrisma.media.findUnique({
      where: { id: created.id },
    });
    expect(dbRecord!.altText).toBe('Stunning sunset over mountains');
    expect(dbRecord!.isDecorative).toBe(true);

    // Verify audit snapshots: should have 2 snapshots now (one for create, one for update)
    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'Media', entityId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].author).toBe('EditorUser');
    expect((snapshots[0].data as any).altText).toBe('Stunning sunset over mountains');
  });

  test('deleteMedia deletes the record and logs deletion audit snapshot', async () => {
    const created = await realRepository.createMedia({
      url: 'https://example.com/sunset.jpg',
      altText: 'Beautiful Sunset',
      isDecorative: false,
    });

    const deleted = await realRepository.deleteMedia(created.id, 'DeleterUser');
    expect(deleted.id).toBe(created.id);

    // Verify it is gone from active records
    const dbRecord = await realPrisma.media.findUnique({
      where: { id: created.id },
    });
    expect(dbRecord).toBeNull();

    // Verify deletion audit snapshot
    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'Media', entityId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(snapshots).toHaveLength(2); // create + delete
    expect(snapshots[0].author).toBe('DeleterUser');
    expect((snapshots[0].data as any).deleted).toBe(true);
  });

  test('successfully executes media rollback / restore logic matching the endpoint', async () => {
    // 1. Create a media asset
    const media = await realRepository.createMedia({
      url: 'https://example.com/v1.jpg',
      altText: 'Version 1 Alt',
      isDecorative: false,
    });

    // 2. Modify it to a new state
    await realRepository.updateMedia(media.id, {
      url: 'https://example.com/v2.jpg',
      altText: 'Version 2 Alt',
      isDecorative: true,
    });

    // 3. Find the first snapshot (v1) to restore back to
    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'Media', entityId: media.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(snapshots).toHaveLength(2);

    const firstSnapshot = snapshots[0];
    const snapshotData = firstSnapshot.data as any;

    // 4. Simulate the POST /api/admin/versions/[id]/restore logic for Media
    const parsedData = MediaSchema.parse({
      id: firstSnapshot.entityId,
      url: snapshotData.url ?? '',
      altText: snapshotData.altText ?? null,
      isDecorative: snapshotData.isDecorative ?? false,
      createdAt: snapshotData.createdAt ? new Date(snapshotData.createdAt) : new Date(),
      updatedAt: snapshotData.updatedAt ? new Date(snapshotData.updatedAt) : new Date(),
    });

    const data = {
      url: parsedData.url,
      altText: parsedData.altText,
      isDecorative: parsedData.isDecorative,
      createdAt: parsedData.createdAt,
      updatedAt: parsedData.updatedAt,
    };

    // Execute the upsert
    await realPrisma.media.upsert({
      where: { id: firstSnapshot.entityId },
      update: data,
      create: { id: firstSnapshot.entityId, ...data },
    });

    // Create new snapshot for rollback tracking
    const rollbackSnapshot = await realPrisma.snapshotVersion.create({
      data: {
        entityType: firstSnapshot.entityType,
        entityId: firstSnapshot.entityId,
        data: snapshotData,
        author: 'Admin (Rollback)',
      },
    });

    // 5. Verify database matches snapshot v1 exactly
    const finalRecord = await realPrisma.media.findUnique({
      where: { id: media.id },
    });
    expect(finalRecord).not.toBeNull();
    expect(finalRecord!.url).toBe('https://example.com/v1.jpg');
    expect(finalRecord!.altText).toBe('Version 1 Alt');
    expect(finalRecord!.isDecorative).toBe(false);

    // 6. Verify that a rollback snapshot is created in logs
    expect(rollbackSnapshot.author).toBe('Admin (Rollback)');
    const latestSnapshot = await realPrisma.snapshotVersion.findFirst({
      where: { entityType: 'Media', entityId: media.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestSnapshot!.author).toBe('Admin (Rollback)');
  });
});
