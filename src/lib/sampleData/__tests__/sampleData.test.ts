/**
 * @jest-environment node
 */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { prisma } from '@/lib/prisma';
import {
  generateSampleData,
  purgeSampleData,
  getSampleDataStatus,
} from '../generator';
import { ARCHETYPE_PRESETS } from '../archetypes';

describe('Sample Data Generator & Purge', () => {
  beforeEach(async () => {
    // Clean up sample records before each test
    await purgeSampleData();
  });

  afterAll(async () => {
    await purgeSampleData();
    await prisma.$disconnect();
  });

  test('getSampleDataStatus returns false when no sample data exists', async () => {
    const status = await getSampleDataStatus();
    expect(status.hasSampleData).toBe(false);
    expect(status.counts.registry).toBe(0);
    expect(status.counts.guests).toBe(0);
    expect(status.counts.seating).toBe(0);
    expect(status.counts.weddingParty).toBe(0);
    expect(status.counts.attractions).toBe(0);
    expect(status.counts.faqs).toBe(0);
  });

  test('generateSampleData generates tagged records for classic archetype preset', async () => {
    const result = await generateSampleData({
      archetype: 'classic',
      modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'],
    });

    expect(result.success).toBe(true);
    expect(result.archetype).toBe('classic');
    expect(result.createdCounts.registry).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);
    expect(result.createdCounts.guests).toBe(ARCHETYPE_PRESETS.classic.guests.length);
    expect(result.createdCounts.seating).toBe(ARCHETYPE_PRESETS.classic.seatingTables.length);
    expect(result.createdCounts.weddingParty).toBe(ARCHETYPE_PRESETS.classic.weddingParty.length);
    expect(result.createdCounts.attractions).toBe(ARCHETYPE_PRESETS.classic.attractions.length);
    expect(result.createdCounts.faqs).toBe(ARCHETYPE_PRESETS.classic.faqs.length);

    const status = await getSampleDataStatus();
    expect(status.hasSampleData).toBe(true);
    expect(status.counts.registry).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);
    expect(status.counts.faqs).toBe(ARCHETYPE_PRESETS.classic.faqs.length);

    // Verify records are tagged with isSample = true
    const sampleItems = await prisma.registryItem.findMany({ where: { isSample: true } });
    expect(sampleItems.length).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);

    const sampleFaqs = await prisma.contentNode.findMany({ where: { type: 'FAQ' } });
    const taggedSampleFaqs = sampleFaqs.filter(
      (f) => (f.data as Record<string, unknown> | null)?.isSample === true
    );
    expect(taggedSampleFaqs.length).toBe(ARCHETYPE_PRESETS.classic.faqs.length);
  });

  test('generateSampleData generates destination archetype preset records', async () => {
    const result = await generateSampleData({
      archetype: 'destination',
      modules: ['registry', 'guests', 'seating'],
    });

    expect(result.success).toBe(true);
    expect(result.createdCounts.registry).toBe(ARCHETYPE_PRESETS.destination.registryItems.length);
    expect(result.createdCounts.guests).toBe(ARCHETYPE_PRESETS.destination.guests.length);
    expect(result.createdCounts.seating).toBe(ARCHETYPE_PRESETS.destination.seatingTables.length);
    expect(result.createdCounts.weddingParty).toBe(0);
    expect(result.createdCounts.attractions).toBe(0);
  });

  test('purgeSampleData deletes sample records while preserving non-sample records', async () => {
    // Create a real non-sample registry item and invitation code
    const realMedia = await prisma.media.create({
      data: {
        url: '/images/real-item.jpg',
        altText: 'Real Item',
        isSample: false,
      },
    });

    const realItem = await prisma.registryItem.create({
      data: {
        name: 'Real Custom Registry Item',
        description: 'User created item',
        category: 'Kitchen',
        price: 100,
        imageId: realMedia.id,
        isSample: false,
      },
    });

    await prisma.invitationCode.deleteMany({ where: { code: 'REALGUEST123' } });

    const realGuest = await prisma.invitationCode.create({
      data: {
        guestName: 'Real Guest',
        code: 'REALGUEST123',
        isSample: false,
      },
    });

    const realFaq = await prisma.contentNode.create({
      data: {
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'Real couple custom FAQ?',
          answer: 'Parking is complimentary at the north lot.',
          category: 'Venue',
          isVisible: true,
          isSample: false,
        },
      },
    });

    // Generate sample data
    await generateSampleData({
      archetype: 'romantic',
      modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'],
    });

    const statusBefore = await getSampleDataStatus();
    expect(statusBefore.hasSampleData).toBe(true);
    expect(statusBefore.counts.faqs).toBe(ARCHETYPE_PRESETS.romantic.faqs.length);

    // Purge sample data
    const purgeResult = await purgeSampleData();
    expect(purgeResult.success).toBe(true);

    const statusAfter = await getSampleDataStatus();
    expect(statusAfter.hasSampleData).toBe(false);
    expect(statusAfter.counts.faqs).toBe(0);

    // Verify non-sample records still exist intact
    const foundRealItem = await prisma.registryItem.findUnique({ where: { id: realItem.id } });
    expect(foundRealItem).not.toBeNull();
    expect(foundRealItem?.name).toBe('Real Custom Registry Item');

    const foundRealGuest = await prisma.invitationCode.findUnique({ where: { id: realGuest.id } });
    expect(foundRealGuest).not.toBeNull();
    expect(foundRealGuest?.guestName).toBe('Real Guest');

    const foundRealFaq = await prisma.contentNode.findUnique({ where: { id: realFaq.id } });
    expect(foundRealFaq).not.toBeNull();
    expect((foundRealFaq?.data as Record<string, unknown>)?.question).toBe('Real couple custom FAQ?');

    // Clean up test non-sample records
    await prisma.contentNode.delete({ where: { id: realFaq.id } });
    await prisma.registryItem.delete({ where: { id: realItem.id } });
    await prisma.invitationCode.delete({ where: { id: realGuest.id } });
    await prisma.media.delete({ where: { id: realMedia.id } });
  });

  test('generateSampleData seeds photos, sub-events, contributors, and media from shared builder and purges cleanly', async () => {
    const result = await generateSampleData({
      archetype: 'classic',
    });

    expect(result.success).toBe(true);
    expect(result.createdCounts.photos).toBe(ARCHETYPE_PRESETS.classic.photos.length);
    expect(result.createdCounts.subEvents).toBe(
      ARCHETYPE_PRESETS.classic.subEvents.length
    );

    const status = await getSampleDataStatus();
    expect(status.hasSampleData).toBe(true);
    expect(status.counts.photos).toBe(ARCHETYPE_PRESETS.classic.photos.length);
    expect(status.counts.subEvents).toBe(ARCHETYPE_PRESETS.classic.subEvents.length);

    const contributors = await prisma.contributor.findMany({
      where: { registryItem: { isSample: true } },
    });
    expect(contributors.length).toBeGreaterThan(0);

    const seededReception = await prisma.subEvent.findUnique({
      where: { id: 'sample-subevent-classic-reception' },
      include: { rsvps: true },
    });
    expect(seededReception).not.toBeNull();
    expect(Array.isArray(seededReception?.mealOptions)).toBe(true);
    expect((seededReception?.mealOptions as unknown[]).length).toBeGreaterThan(0);
    expect(seededReception?.rsvps.length).toBeGreaterThan(0);

    await purgeSampleData();

    const afterPurge = await getSampleDataStatus();
    expect(afterPurge.hasSampleData).toBe(false);
    expect(afterPurge.counts.photos).toBe(0);
    expect(afterPurge.counts.subEvents).toBe(0);

    const remainingSampleMedia = await prisma.media.count({
      where: { isSample: true },
    });
    expect(remainingSampleMedia).toBe(0);
  });
});
