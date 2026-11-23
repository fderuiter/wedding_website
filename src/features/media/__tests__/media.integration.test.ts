/**
 * @jest-environment node
 */

import { MediaRepository } from '../repository';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { MediaSchema } from '../schemas';
import { ContentRepository, ContentService } from '@/features/content';

// Unmock @prisma/client for this test file so we can interact with the real PostgreSQL container
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');

const connectionString = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

// Instantiate MediaRepository with the real PrismaClient
const realRepository = new MediaRepository(realPrisma);
const realContentRepository = new ContentRepository(realPrisma);
const realContentService = new ContentService(realContentRepository);

describe('Media Repository & Rollback Database Integration', () => {
  beforeEach(async () => {
    // Clean up database tables before each test
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.contentNode.deleteMany();
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.contributor.deleteMany();
    await realPrisma.registryItem.deleteMany();
    await realPrisma.media.deleteMany();
  });

  afterAll(async () => {
    // Perform final cleanup and close connections
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.contentNode.deleteMany();
    await realPrisma.weddingPartyMember.deleteMany();
    await realPrisma.attraction.deleteMany();
    await realPrisma.contributor.deleteMany();
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

  test('synchronizes Photo ContentNode across create, update, unpublish, and delete inside transactions', async () => {
    const created = await realRepository.createMedia(
      {
        url: '/uploads/local-ceremony.jpg',
        altText: 'Ceremony Entrance',
        isDecorative: false,
        publishToGallery: true,
      },
      'CoupleAdmin'
    );

    expect(created.publishToGallery).toBe(true);

    let publicPhotos = await realContentService.getPublicPhotos();
    expect(publicPhotos).toHaveLength(1);
    expect((publicPhotos[0].data as any).url).toBe('/uploads/local-ceremony.jpg');
    expect((publicPhotos[0].data as any).title).toBe('Ceremony Entrance');
    expect((publicPhotos[0].data as any).mediaId).toBe(created.id);

    // Updating Media altText/URL updates the linked Photo ContentNode
    await realRepository.updateMedia(
      created.id,
      {
        url: '/uploads/local-ceremony-edited.jpg',
        altText: 'Updated Ceremony Entrance',
      },
      'CoupleAdmin'
    );

    publicPhotos = await realContentService.getPublicPhotos();
    expect(publicPhotos).toHaveLength(1);
    expect((publicPhotos[0].data as any).url).toBe('/uploads/local-ceremony-edited.jpg');
    expect((publicPhotos[0].data as any).title).toBe('Updated Ceremony Entrance');

    // Unpublishing removes linked Photo ContentNode, and re-publishing restores it
    await realRepository.updateMedia(created.id, { publishToGallery: false }, 'CoupleAdmin');
    expect(await realContentService.getPublicPhotos()).toHaveLength(0);

    await realRepository.updateMedia(created.id, { publishToGallery: true }, 'CoupleAdmin');
    expect(await realContentService.getPublicPhotos()).toHaveLength(1);

    // Deleting Media record deletes its linked Photo ContentNode
    await realRepository.deleteMedia(created.id, 'CoupleAdmin');
    expect(await realContentService.getPublicPhotos()).toHaveLength(0);
  });

  test('excludes registry item images from getPublicPhotos unless publishToGallery is enabled', async () => {
    const registryMedia = await realRepository.createMedia(
      {
        url: '/uploads/registry-kettle.jpg',
        altText: 'Electric Kettle',
        isDecorative: false,
      },
      'Admin'
    );

    await realPrisma.registryItem.create({
      data: {
        name: 'Electric Kettle',
        description: 'Matte black gooseneck kettle',
        price: 85,
        quantity: 1,
        category: 'Kitchen',
        vendorUrl: 'https://store.example.com/kettle',
        imageId: registryMedia.id,
      },
    });

    // Even if a legacy Photo ContentNode points to registryMedia without publishToGallery, it is excluded
    await realPrisma.contentNode.create({
      data: {
        type: 'Photo',
        tags: ['gallery'],
        data: {
          url: registryMedia.url,
          title: 'Electric Kettle',
          status: 'APPROVED',
          isVisible: true,
          mediaId: registryMedia.id,
        },
      },
    });

    expect(await realContentService.getPublicPhotos()).toHaveLength(0);

    // Enabling gallery publishing makes it appear in getPublicPhotos
    await realRepository.updateMedia(registryMedia.id, { publishToGallery: true }, 'Admin');
    const published = await realContentService.getPublicPhotos();
    expect(published).toHaveLength(1);
    expect((published[0].data as any).mediaId).toBe(registryMedia.id);
  });

  test('persists, surfaces, and clears caption and uploaderName on linked Photo ContentNode without failing Prisma Media writes', async () => {
    const created = await realRepository.createMedia(
      {
        url: '/uploads/photos/guest-toast.jpg',
        altText: 'Champagne Toast',
        isDecorative: false,
        publishToGallery: true,
        caption: 'To the happy couple!',
        uploaderName: 'Aunt Clara',
      },
      'Admin'
    );

    expect(created.caption).toBe('To the happy couple!');
    expect(created.uploaderName).toBe('Aunt Clara');

    const listed = await realRepository.getAllMedia();
    const matched = listed.data.find((item) => item.id === created.id);
    expect(matched?.caption).toBe('To the happy couple!');
    expect(matched?.uploaderName).toBe('Aunt Clara');

    // Update caption and clear uploaderName
    const updated = await realRepository.updateMedia(
      created.id,
      {
        caption: 'Polished Toast Caption',
        uploaderName: '   ',
      },
      'Admin'
    );
    expect(updated.caption).toBe('Polished Toast Caption');
    expect(updated.uploaderName).toBeUndefined();

    const publicPhotos = await realContentService.getPublicPhotos();
    expect(publicPhotos).toHaveLength(1);
    expect((publicPhotos[0].data as any).caption).toBe('Polished Toast Caption');
    expect((publicPhotos[0].data as any).uploaderName).toBeUndefined();
  });
});
