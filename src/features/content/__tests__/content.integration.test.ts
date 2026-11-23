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

  test('getNodesByType executes Prisma query filtering createdAt with cursor and bounding by limit', async () => {
    const t1 = new Date('2026-06-20T10:00:00.000Z');
    const t2 = new Date('2026-06-20T11:00:00.000Z');
    const t3 = new Date('2026-06-20T12:00:00.000Z');

    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'photo-old',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p1.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t1,
        },
        {
          id: 'photo-mid',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p2.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t2,
        },
        {
          id: 'photo-new',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: 'https://example.com/p3.jpg', isVisible: true, status: 'APPROVED' },
          createdAt: t3,
        },
      ],
    });

    // Query since t1 -> should return photo-new and photo-mid (createdAt > t1)
    const afterT1 = await contentRepo.getNodesByType('Photo', { since: t1 });
    expect(afterT1).toHaveLength(2);
    expect(afterT1[0].id).toBe('photo-new');
    expect(afterT1[1].id).toBe('photo-mid');

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

    await realPrisma.contentNode.createMany({
      data: [
        {
          id: 'pub-legacy-url',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/../legacy-stored-ceremony.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t1,
        },
        {
          id: 'pub-approved-1',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/photos/approved-1.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t2,
        },
        {
          id: 'pub-approved-2',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/approved-2.jpg', status: 'APPROVED', isVisible: true },
          createdAt: t3,
        },
        {
          id: 'hidden-approved',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/photos/hidden.jpg', status: 'APPROVED', isVisible: false },
          createdAt: t4,
        },
        {
          id: 'pending-newer',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/pending.jpg', status: 'PENDING', isVisible: false },
          createdAt: t5,
        },
        {
          id: 'rejected-newest',
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: { url: '/uploads/photos/rejected.jpg', status: 'REJECTED', isVisible: false },
          createdAt: t6,
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
