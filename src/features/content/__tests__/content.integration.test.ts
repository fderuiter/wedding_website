/**
 * @jest-environment node
 */

import { ContentRepository } from '../repository';
import { ContentService } from '../service';
import { ContentNodeAdminService } from '../admin.service';
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

  test('moderatePhotosBatch executes 1 transaction, 0 pool waiters, < 10 SQL statements, bulk audit snapshots, and 1 prune query across 100-photo approve and reject batches on a 5-connection pg.Pool', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { prisma: singletonPrisma } = await import('@/lib/prisma');
    const globalRef = globalThis as { prisma?: unknown };
    const prevGlobalPrisma = globalRef.prisma;

    const cappedPool = new Pool({ connectionString, max: 5 });
    const wireQueries: string[] = [];
    let maxPoolWaiters = 0;

    const wrapClientQuery = (client: { query?: (...args: any[]) => any; __wireWrapped?: boolean }) => {
      if (!client || typeof client.query !== 'function' || client.__wireWrapped) return;
      client.__wireWrapped = true;
      const origQuery = client.query.bind(client);
      client.query = (...args: any[]) => {
        if (cappedPool.waitingCount > maxPoolWaiters) {
          maxPoolWaiters = cappedPool.waitingCount;
        }
        const first = args[0];
        const sqlText =
          typeof first === 'string'
            ? first
            : first && typeof first === 'object' && typeof first.text === 'string'
              ? first.text
              : '';
        if (sqlText) {
          wireQueries.push(sqlText.trim());
        }
        return origQuery(...args);
      };
    };

    cappedPool.on('connect', (client) => {
      wrapClientQuery(client as any);
    });
    cappedPool.on('acquire', () => {
      if (cappedPool.waitingCount > maxPoolWaiters) {
        maxPoolWaiters = cappedPool.waitingCount;
      }
    });

    const cappedPrisma = new PrismaClient({ adapter: new PrismaPg(cappedPool) });
    const cappedContentRepo = new ContentRepository(cappedPrisma);
    const cappedContentSvc = new ContentService(cappedContentRepo);

    // Route pruneSnapshotsBulk raw queries through cappedPrisma so post-commit pruning is captured on wireQueries
    const origExecuteRaw = singletonPrisma.$executeRaw?.bind(singletonPrisma);
    (singletonPrisma as any).$executeRaw = cappedPrisma.$executeRaw.bind(cappedPrisma);
    globalRef.prisma = cappedPrisma;

    const uploadsPhotosDir = path.join(process.cwd(), 'public', 'uploads', 'photos');
    await fs.mkdir(uploadsPhotosDir, { recursive: true });
    const createdFiles: string[] = [];

    try {
      // Seed 100 pending guest photos + 100 Media rows + files on disk (with some shared URLs to verify deduplication)
      const batchSize = 100;
      const mediaData = [];
      const nodeData = [];
      for (let i = 0; i < batchSize; i++) {
        const fileIdx = i < 95 ? i : 95; // last 5 share one blob URL
        const filename = `__wire_bench_${process.pid}_${fileIdx}.jpg`;
        const absPath = path.join(uploadsPhotosDir, filename);
        if (i <= 95) {
          await fs.writeFile(absPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
          createdFiles.push(absPath);
        }
        const mediaId = `bench-media-${i}`;
        const photoId = `bench-photo-${i}`;
        const url = `/uploads/photos/${filename}`;
        mediaData.push({
          id: mediaId,
          url,
          altText: `Guest Upload ${i}`,
          isDecorative: false,
        });
        nodeData.push({
          id: photoId,
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: {
            url,
            title: `Guest Upload ${i}`,
            altText: `Guest Upload ${i}`,
            mediaId,
            status: 'PENDING',
            isVisible: false,
          },
        });
      }

      await realPrisma.media.createMany({ data: mediaData });
      await realPrisma.contentNode.createMany({ data: nodeData });

      const allPhotoIds = nodeData.map((n) => n.id);

      // Warm up active pool connection so cold TCP handshake is not counted as a contention waiter
      await cappedPrisma.$queryRaw`SELECT 1`;

      // 1. Measure 100-photo Batch Approve
      wireQueries.length = 0;
      maxPoolWaiters = 0;

      const approveRes = await cappedContentSvc.moderatePhotosBatch(
        allPhotoIds,
        'approve',
        'WireBenchAdmin'
      );
      // Flush microtasks for post-commit pruneSnapshotsBulk
      await new Promise((resolve) => setTimeout(resolve, 50));

      const approveBegins = wireQueries.filter((q) => /^BEGIN\b/i.test(q));
      const approvePrunes = wireQueries.filter(
        (q) => /DELETE\s+FROM/i.test(q) && /SnapshotVersion/i.test(q)
      );

      expect(approveRes.total).toBe(100);
      expect(approveRes.succeededCount).toBe(100);
      expect(approveRes.failedCount).toBe(0);
      expect(approveRes.results.map((r) => r.id)).toEqual(allPhotoIds);
      expect(approveBegins).toHaveLength(1);
      expect(maxPoolWaiters).toBe(0);
      expect(wireQueries.length).toBeLessThan(10);
      expect(approvePrunes).toHaveLength(1);

      const approveSnapshots = await realPrisma.snapshotVersion.count({
        where: { entityType: 'ContentNode', author: 'WireBenchAdmin' },
      });
      expect(approveSnapshots).toBe(100);
      expect(await cappedContentSvc.getPublicPhotos({ limit: 100 })).toHaveLength(100);

      // 2. Measure 100-photo Batch Reject
      wireQueries.length = 0;
      maxPoolWaiters = 0;

      const rejectRes = await cappedContentSvc.moderatePhotosBatch(
        allPhotoIds,
        'reject',
        'WireBenchRejectAdmin'
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rejectBegins = wireQueries.filter((q) => /^BEGIN\b/i.test(q));
      const rejectPrunes = wireQueries.filter(
        (q) => /DELETE\s+FROM/i.test(q) && /SnapshotVersion/i.test(q)
      );

      expect(rejectRes.total).toBe(100);
      expect(rejectRes.succeededCount).toBe(100);
      expect(rejectRes.failedCount).toBe(0);
      expect(rejectRes.results.map((r) => r.id)).toEqual(allPhotoIds);
      expect(rejectBegins).toHaveLength(1);
      expect(maxPoolWaiters).toBe(0);
      expect(wireQueries.length).toBeLessThan(10);
      expect(rejectPrunes).toHaveLength(1);

      expect(await realPrisma.contentNode.count({ where: { id: { in: allPhotoIds } } })).toBe(0);
      expect(
        await realPrisma.media.count({ where: { id: { in: mediaData.map((m) => m.id) } } })
      ).toBe(0);

      const deletedNodeSnapshots = await realPrisma.snapshotVersion.count({
        where: { entityType: 'ContentNode', author: 'WireBenchRejectAdmin' },
      });
      const deletedMediaSnapshots = await realPrisma.snapshotVersion.count({
        where: { entityType: 'Media', author: 'WireBenchRejectAdmin' },
      });
      expect(deletedNodeSnapshots).toBe(100);
      expect(deletedMediaSnapshots).toBe(100);

      // Verify all 96 distinct local storage files were unlinked after commit
      for (const filePath of createdFiles) {
        await expect(fs.access(filePath)).rejects.toThrow();
      }
    } finally {
      if (origExecuteRaw) {
        (singletonPrisma as any).$executeRaw = origExecuteRaw;
      }
      globalRef.prisma = prevGlobalPrisma;
      for (const filePath of createdFiles) {
        await fs.rm(filePath, { force: true });
      }
      await cappedPrisma.$disconnect();
      await cappedPool.end();
    }
  });

  test('batch and single rejections preserve entity-bound media, out-of-root files, and input order while skipping redundant deleteNode transactions', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const uploadsPhotosDir = path.join(process.cwd(), 'public', 'uploads', 'photos');
    await fs.mkdir(uploadsPhotosDir, { recursive: true });

    const boundFile = path.join(uploadsPhotosDir, `__bound_keep_${process.pid}.jpg`);
    const guestFile = path.join(uploadsPhotosDir, `__guest_remove_${process.pid}.jpg`);
    const singleFile = path.join(uploadsPhotosDir, `__single_remove_${process.pid}.jpg`);
    const canaryName = `__batch_canary_${process.pid}.txt`;
    const canaryPath = path.resolve(process.cwd(), canaryName);

    await Promise.all([
      fs.writeFile(boundFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      fs.writeFile(guestFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      fs.writeFile(singleFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      fs.writeFile(canaryPath, 'KEEP_OUTSIDE_PUBLIC\n', 'utf8'),
    ]);

    try {
      const [registryMedia, guestMedia, singleMedia] = await Promise.all([
        realPrisma.media.create({
          data: {
            id: 'it-media-bound',
            url: `/uploads/photos/__bound_keep_${process.pid}.jpg`,
            altText: 'Registry Stand Mixer',
          },
        }),
        realPrisma.media.create({
          data: {
            id: 'it-media-guest',
            url: `/uploads/photos/__guest_remove_${process.pid}.jpg`,
            altText: 'Guest Dance Photo',
          },
        }),
        realPrisma.media.create({
          data: {
            id: 'it-media-single',
            url: `/uploads/photos/__single_remove_${process.pid}.jpg`,
            altText: 'Single Guest Photo',
          },
        }),
      ]);

      await realPrisma.registryItem.create({
        data: {
          name: 'Stand Mixer',
          description: 'bound to registry',
          category: 'Kitchen',
          price: 300,
          imageId: registryMedia.id,
        },
      });

      await realPrisma.contentNode.createMany({
        data: [
          {
            id: 'it-photo-bound',
            type: 'Photo',
            tags: ['gallery'],
            data: {
              url: registryMedia.url,
              mediaId: registryMedia.id,
              status: 'PENDING',
              isVisible: false,
            },
          },
          {
            id: 'it-photo-guest',
            type: 'Photo',
            tags: ['gallery', 'guest-upload'],
            data: {
              url: guestMedia.url,
              mediaId: guestMedia.id,
              status: 'PENDING',
              isVisible: false,
            },
          },
          {
            id: 'it-photo-canary',
            type: 'Photo',
            tags: ['gallery'],
            data: {
              url: `/../${canaryName}`,
              status: 'PENDING',
              isVisible: false,
            },
          },
          {
            id: 'it-photo-single',
            type: 'Photo',
            tags: ['gallery', 'guest-upload'],
            data: {
              url: singleMedia.url,
              mediaId: singleMedia.id,
              status: 'PENDING',
              isVisible: false,
            },
          },
        ],
      });

      const deleteNodeSpy = jest.spyOn(contentRepo, 'deleteNode');

      // 1. Single-photo rejection skips redundant ContentRepository.deleteNode after deleteMedia already removed the Photo node
      const singleRes = await contentSvc.moderatePhoto('it-photo-single', 'reject', 'AdminSingle');
      expect(singleRes).toEqual({ id: 'it-photo-single', deleted: true, status: 'REJECTED' });
      expect(deleteNodeSpy).not.toHaveBeenCalled();
      expect(await realPrisma.contentNode.findUnique({ where: { id: 'it-photo-single' } })).toBeNull();
      expect(await realPrisma.media.findUnique({ where: { id: singleMedia.id } })).toBeNull();
      await expect(fs.access(singleFile)).rejects.toThrow();

      // 2. Mixed batch rejection preserves input order, keeps entity-bound media + canary file intact, and removes guest photo/media
      const batchRes = await contentSvc.moderatePhotosBatch(
        ['it-photo-canary', 'missing-photo-id', 'it-photo-bound', 'it-photo-guest'],
        'reject',
        'AdminMixedBatch'
      );

      expect(deleteNodeSpy).not.toHaveBeenCalled();
      expect(batchRes.total).toBe(4);
      expect(batchRes.succeededCount).toBe(3);
      expect(batchRes.failedCount).toBe(1);
      expect(batchRes.results.map((r) => ({ id: r.id, success: r.success }))).toEqual([
        { id: 'it-photo-canary', success: true },
        { id: 'missing-photo-id', success: false },
        { id: 'it-photo-bound', success: true },
        { id: 'it-photo-guest', success: true },
      ]);

      // Entity-bound Media row and its file remain intact while its Photo node was removed
      expect(await realPrisma.media.findUnique({ where: { id: registryMedia.id } })).not.toBeNull();
      await expect(fs.access(boundFile)).resolves.toBeUndefined();

      // Unreferenced guest Media row and its file were removed
      expect(await realPrisma.media.findUnique({ where: { id: guestMedia.id } })).toBeNull();
      await expect(fs.access(guestFile)).rejects.toThrow();

      // Out-of-root canary file outside public/uploads was NOT unlinked
      expect(await fs.readFile(canaryPath, 'utf8')).toBe('KEEP_OUTSIDE_PUBLIC\n');

      deleteNodeSpy.mockRestore();
    } finally {
      await Promise.all([
        fs.rm(boundFile, { force: true }),
        fs.rm(guestFile, { force: true }),
        fs.rm(singleFile, { force: true }),
        fs.rm(canaryPath, { force: true }),
      ]);
    }
  });
});
