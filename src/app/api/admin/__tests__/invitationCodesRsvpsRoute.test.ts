/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET, PUT } from '../invitation-codes/rsvps/route';
import { POST as publicRsvpPost } from '../../rsvp/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getAttendanceStatus } from '@/features/registry';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  GUEST_INVITE_COOKIE: 'guest_invite_session',
  getGuestInviteSession: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<
  typeof getGuestInviteSession
>;

describe('GET & PUT /api/admin/invitation-codes/rsvps', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetGuestInviteSession.mockResolvedValue(null);
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
      prisma.appConfig.deleteMany(),
      prisma.snapshotVersion.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
      prisma.appConfig.deleteMany(),
      prisma.snapshotVersion.deleteMany(),
    ]);
    await prisma.$disconnect();
  });

  it('enforces admin authentication on GET and PUT', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const getRes = await GET(
      new NextRequest('http://localhost/api/admin/invitation-codes/rsvps?invitationCodeId=inv-1')
    );
    expect(getRes.status).toBe(401);

    const putRes = await PUT(
      new NextRequest('http://localhost/api/admin/invitation-codes/rsvps', {
        method: 'PUT',
        body: JSON.stringify({ invitationCodeId: 'inv-1', clearAll: true }),
      })
    );
    expect(putRes.status).toBe(401);
  });

  it('allows admin RSVP override past closed public deadline without guest cookie, syncs InvitationCode.extraFields, creates SnapshotVersion, and keeps POST /api/rsvp blocked', async () => {
    // Configure closed public RSVP deadline in the past
    await prisma.appConfig.create({
      data: {
        id: 'global',
        rsvpOpen: false,
        rsvpDeadlineDate: '2020-01-01T00:00:00.000Z',
        rsvpGracePeriodHours: 0,
      },
    });

    const reception = await prisma.subEvent.create({
      data: {
        title: 'Reception Dinner',
        isPrivate: false,
        mealOptions: [
          { id: 'meal-halibut', label: 'Pan-Seared Halibut', dietaryTags: ['gluten-free'] },
          { id: 'meal-kids', label: 'Kids Pasta', dietaryTags: ['kids'] },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: 'Shuttle needed?',
            type: 'choice',
            required: true,
            options: ['Yes', 'No'],
          },
        ],
      },
    });

    const guest = await prisma.invitationCode.create({
      data: {
        id: 'inv-late-1',
        code: 'LATE001',
        guestName: 'Nora Latecomer',
        plusOneAllocations: 1,
        used: false,
      },
    });

    // 1a. Verify public POST /api/rsvp rejects requests without guest session cookie (401)
    const unauthPublicRes = await publicRsvpPost(
      new NextRequest('http://localhost/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subEventId: reception.id,
          status: 'attending',
          plusOneCount: 1,
        }),
      })
    );
    expect(unauthPublicRes.status).toBe(401);

    // 1b. Verify public POST /api/rsvp still enforces closed deadline for logged-in guests (403)
    mockGetGuestInviteSession.mockResolvedValueOnce({
      invitationCodeId: guest.id,
      code: guest.code,
      guestName: guest.guestName,
    } as any);
    const publicRes = await publicRsvpPost(
      new NextRequest('http://localhost/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subEventId: reception.id,
          status: 'attending',
          plusOneCount: 1,
        }),
      })
    );
    expect(publicRes.status).toBe(403);

    // 2. Admin PUT override succeeds without any guest session cookie despite closed deadline
    const putRes = await PUT(
      new NextRequest('http://localhost/api/admin/invitation-codes/rsvps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: guest.id,
          rsvps: [
            {
              subEventId: reception.id,
              status: 'attending',
              plusOneCount: 1,
              plusOneNames: ['Owen Partner'],
              dietaryNotes: 'No shellfish',
              mealSelections: ['meal-halibut', 'meal-kids'],
              customAnswers: {
                'q-shuttle': 'Yes',
              },
            },
          ],
        }),
      })
    );

    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.success).toBe(true);
    expect(putBody.data.invitationCode.used).toBe(true);
    expect(putBody.data.rsvps).toEqual([
      expect.objectContaining({
        subEventId: reception.id,
        status: 'attending',
        plusOneCount: 1,
        plusOneNames: ['Owen Partner'],
        mealSelections: ['meal-halibut', 'meal-kids'],
      }),
    ]);

    // Verify InvitationCode synced fields
    const updatedGuest = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(updatedGuest.used).toBe(true);
    expect(updatedGuest.plusOneFirstName).toBe('Owen');
    expect(updatedGuest.plusOneLastName).toBe('Partner');
    expect(updatedGuest.dietaryNotes).toContain('No shellfish');
    const extra = updatedGuest.extraFields as Record<string, unknown>;
    expect(extra.attendanceStatus).toBe('attending');
    expect(extra.mealSummary).toContain('Pan-Seared Halibut');
    expect(extra.customAnswersSummary).toContain('Shuttle needed?: Yes');
    expect(extra.dietaryTags).toEqual(expect.arrayContaining(['gluten-free', 'kids']));

    // Verify SnapshotVersion audit row created
    const snapshots = await prisma.snapshotVersion.findMany({
      where: { entityType: 'InvitationCode', entityId: guest.id },
    });
    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    // 3. GET detail returns saved RSVP, meal selections, and custom answers
    const getRes = await GET(
      new NextRequest(
        `http://localhost/api/admin/invitation-codes/rsvps?invitationCodeId=${guest.id}`
      )
    );
    expect(getRes.status).toBe(200);
    const getDetail = (await getRes.json()).data;
    expect(getDetail.rsvps[0]).toEqual(
      expect.objectContaining({
        subEventId: reception.id,
        status: 'attending',
        plusOneCount: 1,
        mealSelections: ['meal-halibut', 'meal-kids'],
        customAnswers: { 'q-shuttle': 'Yes' },
      })
    );

    // 4. Clear RSVPs resets guest back to pending and deletes SubEventRsvp rows
    const clearRes = await PUT(
      new NextRequest('http://localhost/api/admin/invitation-codes/rsvps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeId: guest.id,
          clearAll: true,
        }),
      })
    );
    expect(clearRes.status).toBe(200);
    expect(await prisma.subEventRsvp.count({ where: { invitationCodeId: guest.id } })).toBe(0);

    const clearedGuest = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: guest.id },
    });
    expect(clearedGuest.used).toBe(false);
    expect(getAttendanceStatus(clearedGuest as any)).toBe('pending');
    expect((clearedGuest.extraFields as Record<string, unknown>)?.attendanceStatus).toBeUndefined();
  });

  it('supports batch attendance overrides and records SnapshotVersion audit snapshots', async () => {
    const ceremony = await prisma.subEvent.create({
      data: { title: 'Ceremony', isPrivate: false },
    });
    const g1 = await prisma.invitationCode.create({
      data: { id: 'inv-batch-1', code: 'BAT001', guestName: 'Batch One', used: false },
    });
    const g2 = await prisma.invitationCode.create({
      data: { id: 'inv-batch-2', code: 'BAT002', guestName: 'Batch Two', used: false },
    });

    const batchRes = await PUT(
      new NextRequest('http://localhost/api/admin/invitation-codes/rsvps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitationCodeIds: [g1.id, g2.id],
          status: 'declined',
        }),
      })
    );

    expect(batchRes.status).toBe(200);
    const batchBody = await batchRes.json();
    expect(batchBody.data.updatedCount).toBe(2);
    expect(batchBody.data.records).toHaveLength(2);

    const rsvps = await prisma.subEventRsvp.findMany({
      where: { subEventId: ceremony.id },
    });
    expect(rsvps).toHaveLength(2);
    expect(rsvps.every((r) => r.status === 'declined')).toBe(true);

    const snapshots = await prisma.snapshotVersion.findMany({
      where: { entityType: 'InvitationCode', entityId: { in: [g1.id, g2.id] } },
    });
    expect(snapshots).toHaveLength(2);
  });
});
