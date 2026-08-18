/**
 * @jest-environment node
 */

import { ContentRepository } from '../repository';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Unmock Prisma / adapter modules for real database integration
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');

import fs from 'fs';
import path from 'path';

let connectionString =
  process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
let isSqlite =
  connectionString.startsWith('file:') || connectionString.startsWith('sqlite:') || connectionString.includes('.db');

try {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const content = fs.readFileSync(schemaPath, 'utf8');
    if (content.includes('provider = "sqlite"') || content.includes('provider="sqlite"')) {
      isSqlite = true;
      connectionString = 'file:./test.db';
    }
  }
} catch (e) {}

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
      async executeScript(script: string) {
        db.exec(script);
      },
      async startTransaction() {
        db.exec('BEGIN');
        return {
          provider: 'sqlite',
          adapterName: 'builtin-sqlite-tx',
          options: { usePhantomQuery: true },
          queryRaw,
          executeRaw,
          async commit() {
            db.exec('COMMIT');
          },
          async rollback() {
            db.exec('ROLLBACK');
          },
        };
      },
      async dispose() {
        db.close();
      },
    };
    return {
      provider: 'sqlite',
      adapterName: 'builtin-sqlite',
      async connect() {
        return driverAdapter;
      },
    };
  };
  const adapter = createSqliteAdapter(connectionString);
  realPrisma = new PrismaClient({ adapter });
} else {
  pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  realPrisma = new PrismaClient({ adapter });
}

const contentRepo = new ContentRepository(realPrisma);

describe('Content Domain Database Integration', () => {
  beforeEach(async () => {
    // Isolate test database states between runs to prevent cross-test data pollution
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.contentNode.deleteMany();
    await realPrisma.appConfig.deleteMany();

    // Seed default global AppConfig record
    await realPrisma.appConfig.create({
      data: {
        id: 'global',
        brideName: 'Jane',
        groomName: 'John',
        features: [
          { id: 'f1', type: 'hero', title: 'Hero Section', visible: true },
          { id: 'f2', type: 'story', title: 'Our Story', visible: true },
        ],
      },
    });
  });

  afterAll(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.contentNode.deleteMany();
    await realPrisma.appConfig.deleteMany();
    await realPrisma.$disconnect();
    if (pool) {
      await pool.end();
    }
  });

  test('updateFeatures executes atomic transactions and persists feature updates', async () => {
    const updatedFeatures = [
      { id: 'f2', type: 'story', title: 'Our Story', visible: false },
      { id: 'f1', type: 'hero', title: 'Hero Section', visible: true },
      { id: 'f3', type: 'custom', title: 'New Custom Section', visible: true },
    ];

    const result = await contentRepo.updateFeatures(updatedFeatures, 'AdminAuthor', 'global');

    expect(result).toBeDefined();
    expect(result.id).toBe('global');
    expect(result.features).toHaveLength(3);

    // Verify the record in the database
    const dbRecord = await realPrisma.appConfig.findUnique({ where: { id: 'global' } });
    expect(dbRecord).not.toBeNull();
    const dbFeatures = typeof dbRecord.features === 'string' ? JSON.parse(dbRecord.features) : dbRecord.features;
    expect(dbFeatures).toHaveLength(3);
    expect(dbFeatures[0].id).toBe('f2');
    expect(dbFeatures[0].visible).toBe(false);
    expect(dbFeatures[2].id).toBe('f3');
    expect(dbFeatures[2].title).toBe('New Custom Section');
  });

  test('updateFeatures creates complete audit snapshot records in database upon feature modifications', async () => {
    const newFeatures = [
      { id: 'f1', type: 'hero', title: 'Updated Hero Title', visible: true },
    ];

    await contentRepo.updateFeatures(newFeatures, 'ContentManager', 'global');

    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'AppConfig', entityId: 'global' },
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].author).toBe('ContentManager');
    expect(snapshots[0].entityType).toBe('AppConfig');
    expect(snapshots[0].entityId).toBe('global');

    const snapshotData = snapshots[0].data as any;
    expect(snapshotData.previous).toBeDefined();
    expect(snapshotData.current).toBeDefined();
    expect(snapshotData.current[0].title).toBe('Updated Hero Title');
  });

  test('getAllNodes and getNodesByType query real ContentNode DB records', async () => {
    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'faq-node-1',
          type: 'FAQ',
          tags: ['faq', 'homepage'],
          data: { question: 'When is it?', answer: 'Saturday at 4 PM' },
        },
        {
          id: 'logistics-node-1',
          type: 'Logistics',
          tags: ['schedule'],
          data: { ceremonyTitle: 'Main Chapel', ceremonyTime: '4:00 PM' },
        },
        {
          id: 'photo-node-1',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/photo1.jpg', isVisible: true },
        },
      ],
    });

    const allNodes = await contentRepo.getAllNodes();
    expect(allNodes).toHaveLength(3);

    const faqNodes = await contentRepo.getNodesByType('FAQ');
    expect(faqNodes).toHaveLength(1);
    expect(faqNodes[0].id).toBe('faq-node-1');

    const photoNodes = await contentRepo.getNodesByType('Photo');
    expect(photoNodes).toHaveLength(1);
    expect(photoNodes[0].id).toBe('photo-node-1');
  });

  test('isolates test database state between test runs', async () => {
    // Confirm database tables are clean from previous test runs
    const snapshots = await realPrisma.snapshotVersion.findMany();
    const nodes = await realPrisma.contentNode.findMany();

    expect(snapshots).toHaveLength(0);
    expect(nodes).toHaveLength(0);
  });
});
