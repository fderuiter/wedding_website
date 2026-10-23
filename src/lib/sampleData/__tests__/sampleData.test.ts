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
  });

  test('generateSampleData generates tagged records for classic archetype preset', async () => {
    const result = await generateSampleData({
      archetype: 'classic',
      modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions'],
    });

    expect(result.success).toBe(true);
    expect(result.archetype).toBe('classic');
    expect(result.createdCounts.registry).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);
    expect(result.createdCounts.guests).toBe(ARCHETYPE_PRESETS.classic.guests.length);
    expect(result.createdCounts.seating).toBe(ARCHETYPE_PRESETS.classic.seatingTables.length);
    expect(result.createdCounts.weddingParty).toBe(ARCHETYPE_PRESETS.classic.weddingParty.length);
    expect(result.createdCounts.attractions).toBe(ARCHETYPE_PRESETS.classic.attractions.length);

    const status = await getSampleDataStatus();
    expect(status.hasSampleData).toBe(true);
    expect(status.counts.registry).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);

    // Verify records are tagged with isSample = true
    const sampleItems = await prisma.registryItem.findMany({ where: { isSample: true } });
    expect(sampleItems.length).toBe(ARCHETYPE_PRESETS.classic.registryItems.length);
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

    // Generate sample data
    await generateSampleData({
      archetype: 'romantic',
      modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions'],
    });

    const statusBefore = await getSampleDataStatus();
    expect(statusBefore.hasSampleData).toBe(true);

    // Purge sample data
    const purgeResult = await purgeSampleData();
    expect(purgeResult.success).toBe(true);

    const statusAfter = await getSampleDataStatus();
    expect(statusAfter.hasSampleData).toBe(false);

    // Verify non-sample records still exist intact
    const foundRealItem = await prisma.registryItem.findUnique({ where: { id: realItem.id } });
    expect(foundRealItem).not.toBeNull();
    expect(foundRealItem?.name).toBe('Real Custom Registry Item');

    const foundRealGuest = await prisma.invitationCode.findUnique({ where: { id: realGuest.id } });
    expect(foundRealGuest).not.toBeNull();
    expect(foundRealGuest?.guestName).toBe('Real Guest');

    // Clean up test non-sample records
    await prisma.registryItem.delete({ where: { id: realItem.id } });
    await prisma.invitationCode.delete({ where: { id: realGuest.id } });
    await prisma.media.delete({ where: { id: realMedia.id } });
  });
});
