/**
 * @jest-environment node
 */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateSampleData, purgeSampleData } from '@/lib/sampleData/generator';
import { signAdminToken } from '@/core/auth/auth.server';
import { GET } from '../onboarding-milestones/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import type { OnboardingMilestone } from '@/components/admin/OnboardingChecklist';

function clearReactTestCache(): void {
  const store = (globalThis as unknown as { globalFallbackStore?: Map<unknown, unknown> }).globalFallbackStore;
  store?.clear();
}

describe('GET /api/admin/onboarding-milestones (PostgreSQL integration)', () => {
  const createdMediaIds: string[] = [];
  const createdRegistryIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdTableIds: string[] = [];
  const createdFaqIds: string[] = [];

  async function makeAdminRequest() {
    const now = Date.now();
    const token = await signAdminToken({
      isAdmin: true,
      iat: now,
      exp: now + 60_000,
    });
    return new NextRequest('http://localhost/api/admin/onboarding-milestones', {
      method: 'GET',
      headers: {
        cookie: `admin_auth=${token}`,
      },
    });
  }

  beforeEach(async () => {
    resetRateLimitsForTesting();
    clearReactTestCache();
    await purgeSampleData();
    await prisma.contributor.deleteMany({});
    await prisma.registryItem.deleteMany({});
    await prisma.invitationCode.deleteMany({});
    await prisma.seatingTable.deleteMany({});
    await prisma.contentNode.deleteMany({ where: { type: 'FAQ' } });
  });

  afterAll(async () => {
    await purgeSampleData();
    if (createdFaqIds.length > 0) {
      await prisma.contentNode.deleteMany({ where: { id: { in: createdFaqIds } } });
    }
    if (createdRegistryIds.length > 0) {
      await prisma.registryItem.deleteMany({ where: { id: { in: createdRegistryIds } } });
    }
    if (createdInvitationIds.length > 0) {
      await prisma.invitationCode.deleteMany({ where: { id: { in: createdInvitationIds } } });
    }
    if (createdTableIds.length > 0) {
      await prisma.seatingTable.deleteMany({ where: { id: { in: createdTableIds } } });
    }
    if (createdMediaIds.length > 0) {
      await prisma.media.deleteMany({ where: { id: { in: createdMediaIds } } });
    }
    await prisma.$disconnect();
  });

  it('ignores sample records (isSample: true) and completes detection under 150ms', async () => {
    await prisma.appConfig.upsert({
      where: { id: 'global' },
      update: {
        partner1Name: 'Riley',
        partner2Name: 'Morgan',
        brideName: 'Riley',
        groomName: 'Morgan',
        baseUrl: 'https://rileymorgan.example.org',
        weddingDate: new Date('2027-09-18T16:00:00.000Z'),
        venueName: 'Conservatory Hall',
      },
      create: {
        id: 'global',
        partner1Name: 'Riley',
        partner2Name: 'Morgan',
        brideName: 'Riley',
        groomName: 'Morgan',
        baseUrl: 'https://rileymorgan.example.org',
        weddingDate: new Date('2027-09-18T16:00:00.000Z'),
        venueName: 'Conservatory Hall',
      },
    });

    // Populate sample data for all modules including starter FAQs
    await generateSampleData({
      archetype: 'classic',
      modules: ['registry', 'guests', 'seating', 'faqs'],
    });

    // Warm up connection pool once, then measure milestone detection latency
    await GET(await makeAdminRequest(), {});
    clearReactTestCache();

    const startMs = performance.now();
    const resWithOnlySample = await GET(await makeAdminRequest(), {});
    const elapsedMs = performance.now() - startMs;

    expect(resWithOnlySample.status).toBe(200);
    expect(elapsedMs).toBeLessThan(150);

    const sampleOnlyBody = await resWithOnlySample.json();
    expect(sampleOnlyBody.completedCount).toBe(1);
    expect(sampleOnlyBody.pendingCount).toBe(4);
    expect(sampleOnlyBody.allComplete).toBe(false);
    expect(sampleOnlyBody.milestones.find((m: OnboardingMilestone) => m.id === 'wedding-details')?.completed).toBe(true);
    expect(sampleOnlyBody.milestones.find((m: OnboardingMilestone) => m.id === 'guest-list')?.completed).toBe(false);
    expect(sampleOnlyBody.milestones.find((m: OnboardingMilestone) => m.id === 'registry')?.completed).toBe(false);
    expect(sampleOnlyBody.milestones.find((m: OnboardingMilestone) => m.id === 'seating-layout')?.completed).toBe(false);
    expect(sampleOnlyBody.milestones.find((m: OnboardingMilestone) => m.id === 'faq-setup')?.completed).toBe(false);

    // Add real non-sample records for guest list, registry, seating, and Wedding Q&A
    const media = await prisma.media.create({
      data: {
        url: '/images/custom-gift.jpg',
        altText: 'Custom Gift',
        isSample: false,
      },
    });
    createdMediaIds.push(media.id);

    const item = await prisma.registryItem.create({
      data: {
        name: 'Stand Mixer',
        description: 'Countertop mixer',
        category: 'Kitchen',
        price: 350,
        imageId: media.id,
        isSample: false,
      },
    });
    createdRegistryIds.push(item.id);

    const table = await prisma.seatingTable.create({
      data: {
        name: 'Table 1',
        capacity: 8,
        isSample: false,
      },
    });
    createdTableIds.push(table.id);

    const guest = await prisma.invitationCode.create({
      data: {
        code: 'REAL-MILESTONE-01',
        guestName: 'Casey Smith',
        tableId: table.id,
        isSample: false,
      },
    });
    createdInvitationIds.push(guest.id);

    const realFaq = await prisma.contentNode.create({
      data: {
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: 'What is the dress code?',
          answer: 'Cocktail attire.',
          category: 'Attire',
          isVisible: true,
        },
      },
    });
    createdFaqIds.push(realFaq.id);

    clearReactTestCache();
    const resAllReal = await GET(await makeAdminRequest(), {});
    const allRealBody = await resAllReal.json();

    expect(allRealBody.completedCount).toBe(5);
    expect(allRealBody.pendingCount).toBe(0);
    expect(allRealBody.allComplete).toBe(true);
    expect(allRealBody.milestones.every((m: OnboardingMilestone) => m.completed)).toBe(true);
  });
});
