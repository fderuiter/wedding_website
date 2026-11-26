/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SubEventService } from '@/features/sub-events';
import { getAttendanceStatus } from '@/features/registry';
import { POST as submitPublicAddress } from '@/app/api/guest/address/public/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

describe('Relational Household Members & Per-Member RSVPs (DB Integration)', () => {
  const subEventService = new SubEventService();

  beforeEach(async () => {
    resetRateLimitsForTesting();
    await prisma.$transaction([
      prisma.subEventMemberRsvp.deleteMany(),
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.householdMember.deleteMany(),
      prisma.invitationCode.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.seatingTable.deleteMany(),
      prisma.appConfig.deleteMany(),
      prisma.snapshotVersion.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.subEventMemberRsvp.deleteMany(),
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.householdMember.deleteMany(),
      prisma.invitationCode.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.seatingTable.deleteMany(),
      prisma.appConfig.deleteMany(),
      prisma.snapshotVersion.deleteMany(),
    ]);
    await prisma.$disconnect();
  });

  it('idempotently backfills legacy InvitationCode and SubEventRsvp rows into HouseholdMember and SubEventMemberRsvp without data loss', async () => {
    const table = await prisma.seatingTable.create({
      data: {
        name: 'Table Orchid',
        capacity: 8,
      },
    });

    const subEvent = await prisma.subEvent.create({
      data: {
        title: 'Reception Dinner',
        location: 'Grand Ballroom',
        isPrivate: false,
        mealOptions: [
          { id: 'meal-halibut', label: 'Pan-Seared Halibut', dietaryTags: ['gluten-free'] },
          { id: 'meal-risotto', label: 'Wild Mushroom Risotto', dietaryTags: ['vegetarian'] },
        ],
      },
    });

    const inv = await prisma.invitationCode.create({
      data: {
        code: 'LEGACYHH',
        guestName: 'Clara Bennett',
        email: 'clara@example.com',
        dietaryNotes: 'Gluten-free',
        partyTags: ['family'],
        plusOneAllocations: 2,
        plusOneFirstName: 'Julian',
        plusOneLastName: 'Bennett',
        extraFields: {
          phone: '+1-555-0200',
          plusOneNames: ['Julian Bennett', 'Nora Bennett (Child)'],
        },
        tableId: table.id,
        seatNumber: 1,
        plusOneSeatNumbers: [2, 3],
        used: true,
      },
    });

    const rsvp = await prisma.subEventRsvp.create({
      data: {
        invitationCodeId: inv.id,
        subEventId: subEvent.id,
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'No walnuts',
        mealSelections: ['meal-halibut', 'meal-risotto', 'meal-halibut'],
        plusOneNames: ['Julian Bennett', 'Nora Bennett (Child)'],
      },
    });

    const migrationSqlPath = path.join(
      process.cwd(),
      'prisma/migrations/20261125000000_add_household_members_and_member_rsvps/migration.sql'
    );
    const fullSql = readFileSync(migrationSqlPath, 'utf8');
    const backfillIndex = fullSql.indexOf('-- Idempotent Backfill 1:');
    expect(backfillIndex).toBeGreaterThan(0);
    const backfillStatements = fullSql
      .slice(backfillIndex)
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Execute backfill twice to verify strict idempotency
    for (let pass = 0; pass < 2; pass += 1) {
      for (const stmt of backfillStatements) {
        await prisma.$executeRawUnsafe(`${stmt};`);
      }
    }

    const members = await prisma.householdMember.findMany({
      where: { invitationCodeId: inv.id },
      orderBy: [{ displayOrder: 'asc' }],
    });
    expect(members).toHaveLength(3);
    expect(members[0]).toMatchObject({
      fullName: 'Clara Bennett',
      firstName: 'Clara',
      lastName: 'Bennett',
      role: 'PRIMARY',
      email: 'clara@example.com',
      phone: '+1-555-0200',
      dietaryNotes: 'Gluten-free',
      seatNumber: 1,
      displayOrder: 0,
    });
    expect(members[1]).toMatchObject({
      fullName: 'Julian Bennett',
      firstName: 'Julian',
      lastName: 'Bennett',
      role: 'PARTNER',
      seatNumber: 2,
      displayOrder: 1,
    });
    expect(members[2]).toMatchObject({
      fullName: 'Nora Bennett (Child)',
      role: 'CHILD',
      tags: ['kids'],
      seatNumber: 3,
      displayOrder: 2,
    });

    const memberRsvps = await prisma.subEventMemberRsvp.findMany({
      where: { subEventRsvpId: rsvp.id },
      include: { householdMember: true },
      orderBy: [{ householdMember: { displayOrder: 'asc' } }],
    });
    expect(memberRsvps).toHaveLength(3);
    expect(memberRsvps.map((mr) => mr.status)).toEqual(['attending', 'attending', 'attending']);
    expect(memberRsvps.map((mr) => mr.mealOptionId)).toEqual([
      'meal-halibut',
      'meal-risotto',
      'meal-halibut',
    ]);
    expect(memberRsvps[0]?.dietaryNotes).toBe('No walnuts');
  });

  it('supports solo partner attendance when PRIMARY declines without erasing HouseholdMember profiles or companion names', async () => {
    await prisma.appConfig.create({
      data: {
        id: 'singleton',
        rsvpOpen: true,
      },
    });

    const subEvent = await prisma.subEvent.create({
      data: {
        title: 'Ceremony & Dinner',
        location: 'Garden Pavilion',
        isPrivate: false,
        mealOptions: [
          { id: 'meal-salmon', label: 'Roasted Salmon', dietaryTags: ['nut-free'] },
          { id: 'meal-pasta', label: 'Handmade Pasta', dietaryTags: ['vegetarian'] },
        ],
      },
    });

    const inv = await prisma.invitationCode.create({
      data: {
        code: 'SOLOPART',
        guestName: 'Hannah Park',
        householdName: 'Park Household',
        plusOneAllocations: 1,
        plusOneFirstName: 'David',
        plusOneLastName: 'Park',
        members: {
          create: [
            {
              fullName: 'Hannah Park',
              firstName: 'Hannah',
              lastName: 'Park',
              role: 'PRIMARY',
              displayOrder: 0,
              dietaryNotes: 'Dairy-free',
            },
            {
              fullName: 'David Park',
              firstName: 'David',
              lastName: 'Park',
              role: 'PARTNER',
              displayOrder: 1,
              email: 'david@example.com',
              dietaryNotes: 'Nut allergy',
            },
          ],
        },
      },
      include: { members: { orderBy: [{ displayOrder: 'asc' }] } },
    });

    const primaryMember = inv.members[0]!;
    const partnerMember = inv.members[1]!;

    await subEventService.submitSubEventRsvps(inv.code, [
      {
        subEventId: subEvent.id,
        plusOneCount: 0,
        dietaryNotes: '',
        memberRsvps: [
          {
            householdMemberId: primaryMember.id,
            status: 'declined',
            mealOptionId: null,
            dietaryNotes: null,
          },
          {
            householdMemberId: partnerMember.id,
            status: 'attending',
            mealOptionId: 'meal-salmon',
            dietaryNotes: 'Extra lemon, nut allergy',
          },
        ],
      },
    ]);

    const updatedInv = await prisma.invitationCode.findUniqueOrThrow({
      where: { id: inv.id },
      include: {
        members: { orderBy: [{ displayOrder: 'asc' }] },
        subEventRsvps: { include: { memberRsvps: true } },
      },
    });

    // Both HouseholdMember profiles AND companion scalar names are preserved intact
    expect(updatedInv.members).toHaveLength(2);
    expect(updatedInv.plusOneFirstName).toBe('David');
    expect(updatedInv.plusOneLastName).toBe('Park');
    expect(getAttendanceStatus(updatedInv as any)).toBe('attending');
    expect(updatedInv.subEventRsvps[0]?.status).toBe('attending');
    expect(updatedInv.subEventRsvps[0]?.plusOneCount).toBe(0);

    const summary = await subEventService.getRsvpSummary();
    const eventSummary = summary.subEvents.find((s) => s.subEventId === subEvent.id);
    expect(eventSummary).toBeDefined();
    expect(eventSummary?.attendingCount).toBe(1);
    expect(eventSummary?.attendingHeadcount).toBe(1);
    expect(eventSummary?.mealCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionId: 'meal-salmon', count: 1 }),
      ])
    );
  });

  it('persists PRIMARY, PARTNER, and CHILD HouseholdMember rows on public address collection', async () => {
    await prisma.appConfig.create({
      data: { id: 'singleton' },
    });

    const req = new NextRequest('http://localhost:3000/api/guest/address/public', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        guestName: 'Maya Lin',
        householdName: 'The Lin-Choi Family',
        email: 'maya@example.com',
        phone: '+1-555-0300',
        dietaryNotes: 'Pescatarian',
        partner: {
          fullName: 'Daniel Choi',
          email: 'daniel@example.com',
          phone: '+1-555-0301',
          dietaryNotes: 'No cilantro',
        },
        children: [
          {
            fullName: 'Theo Choi',
            dietaryNotes: 'Dairy allergy',
          },
          { fullName: 'Mina Choi' },
        ],
        addressLine1: '742 Evergreen Terrace',
        city: 'Portland',
        state: 'OR',
        zipCode: '97205',
        country: 'US',
      }),
    });

    const res = await submitPublicAddress(req);
    expect(res.status).toBe(200);

    const created = await prisma.invitationCode.findFirst({
      where: { email: 'maya@example.com' },
      include: { members: { orderBy: [{ displayOrder: 'asc' }] } },
    });

    expect(created).not.toBeNull();
    expect(created?.partyTags).toContain('address-collection');
    expect(created?.plusOneAllocations).toBe(3);
    expect(created?.members).toHaveLength(4);
    expect(created?.members.map((m) => `${m.role}:${m.fullName}`)).toEqual([
      'PRIMARY:Maya Lin',
      'PARTNER:Daniel Choi',
      'CHILD:Theo Choi',
      'CHILD:Mina Choi',
    ]);
    expect(created?.members[1]?.email).toBe('daniel@example.com');
    expect(created?.members[1]?.phone).toBe('+15550301');
    expect(created?.members[2]?.dietaryNotes).toBe('Dairy allergy');
  });
});
