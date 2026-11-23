/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '../sub-events/rsvp-summary/route';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('GET /api/admin/sub-events/rsvp-summary', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
    ]);
    await prisma.$disconnect();
  });

  it('returns 401 when request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/sub-events/rsvp-summary');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('aggregates global & per-event headcounts, skips declined rows in catering/meal totals, counts kids tags, and breaks down custom questions', async () => {
    const reception = await prisma.subEvent.create({
      data: {
        title: 'Reception Dinner',
        isPrivate: false,
        mealOptions: [
          { id: 'meal-salmon', label: 'Herb Salmon', dietaryTags: ['gluten-free'] },
          { id: 'meal-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
          { id: 'meal-steak', label: 'Filet Mignon', dietaryTags: [] },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: 'Need hotel shuttle?',
            type: 'choice',
            required: true,
            options: ['Yes', 'No'],
          },
          {
            id: 'q-song',
            prompt: 'Song request',
            type: 'text',
            required: false,
            options: [],
          },
        ],
      },
    });

    const rehearsal = await prisma.subEvent.create({
      data: {
        title: 'Rehearsal Dinner',
        isPrivate: true,
      },
    });

    // Guest 1: Attending Reception (+2 plus-ones = 3 headcount) & Private Rehearsal (+1 = 2 headcount)
    const guest1 = await prisma.invitationCode.create({
      data: {
        id: 'inv-sum-1',
        code: 'SUM001',
        guestName: 'Alice Anderson',
        plusOneAllocations: 2,
        dietaryNotes: 'Gluten-free',
        used: true,
        extraFields: {
          attendanceStatus: 'attending',
          dietaryTags: ['gluten-free', 'kids'],
        },
      },
    });

    // Guest 2: Declined everywhere (has Vegan note and stale meal selection that MUST be skipped)
    const guest2 = await prisma.invitationCode.create({
      data: {
        id: 'inv-sum-2',
        code: 'SUM002',
        guestName: 'Bob Declined',
        dietaryNotes: 'Vegan, Nut allergy',
        used: true,
        extraFields: {
          attendanceStatus: 'declined',
          dietaryTags: ['vegan', 'nut-free'],
        },
      },
    });

    // Guest 3: Pending everywhere (invited to Public Reception, NOT granted Private Rehearsal)
    await prisma.invitationCode.create({
      data: {
        id: 'inv-sum-3',
        code: 'SUM003',
        guestName: 'Clara Pending',
        dietaryNotes: 'Vegetarian',
        used: false,
      },
    });

    await prisma.subEventAccess.create({
      data: {
        subEventId: rehearsal.id,
        invitationCodeId: guest1.id,
      },
    });

    await prisma.subEventRsvp.create({
      data: {
        subEventId: reception.id,
        invitationCodeId: guest1.id,
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'Gluten-free',
        mealSelections: ['meal-salmon', 'meal-steak', 'meal-kids'],
        customAnswers: {
          'q-shuttle': 'Yes',
          'q-song': 'September',
        },
      },
    });

    await prisma.subEventRsvp.create({
      data: {
        subEventId: rehearsal.id,
        invitationCodeId: guest1.id,
        status: 'attending',
        plusOneCount: 1,
      },
    });

    await prisma.subEventRsvp.create({
      data: {
        subEventId: reception.id,
        invitationCodeId: guest2.id,
        status: 'declined',
        plusOneCount: 0,
        mealSelections: ['meal-steak'],
        customAnswers: { 'q-shuttle': 'No' },
      },
    });

    const req = new NextRequest('http://localhost/api/admin/sub-events/rsvp-summary');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload.success).toBe(true);
    const summary = payload.data;

    // Global headcounts & households
    expect(summary.global).toEqual(
      expect.objectContaining({
        totalInvitations: 3,
        attendingHouseholds: 1,
        declinedHouseholds: 1,
        pendingHouseholds: 1,
        attendingHeadcount: 3, // Alice + 2 plus-ones
        attendingPlusOnes: 2,
        declinedHeadcount: 1,
        pendingHeadcount: 1,
      })
    );

    // Declined Bob's Vegan & Nut allergy notes MUST be excluded; Alice (GF + kids) and Clara (Vegetarian) counted
    expect(summary.global.dietary).toEqual(
      expect.objectContaining({
        totalWithRestrictions: 2,
        glutenFree: 1,
        vegetarian: 1,
        vegan: 0,
        nutFree: 0,
        kids: 1,
      })
    );

    // Meal totals skip declined Bob's meal-steak and count Alice's 3 selections
    expect(summary.global.mealTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionId: 'meal-salmon', label: 'Herb Salmon', count: 1 }),
        expect.objectContaining({ optionId: 'meal-steak', label: 'Filet Mignon', count: 1 }),
        expect.objectContaining({ optionId: 'meal-kids', label: 'Kids Chicken Tenders', count: 1 }),
      ])
    );

    // Per-sub-event summaries
    const receptionSummary = summary.subEvents.find(
      (s: { subEventId: string }) => s.subEventId === reception.id
    );
    expect(receptionSummary).toEqual(
      expect.objectContaining({
        invitedCount: 3,
        attendingCount: 1,
        attendingHeadcount: 3,
        attendingPlusOnes: 2,
        declinedCount: 1,
        pendingCount: 1,
        kidsCount: 1,
      })
    );

    const rehearsalSummary = summary.subEvents.find(
      (s: { subEventId: string }) => s.subEventId === rehearsal.id
    );
    expect(rehearsalSummary).toEqual(
      expect.objectContaining({
        invitedCount: 1,
        attendingCount: 1,
        attendingHeadcount: 2,
        attendingPlusOnes: 1,
        declinedCount: 0,
        pendingCount: 0,
      })
    );

    // Custom question breakdowns (declined Bob's 'No' skipped)
    const shuttleBreakdown = summary.global.questionBreakdowns.find(
      (q: { questionId: string }) => q.questionId === 'q-shuttle'
    );
    expect(shuttleBreakdown).toEqual(
      expect.objectContaining({
        optionCounts: [
          { option: 'Yes', count: 1 },
          { option: 'No', count: 0 },
        ],
        totalResponses: 1,
      })
    );
    const songBreakdown = summary.global.questionBreakdowns.find(
      (q: { questionId: string }) => q.questionId === 'q-song'
    );
    expect(songBreakdown).toEqual(
      expect.objectContaining({
        totalResponses: 1,
        textResponses: [
          expect.objectContaining({
            invitationCodeId: 'inv-sum-1',
            guestName: 'Alice Anderson',
            answer: 'September',
          }),
        ],
      })
    );
  });
});
