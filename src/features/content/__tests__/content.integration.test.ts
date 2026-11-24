/**
 * @jest-environment node
 */

import { ContentRepository } from '../repository';
import { ContentService } from '../service';
import { ContentNodeAdminService } from '../admin.service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { BaseService } from '@/core/infrastructure/service';
import { WeddingPartyAdminService } from '@/features/wedding-party';
import { RegistryItemAdminService, translateSnapshotToActive } from '@/features/registry';
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
const contentSvc = new ContentService(contentRepo);

describe('Content Domain Database Integration', () => {
  beforeEach(async () => {
    // Isolate test database states between runs to prevent cross-test data pollution
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
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
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
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

  test('getNodesByType queries real ContentNode DB records', async () => {
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

    const faqNodes = await contentRepo.getNodesByType('FAQ');
    expect(faqNodes).toHaveLength(1);
    expect(faqNodes[0].id).toBe('faq-node-1');

    const photoNodes = await contentRepo.getNodesByType('Photo');
    expect(photoNodes).toHaveLength(1);
    expect(photoNodes[0].id).toBe('photo-node-1');
  });

  test('getNodesByType executes Prisma query filtering updatedAt with cursor (including out-of-order approvals) and bounding by limit', async () => {
    const t1 = new Date('2026-06-20T10:00:00.000Z');
    const t2 = new Date('2026-06-20T11:00:00.000Z');
    const t3 = new Date('2026-06-20T12:00:00.000Z');
    const t4 = new Date('2026-06-20T13:00:00.000Z');

    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'photo-old',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p1.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t1,
          updatedAt: t1,
        },
        {
          id: 'photo-mid',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p2.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t2,
          updatedAt: t2,
        },
        {
          id: 'photo-new',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p3.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t3,
          updatedAt: t3,
        },
      ],
    });

    // Query since t1 -> should return photo-new and photo-mid (updatedAt > t1)
    const afterT1 = await contentRepo.getNodesByType('Photo', { since: t1 });
    expect(afterT1).toHaveLength(2);
    expect(afterT1[0].id).toBe('photo-new');
    expect(afterT1[1].id).toBe('photo-mid');

    // Out-of-order moderation: photo-old (createdAt = t1) is approved/edited at t4 (> t3)
    await realPrisma.contentNode.update({
      where: { id: 'photo-old' },
      data: {
        data: { url: 'https://example.com/p1.jpg', isVisible: true, status: 'APPROVED', caption: 'Late Approval' },
        updatedAt: t4,
      },
    });
    const afterT3 = await contentRepo.getNodesByType('Photo', { since: t3 });
    expect(afterT3.map((n) => n.id)).toEqual(['photo-old']);

    // Query with limit 1
    const bounded = await contentRepo.getNodesByType('Photo', { limit: 1 });
    expect(bounded).toHaveLength(1);
    expect(bounded[0].id).toBe('photo-new');
  });

  test('isolates test database state between test runs', async () => {
    // Confirm database tables are clean from previous test runs
    const snapshots = await realPrisma.snapshotVersion.findMany();
    const nodes = await realPrisma.contentNode.findMany();

    expect(snapshots).toHaveLength(0);
    expect(nodes).toHaveLength(0);
  });

  test('ContentNodeAdminService.reorder updates JSONB displayOrder atomically and writes audit snapshots', async () => {
    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'faq-reorder-a',
          type: 'FAQ',
          tags: ['Homepage', 'FAQ'],
          data: { question: 'Question A', answer: 'Answer A', displayOrder: 0, isVisible: true },
        },
        {
          id: 'faq-reorder-b',
          type: 'FAQ',
          tags: ['Homepage', 'FAQ'],
          data: { question: 'Question B', answer: 'Answer B', displayOrder: 1, isVisible: true },
        },
      ],
    });

    const adminService = new ContentNodeAdminService(realPrisma);
    await adminService.reorder(['faq-reorder-b', 'faq-reorder-a'], 'ReorderTester');

    const nodeA = await realPrisma.contentNode.findUnique({ where: { id: 'faq-reorder-a' } });
    const nodeB = await realPrisma.contentNode.findUnique({ where: { id: 'faq-reorder-b' } });

    expect((nodeB.data as Record<string, unknown>).displayOrder).toBe(0);
    expect((nodeB.data as Record<string, unknown>).question).toBe('Question B');
    expect((nodeA.data as Record<string, unknown>).displayOrder).toBe(1);
    expect((nodeA.data as Record<string, unknown>).question).toBe('Question A');

    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'ContentNode', author: 'ReorderTester' },
    });
    expect(snapshots).toHaveLength(2);
  });

  function createTracedPrisma() {
    const tracedPool = new Pool({ connectionString });
    const wireQueries: string[] = [];
    let poolCheckouts = 0;
    const wrappedClients = new WeakSet<object>();

    tracedPool.on('acquire', (pgClient: any) => {
      poolCheckouts++;
      if (pgClient && !wrappedClients.has(pgClient)) {
        wrappedClients.add(pgClient);
        const origQuery = pgClient.query.bind(pgClient);
        pgClient.query = ((...qArgs: unknown[]) => {
          const text =
            typeof qArgs[0] === 'string'
              ? qArgs[0]
              : (qArgs[0] as { text?: string } | undefined)?.text ?? '';
          wireQueries.push(text);
          return origQuery(...qArgs);
        }) as typeof pgClient.query;
      }
    });

    const tracedPrisma = new PrismaClient({ adapter: new PrismaPg(tracedPool) });
    return {
      tracedPool,
      tracedPrisma,
      wireQueries,
      resetMetrics: () => {
        wireQueries.length = 0;
        poolCheckouts = 0;
      },
      getPoolCheckouts: () => poolCheckouts,
    };
  }

  test('ContentNodeAdminService.reorder batches updates into 1 SQL UPDATE, skips missing IDs, deduplicates IDs, rolls back on error, and supports mock fallback', async () => {
    const { tracedPool, tracedPrisma, wireQueries, resetMetrics, getPoolCheckouts } =
      createTracedPrisma();

    try {
      await tracedPrisma.contentNode.createMany({
        data: Array.from({ length: 10 }, (_, idx) => ({
          id: `faq-batch-${idx}`,
          type: 'FAQ',
          tags: ['Homepage', 'FAQ'],
          data: {
            question: `Question ${idx}`,
            answer: `Answer ${idx}`,
            displayOrder: idx,
            isVisible: true,
          },
        })),
      });

      resetMetrics();

      const adminService = new ContentNodeAdminService(tracedPrisma);
      const reversedIds = Array.from({ length: 10 }, (_, idx) => `faq-batch-${9 - idx}`);
      // Include a missing ID (skipped) and a trailing duplicate of faq-batch-9
      await adminService.reorder(
        ['missing-faq-id', ...reversedIds, 'faq-batch-9'],
        'BatchFaqAuthor'
      );

      const updateQueries = wireQueries.filter((q) => /^\s*UPDATE\b/i.test(q));
      expect(updateQueries).toHaveLength(1);
      expect(getPoolCheckouts()).toBe(1);

      const firstMoved = await tracedPrisma.contentNode.findUnique({
        where: { id: 'faq-batch-8' },
      });
      const duplicatedMoved = await tracedPrisma.contentNode.findUnique({
        where: { id: 'faq-batch-9' },
      });
      expect((firstMoved.data as Record<string, unknown>).displayOrder).toBe(1);
      expect((firstMoved.data as Record<string, unknown>).question).toBe('Question 8');
      // Duplicate faq-batch-9 received last sequential index (10)
      expect((duplicatedMoved.data as Record<string, unknown>).displayOrder).toBe(10);

      const snapshots = await tracedPrisma.snapshotVersion.findMany({
        where: { entityType: 'ContentNode', author: 'BatchFaqAuthor' },
      });
      expect(snapshots).toHaveLength(10);
      expect(snapshots[0].data).toEqual(
        expect.objectContaining({
          type: 'FAQ',
          tags: ['Homepage', 'FAQ'],
          data: expect.objectContaining({ isVisible: true }),
        })
      );

      // Verify atomic rollback if snapshot write fails after $executeRaw
      const failingPrisma = new Proxy(tracedPrisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return (cb: (tx: any) => Promise<unknown>) =>
              target.$transaction(async (tx: any) => {
                const wrappedTx = new Proxy(tx, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === 'snapshotVersion') {
                      return {
                        ...txTarget.snapshotVersion,
                        createMany: () => Promise.reject(new Error('Simulated snapshot failure')),
                      };
                    }
                    return Reflect.get(txTarget, txProp, txReceiver);
                  },
                });
                return cb(wrappedTx);
              });
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const failingService = new ContentNodeAdminService(failingPrisma);
      await expect(
        failingService.reorder(['faq-batch-0', 'faq-batch-8'], 'RollbackAuthor')
      ).rejects.toThrow('Simulated snapshot failure');

      const afterRollback = await tracedPrisma.contentNode.findUnique({
        where: { id: 'faq-batch-8' },
      });
      expect((afterRollback.data as Record<string, unknown>).displayOrder).toBe(1);
      const rollbackSnapshots = await tracedPrisma.snapshotVersion.findMany({
        where: { entityType: 'ContentNode', author: 'RollbackAuthor' },
      });
      expect(rollbackSnapshots).toHaveLength(0);

      // Verify mock fallback when $executeRaw is absent
      const mockUpdate = jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        type: 'FAQ',
        tags: ['FAQ'],
        data: data.data,
      }));
      const mockSnapshotCreateMany = jest.fn().mockResolvedValue({ count: 2 });
      const mockFallbackTx = {
        contentNode: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'm-faq-1', type: 'FAQ', tags: ['FAQ'], data: { question: 'Q1', displayOrder: 0 } },
            { id: 'm-faq-2', type: 'FAQ', tags: ['FAQ'], data: { question: 'Q2', displayOrder: 1 } },
          ]),
          update: mockUpdate,
        },
        snapshotVersion: {
          createMany: mockSnapshotCreateMany,
        },
      };
      const mockFallbackClient = {
        $transaction: jest.fn((cb: any) => cb(mockFallbackTx)),
      };
      const fallbackService = new ContentNodeAdminService(mockFallbackClient);
      await fallbackService.reorder(['m-faq-2', 'm-faq-1'], 'FallbackAuthor');
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockSnapshotCreateMany).toHaveBeenCalledTimes(1);
    } finally {
      await tracedPrisma.$disconnect();
      await tracedPool.end();
    }
  });

  test('BaseService, WeddingPartyAdminService, and RegistryItemAdminService each execute 1 UPDATE on 1 pg.Pool connection with full snapshots and rollbacks', async () => {
    const { tracedPool, tracedPrisma, wireQueries, resetMetrics, getPoolCheckouts } =
      createTracedPrisma();

    try {
      const media = await tracedPrisma.media.create({
        data: { url: '/uploads/reorder-test.jpg', altText: 'Reorder Test Media' },
      });

      await tracedPrisma.weddingPartyMember.createMany({
        data: [
          {
            id: 'wp-1',
            name: 'Member One',
            role: 'Maid of Honor',
            bio: 'Bio One',
            side: 'BRIDE',
            photoId: media.id,
            order: 0,
          },
          {
            id: 'wp-2',
            name: 'Member Two',
            role: 'Best Man',
            bio: 'Bio Two',
            side: 'GROOM',
            photoId: media.id,
            order: 1,
          },
          {
            id: 'wp-3',
            name: 'Member Three',
            role: 'Bridesmaid',
            bio: 'Bio Three',
            side: 'JOINT',
            photoId: media.id,
            order: 2,
          },
        ],
      });

      // 1. BaseService.reorder -> 1 UPDATE statement, 1 pool checkout, rollback on missing ID
      const basePartyService = new BaseService(
        new BaseRepository('weddingPartyMember', tracedPrisma),
        'WeddingPartyMember'
      );
      resetMetrics();
      await basePartyService.reorder(['wp-3', 'wp-1', 'wp-2']);
      expect(wireQueries.filter((q) => /^\s*UPDATE\b/i.test(q))).toHaveLength(1);
      expect(getPoolCheckouts()).toBe(1);

      await expect(basePartyService.reorder(['wp-1', 'missing-wp'])).rejects.toThrow(
        /Record to update not found/
      );
      const wpAfterFailedBaseReorder = await tracedPrisma.weddingPartyMember.findMany({
        orderBy: { order: 'asc' },
      });
      expect(wpAfterFailedBaseReorder.map((m: any) => m.id)).toEqual(['wp-3', 'wp-1', 'wp-2']);

      // 2. WeddingPartyAdminService.reorder -> 1 UPDATE statement, 1 pool checkout, full SnapshotVersion fields
      const weddingPartyAdmin = new WeddingPartyAdminService(tracedPrisma);
      resetMetrics();
      await weddingPartyAdmin.reorder(['wp-2', 'wp-3', 'wp-1'], 'PartyOrderAuthor');
      expect(wireQueries.filter((q) => /^\s*UPDATE\b/i.test(q))).toHaveLength(1);
      expect(getPoolCheckouts()).toBe(1);

      const wpSnapshots = await tracedPrisma.snapshotVersion.findMany({
        where: { entityType: 'WeddingPartyMember', author: 'PartyOrderAuthor' },
      });
      expect(wpSnapshots).toHaveLength(3);
      const wp2Snap = wpSnapshots.find((s: any) => s.entityId === 'wp-2');
      expect(wp2Snap?.data).toEqual(
        expect.objectContaining({
          id: 'wp-2',
          name: 'Member Two',
          role: 'Best Man',
          bio: 'Bio Two',
          side: 'GROOM',
          photoId: media.id,
          order: 0,
        })
      );

      // 3. RegistryItemAdminService.reorder -> 1 UPDATE statement, 1 pool checkout, full SnapshotVersion fields
      await tracedPrisma.registryItem.createMany({
        data: [
          {
            id: 'reg-1',
            name: 'Coffee Grinder',
            description: 'Burr grinder',
            category: 'Kitchen',
            price: 180,
            imageId: media.id,
            displayOrder: 0,
          },
          {
            id: 'reg-2',
            name: 'Linen Sheets',
            description: 'Queen set',
            category: 'Bedroom',
            price: 240,
            imageId: media.id,
            displayOrder: 1,
          },
        ],
      });

      const registryAdmin = new RegistryItemAdminService(tracedPrisma);
      resetMetrics();
      await registryAdmin.reorder(['reg-2', 'reg-1'], 'RegistryOrderAuthor');
      expect(wireQueries.filter((q) => /^\s*UPDATE\b/i.test(q))).toHaveLength(1);
      expect(getPoolCheckouts()).toBe(1);

      const reorderedReg = await tracedPrisma.registryItem.findMany({
        orderBy: { displayOrder: 'asc' },
      });
      expect(reorderedReg.map((r: any) => r.id)).toEqual(['reg-2', 'reg-1']);

      const regSnapshots = await tracedPrisma.snapshotVersion.findMany({
        where: { entityType: 'RegistryItem', author: 'RegistryOrderAuthor' },
      });
      expect(regSnapshots).toHaveLength(2);
      const reg2Snap = regSnapshots.find((s: any) => s.entityId === 'reg-2');
      const translated = translateSnapshotToActive(reg2Snap?.data);
      expect(translated).toEqual(
        expect.objectContaining({
          name: 'Linen Sheets',
          description: 'Queen set',
          category: 'Bedroom',
          price: 240,
          imageId: media.id,
          displayOrder: 0,
        })
      );
    } finally {
      await tracedPrisma.$disconnect();
      await tracedPool.end();
    }
  });

  test('getPublicPhotos filters approved visible photos in PostgreSQL, applies limit and since to eligible rows, and accepts legacy URLs', async () => {
    const t1 = new Date('2026-06-20T10:00:00.000Z');
    const t2 = new Date('2026-06-20T11:00:00.000Z');
    const t3 = new Date('2026-06-20T12:00:00.000Z');
    const t4 = new Date('2026-06-20T13:00:00.000Z');
    const t5 = new Date('2026-06-20T14:00:00.000Z');
    const t6 = new Date('2026-06-20T15:00:00.000Z');
    const t7 = new Date('2026-06-20T16:00:00.000Z');

    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'pub-legacy-url',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/../legacy-stored-ceremony.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t1,
          updatedAt: t1,
        },
        {
          id: 'pub-approved-1',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/photos/approved-1.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t2,
          updatedAt: t2,
        },
        {
          id: 'pub-approved-2',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/approved-2.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t3,
          updatedAt: t3,
        },
        {
          id: 'hidden-approved',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/photos/hidden.jpg', status: 'APPROVED', isVisible: false },
          createdAt: t4,
          updatedAt: t4,
        },
        {
          id: 'pending-newer',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/pending.jpg', status: 'PENDING', isVisible: false },
          createdAt: t5,
          updatedAt: t5,
        },
        {
          id: 'rejected-newest',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/rejected.jpg', status: 'REJECTED', isVisible: false },
          createdAt: t6,
          updatedAt: t6,
        },
      ],
    });

    const allPublic = await contentSvc.getPublicPhotos();
    expect(allPublic.map((n) => n.id)).toEqual(['pub-approved-2', 'pub-approved-1', 'pub-legacy-url']);

    // Newer PENDING/REJECTED/hidden rows must never displace approved rows under limit
    const bounded = await contentSvc.getPublicPhotos({ limit: 2 });
    expect(bounded.map((n) => n.id)).toEqual(['pub-approved-2', 'pub-approved-1']);

    // Incremental since queries exclude unmoderated newer uploads and order newest-first
    const sinceT1 = await contentSvc.getPublicPhotos({ since: t1 });
    expect(sinceT1.map((n) => n.id)).toEqual(['pub-approved-2', 'pub-approved-1']);

    const sinceT3 = await contentSvc.getPublicPhotos({ since: t3 });
    expect(sinceT3).toEqual([]);

    // Out-of-order approval/metadata edit of an older photo surfaces via updatedAt > t3
    await realPrisma.contentNode.update({
      where: { id: 'pub-approved-1' },
      data: {
        data: {
          url: '/uploads/photos/approved-1.jpg',
          status: 'APPROVED',
          isVisible: true,
          caption: 'Updated Reception Caption',
        },
        updatedAt: t7,
      },
    });
    const sinceT3AfterEdit = await contentSvc.getPublicPhotos({ since: t3 });
    expect(sinceT3AfterEdit.map((n) => n.id)).toEqual(['pub-approved-1']);
  });

  test('getPublicPhotos excludes entity-bound media before applying row limits unless publishToGallery is true', async () => {
    const [partyMedia, attractionMedia, registryMedia, publishedRegistryMedia] = await Promise.all([
      realPrisma.media.create({ data: { url: '/uploads/party.jpg', altText: 'Best Man' } }),
      realPrisma.media.create({ data: { url: '/uploads/hotel.jpg', altText: 'Hotel' } }),
      realPrisma.media.create({ data: { url: '/uploads/toaster.jpg', altText: 'Toaster' } }),
      realPrisma.media.create({ data: { url: '/uploads/published-gift.jpg', altText: 'Published Gift' } }),
    ]);

    await realPrisma.weddingPartyMember.create({
      data: { name: 'Alex', role: 'Best Man', bio: 'Bio', photoId: partyMedia.id },
    });
    await realPrisma.attraction.create({
      data: {
        name: 'Grand Hotel',
        description: 'Block',
        imageId: attractionMedia.id,
        category: 'Hotel',
        website: 'https://hotel.example.com',
        directions: '1 Main St',
        latitude: 30.2,
        longitude: -97.7,
      },
    });
    await realPrisma.registryItem.createMany({
      data: [
        {
          name: 'Toaster',
          description: '2-slice',
          category: 'Kitchen',
          price: 50,
          imageId: registryMedia.id,
        },
        {
          name: 'Published Gift',
          description: 'Shared in gallery',
          category: 'Home',
          price: 120,
          imageId: publishedRegistryMedia.id,
        },
      ],
    });

    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'photo-older-curated',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/curated.jpg', status: 'APPROVED', isVisible: true },
          createdAt: new Date('2026-06-20T10:00:00.000Z'),
        },
        {
          id: 'photo-published-entity',
          type: 'Photo',
          tags: ['gallery', 'curated'],
          data: {
            url: publishedRegistryMedia.url,
            status: 'APPROVED',
            isVisible: true,
            mediaId: publishedRegistryMedia.id,
            publishToGallery: true,
          },
          createdAt: new Date('2026-06-20T11:00:00.000Z'),
        },
        {
          id: 'photo-bound-party',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: partyMedia.url, status: 'APPROVED', isVisible: true, mediaId: partyMedia.id },
          createdAt: new Date('2026-06-20T12:00:00.000Z'),
        },
        {
          id: 'photo-bound-attraction',
          type: 'Photo',
          tags: ['gallery'],
          data: {
            url: attractionMedia.url,
            status: 'APPROVED',
            isVisible: true,
            mediaId: attractionMedia.id,
            publishToGallery: false,
          },
          createdAt: new Date('2026-06-20T13:00:00.000Z'),
        },
        {
          id: 'photo-bound-registry',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: registryMedia.url, status: 'APPROVED', isVisible: true, mediaId: registryMedia.id },
          createdAt: new Date('2026-06-20T14:00:00.000Z'),
        },
      ],
    });

    // Unbounded query excludes the 3 newer unpublished entity-bound photos
    const unbounded = await contentSvc.getPublicPhotos();
    expect(unbounded.map((n) => n.id)).toEqual(['photo-published-entity', 'photo-older-curated']);

    // Bounded limit=2 query still returns both eligible photos even though 3 newer rows are entity-bound
    const bounded = await contentSvc.getPublicPhotos({ limit: 2 });
    expect(bounded.map((n) => n.id)).toEqual(['photo-published-entity', 'photo-older-curated']);
  });
});
