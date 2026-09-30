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

const connectionString =
  process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

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
