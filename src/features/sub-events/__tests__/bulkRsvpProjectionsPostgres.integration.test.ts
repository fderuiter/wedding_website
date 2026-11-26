/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { Client, Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import { buildPostgresRuntimeConfig } from '@/lib/postgresPool';
import { SubEventService } from '../service';
import { SubEventAdminService } from '../admin.service';

interface RecordedWireStatement {
  sql: string;
}

async function captureWireStatements<T>(
  run: () => Promise<T>
): Promise<{ result: T; allStatements: RecordedWireStatement[]; dataStatements: RecordedWireStatement[]; elapsedMs: number }> {
  const allStatements: RecordedWireStatement[] = [];
  const originalClientQuery = Client.prototype.query;

  const querySpy = jest
    .spyOn(Client.prototype, 'query')
    .mockImplementation((function (this: Client, ...args: unknown[]) {
      const firstArg = args[0] as string | { text?: string } | undefined;
      const sqlText =
        typeof firstArg === 'string'
          ? firstArg
          : firstArg && typeof firstArg === 'object' && typeof firstArg.text === 'string'
            ? firstArg.text
            : '';

      if (sqlText.trim()) {
        allStatements.push({ sql: sqlText });
      }

      return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
    }) as typeof Client.prototype.query);

  const startedAt = performance.now();
  try {
    const result = await run();
    const elapsedMs = performance.now() - startedAt;
    const dataStatements = allStatements.filter((stmt) =>
      /^\s*(WITH\b|SELECT\b|INSERT\b|UPDATE\b|DELETE\b)/i.test(stmt.sql)
    );
    return { result, allStatements, dataStatements, elapsedMs };
  } finally {
    querySpy.mockRestore();
  }
}

function createFallbackClientWithoutRaw(prismaClient: PrismaClient) {
  const stripRawFromTx = (tx: any) => ({
    subEvent: tx.subEvent,
    subEventAccess: tx.subEventAccess,
    subEventRsvp: tx.subEventRsvp,
    invitationCode: tx.invitationCode,
    snapshotVersion: tx.snapshotVersion,
  });

  return {
    subEvent: prismaClient.subEvent,
    subEventAccess: prismaClient.subEventAccess,
    subEventRsvp: prismaClient.subEventRsvp,
    invitationCode: prismaClient.invitationCode,
    snapshotVersion: prismaClient.snapshotVersion,
    $transaction: (fnOrArray: any) => {
      if (typeof fnOrArray === 'function') {
        return prismaClient.$transaction(
          (tx) => fnOrArray(stripRawFromTx(tx)),
          { maxWait: 10_000, timeout: 30_000 }
        );
      }
      return prismaClient.$transaction(fnOrArray);
    },
  };
}

function normalizeInviteStateForParity(rows: any[]) {
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    guestName: row.guestName,
    used: row.used,
    hasUsedAt: Boolean(row.usedAt),
    plusOneAllocations: row.plusOneAllocations,
    plusOneFirstName: row.plusOneFirstName,
    plusOneLastName: row.plusOneLastName,
    dietaryNotes: row.dietaryNotes,
    extraFields: row.extraFields,
  }));
}

function normalizeRsvpStateForParity(rows: any[]) {
  return rows.map((row) => ({
    subEventId: row.subEventId,
    invitationCodeId: row.invitationCodeId,
    status: row.status,
    plusOneCount: row.plusOneCount,
    dietaryNotes: row.dietaryNotes,
    mealSelections: row.mealSelections,
    customAnswers: row.customAnswers,
    plusOneNames: row.plusOneNames,
  }));
}

function normalizeSnapshotStateForParity(rows: any[]) {
  return rows.map((row) => {
    const data = row.data && typeof row.data === 'object' ? { ...(row.data as Record<string, unknown>) } : {};
    delete data.updatedAt;
    delete data.createdAt;
    if ('usedAt' in data) {
      data.hasUsedAt = Boolean(data.usedAt);
      delete data.usedAt;
    }
    return {
      entityType: row.entityType,
      entityId: row.entityId,
      author: row.author,
      data,
    };
  });
}

describe('Bulk SubEvent RSVP & InvitationCode projection PostgreSQL wire-level integration', () => {
  let pool: Pool;
  let testPrisma: PrismaClient;

  beforeAll(() => {
    const { poolConfig, adapterOptions } = buildPostgresRuntimeConfig(env.DATABASE_URL);
    pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool, adapterOptions);
    testPrisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    // Let any deferred post-commit snapshot prune microtasks from prior tests settle
    await new Promise((resolve) => setTimeout(resolve, 25));
    await testPrisma.$transaction([
      testPrisma.snapshotVersion.deleteMany(),
      testPrisma.subEventRsvp.deleteMany(),
      testPrisma.subEventAccess.deleteMany(),
      testPrisma.subEvent.deleteMany(),
      testPrisma.broadcastRecipient.deleteMany(),
      testPrisma.contributor.deleteMany(),
      testPrisma.invitationCode.deleteMany(),
    ]);
  });

  it('executes <= 12 wire SQL statements and commits under 5,000 ms for 1,000-guest batch attendance overrides across 4 sub-events', async () => {
    await testPrisma.subEvent.createMany({
      data: [
        {
          id: 'se-welcome',
          title: 'Welcome Drinks',
          startTime: new Date('2026-09-18T18:00:00.000Z'),
          isPrivate: true,
          mealOptions: [],
          customQuestions: [],
        },
        {
          id: 'se-ceremony',
          title: 'Ceremony',
          startTime: new Date('2026-09-19T15:00:00.000Z'),
          isPrivate: false,
          mealOptions: [],
          customQuestions: [],
        },
        {
          id: 'se-reception',
          title: 'Reception Dinner',
          startTime: new Date('2026-09-19T18:00:00.000Z'),
          isPrivate: false,
          mealOptions: [
            { id: 'm-beef', label: 'Filet Mignon', description: '', dietaryTags: ['gluten-free'] },
            { id: 'm-veg', label: 'Wild Mushroom Risotto', description: '', dietaryTags: ['vegetarian'] },
          ],
          customQuestions: [
            { id: 'q-shuttle', prompt: 'Shuttle needed?', type: 'choice', required: false, options: ['Yes', 'No'] },
          ],
        },
        {
          id: 'se-brunch',
          title: 'Farewell Brunch',
          startTime: new Date('2026-09-20T10:00:00.000Z'),
          isPrivate: true,
          mealOptions: [],
          customQuestions: [],
        },
      ],
    });

    const inviteRows = Array.from({ length: 1000 }, (_, idx) => {
      const padded = String(idx + 1).padStart(4, '0');
      return {
        id: `inv-scale-${padded}`,
        code: `SCALE${padded}`,
        guestName: `Guest ${padded}`,
        dietaryNotes: idx % 10 === 0 ? 'Nut allergy' : null,
        plusOneAllocations: idx % 3 === 0 ? 1 : 0,
        extraFields: idx % 5 === 0 ? { tableNote: 'Window seat' } : {},
      };
    });
    await testPrisma.invitationCode.createMany({ data: inviteRows });

    // Seed prior responses for the first 250 guests (including companions, meal choices, and custom answers)
    await testPrisma.subEventRsvp.createMany({
      data: inviteRows.slice(0, 250).map((inv, idx) => ({
        id: `rsvp-prior-${idx + 1}`,
        subEventId: 'se-reception',
        invitationCodeId: inv.id,
        status: 'attending',
        plusOneCount: 1,
        plusOneNames: [`Companion ${idx + 1}`],
        mealSelections: ['m-beef', 'm-veg'],
        customAnswers: { 'q-shuttle': 'Yes' },
        dietaryNotes: idx % 2 === 0 ? 'Gluten-free' : '',
      })),
    });

    const allInviteIds = inviteRows.map((r) => r.id);
    const allEventIds = ['se-welcome', 'se-ceremony', 'se-reception', 'se-brunch'];
    const service = new SubEventService(testPrisma);

    // Warm up connection pool
    await testPrisma.$queryRaw`SELECT 1`;

    // 1. Mark all 1,000 guests attending across all 4 events (including 2 private events requiring bulk access grants)
    const attendingRun = await captureWireStatements(() =>
      service.adminBatchUpdateAttendance(
        {
          invitationCodeIds: allInviteIds,
          status: 'attending',
          subEventIds: allEventIds,
        },
        'AdminScaleTest'
      )
    );

    expect(attendingRun.elapsedMs).toBeLessThan(5000);
    expect(attendingRun.allStatements.length).toBeLessThanOrEqual(12);
    expect(attendingRun.dataStatements.length).toBeLessThanOrEqual(10);
    expect(attendingRun.result.updatedCount).toBe(1000);

    // Verify private access granted for all 1,000 guests across both private events (2,000 access rows)
    const accessCount = await testPrisma.subEventAccess.count();
    expect(accessCount).toBe(2000);

    // Verify existing companion counts, meal choices, and custom answers preserved on previously submitted responses
    const preservedGuest = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-scale-0001' },
    });
    const preservedExtra = preservedGuest.extraFields as Record<string, any>;
    expect(preservedGuest.used).toBe(true);
    expect(preservedExtra.attendanceStatus).toBe('attending');
    expect(preservedExtra.plusOneCount).toBe(1);
    expect(preservedExtra.tableNote).toBe('Window seat');
    expect(preservedExtra.mealSummary).toContain('Filet Mignon');
    expect(preservedExtra.customAnswersSummary).toContain('Shuttle needed?: Yes');

    // 1b. Mark all 1,000 guests pending across reception (preserves companion counts, meal choices, and custom answers on SubEventRsvp)
    await new Promise((resolve) => setTimeout(resolve, 25));
    const pendingRun = await captureWireStatements(() =>
      service.adminBatchUpdateAttendance(
        {
          invitationCodeIds: allInviteIds,
          status: 'pending',
          subEventIds: ['se-reception'],
        },
        'AdminScaleTest'
      )
    );
    expect(pendingRun.elapsedMs).toBeLessThan(5000);
    expect(pendingRun.allStatements.length).toBeLessThanOrEqual(12);
    const pendingReceptionRsvp = await testPrisma.subEventRsvp.findUniqueOrThrow({
      where: { id: 'rsvp-prior-1' },
    });
    expect(pendingReceptionRsvp.status).toBe('pending');
    expect(pendingReceptionRsvp.plusOneCount).toBe(1);
    expect(pendingReceptionRsvp.mealSelections).toEqual(['m-beef', 'm-veg']);
    expect(pendingReceptionRsvp.customAnswers).toEqual({ 'q-shuttle': 'Yes' });

    // 2. Decline all 1,000 guests across all 4 events (resets companions/meals/answers while keeping dietaryNotes)
    await new Promise((resolve) => setTimeout(resolve, 25));
    const declinedRun = await captureWireStatements(() =>
      service.adminBatchUpdateAttendance(
        {
          invitationCodeIds: allInviteIds,
          status: 'declined',
          subEventIds: allEventIds,
        },
        'AdminScaleTest'
      )
    );

    expect(declinedRun.elapsedMs).toBeLessThan(5000);
    expect(declinedRun.allStatements.length).toBeLessThanOrEqual(12);

    const declinedGuest = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-scale-0001' },
    });
    const declinedHouseholdNoteGuest = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-scale-0301' },
    });
    expect(declinedGuest.dietaryNotes).toBe('Gluten-free');
    expect(declinedHouseholdNoteGuest.dietaryNotes).toBe('Nut allergy');
    expect(declinedGuest.plusOneFirstName).toBeNull();
    expect((declinedGuest.extraFields as Record<string, any>).plusOneCount).toBe(0);
    expect((declinedGuest.extraFields as Record<string, any>).mealSelections).toEqual([]);
    expect((declinedGuest.extraFields as Record<string, any>).customAnswers).toEqual([]);

    // 3. Clear all 1,000 guests (deletes responses, resets flags, preserves dietaryNotes and custom guest fields)
    await new Promise((resolve) => setTimeout(resolve, 25));
    const clearRun = await captureWireStatements(() =>
      service.adminBatchUpdateAttendance(
        {
          invitationCodeIds: allInviteIds,
          status: 'clear',
        },
        'AdminScaleTest'
      )
    );

    expect(clearRun.elapsedMs).toBeLessThan(5000);
    expect(clearRun.allStatements.length).toBeLessThanOrEqual(12);
    expect(await testPrisma.subEventRsvp.count()).toBe(0);

    const clearedGuest = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-scale-0001' },
    });
    const clearedHouseholdNoteGuest = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-scale-0301' },
    });
    expect(clearedGuest.used).toBe(false);
    expect(clearedGuest.usedAt).toBeNull();
    expect(clearedGuest.dietaryNotes).toBe('Gluten-free');
    expect(clearedHouseholdNoteGuest.dietaryNotes).toBe('Nut allergy');
    expect(clearedGuest.extraFields).toEqual({ tableNote: 'Window seat' });
  }, 30_000);

  it('executes <= 10 wire SQL statements under 5,000 ms for SubEventAdminService.update choice renames and SubEventAdminService.delete across 750 RSVPs, while skipping RSVP/InvitationCode queries on metadata-only edits', async () => {
    const adminService = new SubEventAdminService();
    adminService.repo.client = testPrisma;

    const reception = await testPrisma.subEvent.create({
      data: {
        id: 'se-edit-reception',
        title: 'Grand Reception',
        description: 'Original description',
        startTime: new Date('2026-09-19T18:00:00.000Z'),
        endTime: new Date('2026-09-19T23:00:00.000Z'),
        locationName: 'Harbor Ballroom',
        location: '100 Waterfront Way',
        category: 'Reception',
        isPrivate: false,
        mealOptions: [
          { id: 'm-salmon', label: 'King Salmon', description: 'Herbs', dietaryTags: ['gluten-free'] },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: 'Shuttle route?',
            type: 'choice',
            required: true,
            options: ['Downtown 4:00 PM', 'Airport 4:15 PM', 'Driving myself'],
          },
        ],
      },
    });

    const afterParty = await testPrisma.subEvent.create({
      data: {
        id: 'se-after-party',
        title: 'Late Night Lounge',
        isPrivate: false,
        mealOptions: [],
        customQuestions: [],
      },
    });

    const invites = Array.from({ length: 750 }, (_, idx) => {
      const padded = String(idx + 1).padStart(4, '0');
      return {
        id: `inv-rsvp-${padded}`,
        code: `RSVP${padded}`,
        guestName: `Household ${padded}`,
        used: true,
        usedAt: new Date('2026-07-01T12:00:00.000Z'),
      };
    });
    await testPrisma.invitationCode.createMany({ data: invites });

    await testPrisma.subEventRsvp.createMany({
      data: invites.map((inv, idx) => ({
        id: `rsvp-rec-${idx + 1}`,
        subEventId: reception.id,
        invitationCodeId: inv.id,
        status: 'attending',
        plusOneCount: 0,
        mealSelections: ['m-salmon'],
        customAnswers: {
          'q-shuttle': idx % 2 === 0 ? 'Downtown 4:00 PM' : 'Driving myself',
        },
        dietaryNotes: '',
      })),
    });

    // Give first 100 households a second event RSVP so delete recalculates from remaining RSVPs
    await testPrisma.subEventRsvp.createMany({
      data: invites.slice(0, 100).map((inv, idx) => ({
        id: `rsvp-after-${idx + 1}`,
        subEventId: afterParty.id,
        invitationCodeId: inv.id,
        status: 'attending',
        plusOneCount: 1,
        plusOneNames: [`Partner ${idx + 1}`],
        mealSelections: [],
        customAnswers: {},
        dietaryNotes: 'Dairy-free',
      })),
    });

    await testPrisma.$queryRaw`SELECT 1`;

    // A. Metadata-only edit (mirroring SubEventEditorModal submitting unchanged title, mealOptions, customQuestions)
    const metadataEditRun = await captureWireStatements(() =>
      adminService.update(
        reception.id,
        {
          title: 'Grand Reception',
          description: 'Updated attire and parking notes',
          locationName: 'Grand Harbor Pavilion',
          location: '250 Waterfront Way',
          category: 'Main Event',
          startTime: '2026-09-19T18:30:00.000Z',
          endTime: '2026-09-19T23:30:00.000Z',
          isPrivate: true,
          mealOptions: [
            { id: 'm-salmon', label: 'King Salmon', description: 'Herbs', dietaryTags: ['gluten-free'] },
          ],
          customQuestions: [
            {
              id: 'q-shuttle',
              prompt: 'Shuttle route?',
              type: 'choice',
              required: true,
              options: ['Downtown 4:00 PM', 'Airport 4:15 PM', 'Driving myself'],
            },
          ],
        },
        'AdminMetadataEdit'
      )
    );

    const touchedRsvpOrInviteInMetadataEdit = metadataEditRun.dataStatements.some(
      (stmt) => stmt.sql.includes('"SubEventRsvp"') || stmt.sql.includes('"InvitationCode"')
    );
    expect(touchedRsvpOrInviteInMetadataEdit).toBe(false);
    expect(
      await testPrisma.snapshotVersion.count({ where: { entityType: 'InvitationCode' } })
    ).toBe(0);

    // B. Choice-rename update across 750 SubEventRsvp rows
    await new Promise((resolve) => setTimeout(resolve, 25));
    const choiceRenameRun = await captureWireStatements(() =>
      adminService.update(
        reception.id,
        {
          title: 'Grand Reception',
          mealOptions: [
            { id: 'm-salmon', label: 'Cedar Plank Salmon', description: 'Herbs', dietaryTags: ['gluten-free'] },
          ],
          customQuestions: [
            {
              id: 'q-shuttle',
              prompt: 'Shuttle route?',
              type: 'choice',
              required: true,
              options: ['Hotel Plaza 4:30 PM', 'Airport 4:15 PM', 'Driving myself'],
            },
          ],
          choiceRenames: {
            'q-shuttle': {
              'Downtown 4:00 PM': 'Hotel Plaza 4:30 PM',
            },
          },
        },
        'AdminChoiceRename'
      )
    );

    expect(choiceRenameRun.elapsedMs).toBeLessThan(5000);
    expect(choiceRenameRun.allStatements.length).toBeLessThanOrEqual(10);
    expect(choiceRenameRun.dataStatements.length).toBeLessThanOrEqual(8);

    const migratedRsvp = await testPrisma.subEventRsvp.findUniqueOrThrow({
      where: { id: 'rsvp-rec-1' },
    });
    expect(migratedRsvp.customAnswers).toEqual({ 'q-shuttle': 'Hotel Plaza 4:30 PM' });

    const syncedHousehold = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-rsvp-0001' },
    });
    expect((syncedHousehold.extraFields as Record<string, any>).customAnswersSummary).toBe(
      'Shuttle route?: Hotel Plaza 4:30 PM'
    );
    expect((syncedHousehold.extraFields as Record<string, any>).mealSummary).toContain(
      'Cedar Plank Salmon'
    );
    expect(
      await testPrisma.snapshotVersion.count({
        where: { entityType: 'InvitationCode', author: 'AdminChoiceRename' },
      })
    ).toBe(750);

    // C. Delete reception sub-event with 750 RSVPs (<= 10 wire SQL statements, recalculates remaining RSVPs)
    await new Promise((resolve) => setTimeout(resolve, 25));
    const deleteRun = await captureWireStatements(() =>
      adminService.delete(reception.id, 'AdminDeleteEvent')
    );

    expect(deleteRun.elapsedMs).toBeLessThan(5000);
    expect(deleteRun.allStatements.length).toBeLessThanOrEqual(10);
    expect(deleteRun.dataStatements.length).toBeLessThanOrEqual(8);

    // First 100 households retain attending status from afterParty RSVP; remaining 650 reset to unused
    const multiEventHousehold = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-rsvp-0001' },
    });
    expect(multiEventHousehold.used).toBe(true);
    expect(multiEventHousehold.dietaryNotes).toBe('Dairy-free');
    expect((multiEventHousehold.extraFields as Record<string, any>).attendanceStatus).toBe('attending');
    expect((multiEventHousehold.extraFields as Record<string, any>).eventRsvps).toEqual([
      {
        subEventId: afterParty.id,
        subEventTitle: 'Late Night Lounge',
        status: 'attending',
        plusOneCount: 1,
      },
    ]);

    const singleEventHousehold = await testPrisma.invitationCode.findUniqueOrThrow({
      where: { id: 'inv-rsvp-0200' },
    });
    expect(singleEventHousehold.used).toBe(false);
    expect(singleEventHousehold.usedAt).toBeNull();
    expect(singleEventHousehold.extraFields).toEqual({});
  }, 30_000);

  it('maintains exact database and return-value parity between $executeRaw path and mocked-client fallback path', async () => {
    const seedScenario = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await testPrisma.$transaction([
        testPrisma.snapshotVersion.deleteMany(),
        testPrisma.subEventRsvp.deleteMany(),
        testPrisma.subEventAccess.deleteMany(),
        testPrisma.subEvent.deleteMany(),
        testPrisma.invitationCode.deleteMany(),
      ]);

      await testPrisma.subEvent.createMany({
        data: [
          {
            id: 'se-parity-private',
            title: 'VIP Rehearsal',
            startTime: new Date('2026-09-18T18:00:00.000Z'),
            isPrivate: true,
            mealOptions: [{ id: 'm-1', label: 'Braised Short Rib', description: '', dietaryTags: [] }],
            customQuestions: [
              { id: 'q-1', prompt: 'Valet?', type: 'choice', required: false, options: ['Valet Yes', 'Valet No'] },
            ],
          },
          {
            id: 'se-parity-public',
            title: 'Wedding Ceremony',
            startTime: new Date('2026-09-19T16:00:00.000Z'),
            isPrivate: false,
            mealOptions: [],
            customQuestions: [],
          },
        ],
      });

      await testPrisma.invitationCode.createMany({
        data: [
          {
            id: 'inv-p-1',
            code: 'PAR001',
            guestName: 'Taylor Swift',
            used: true,
            usedAt: new Date('2026-05-10T00:00:00.000Z'),
            plusOneAllocations: 1,
            plusOneFirstName: 'Alex',
            plusOneLastName: 'Partner',
            dietaryNotes: 'No shellfish',
            extraFields: { customGuestTag: 'bridal-table' },
          },
          {
            id: 'inv-p-2',
            code: 'PAR002',
            guestName: 'Jordan Lee',
            used: false,
            usedAt: null,
            plusOneAllocations: 0,
            dietaryNotes: null,
            extraFields: {},
          },
          {
            id: 'inv-p-3',
            code: 'PAR003',
            guestName: 'Morgan Chen',
            used: true,
            usedAt: new Date('2026-05-12T00:00:00.000Z'),
            plusOneAllocations: 2,
            dietaryNotes: 'Vegan',
            extraFields: { note: 'VIP' },
          },
        ],
      });

      await testPrisma.subEventAccess.create({
        data: {
          id: 'acc-p-1',
          subEventId: 'se-parity-private',
          invitationCodeId: 'inv-p-1',
        },
      });

      await testPrisma.subEventRsvp.create({
        data: {
          id: 'rsvp-p-1',
          subEventId: 'se-parity-private',
          invitationCodeId: 'inv-p-1',
          status: 'pending',
          plusOneCount: 1,
          plusOneNames: ['Alex Partner'],
          mealSelections: ['m-1', 'm-1'],
          customAnswers: { 'q-1': 'Valet Yes' },
          dietaryNotes: 'Gluten-free',
        },
      });
    };

    const runWorkflow = async (useRawPath: boolean) => {
      await seedScenario();

      const client = useRawPath ? testPrisma : (createFallbackClientWithoutRaw(testPrisma) as any);
      const rsvpService = new SubEventService(client);
      const adminService = new SubEventAdminService();
      adminService.repo.client = client;

      // Step 1: Batch mark attending across both events (grants private access to inv-p-2 & inv-p-3, preserves inv-p-1 choices)
      const batchAttending = await rsvpService.adminBatchUpdateAttendance(
        {
          invitationCodeIds: ['inv-p-1', 'inv-p-2', 'inv-p-3'],
          status: 'attending',
          subEventIds: ['se-parity-private', 'se-parity-public'],
        },
        'ParityAuthor'
      );

      // Step 2:Batch mark inv-p-3 declined on public event only
      await rsvpService.adminBatchUpdateAttendance(
        {
          invitationCodeIds: ['inv-p-3'],
          status: 'declined',
          subEventIds: ['se-parity-public'],
        },
        'ParityAuthor'
      );

      // Step 3: Rename choice option + meal label on private event
      await adminService.update(
        'se-parity-private',
        {
          title: 'VIP Rehearsal Dinner',
          mealOptions: [{ id: 'm-1', label: 'Prime Short Rib', description: '', dietaryTags: ['dairy-free'] }],
          customQuestions: [
            { id: 'q-1', prompt: 'Valet?', type: 'choice', required: false, options: ['Complimentary Valet', 'Valet No'] },
          ],
          choiceRenames: {
            'q-1': { 'Valet Yes': 'Complimentary Valet' },
          },
        },
        'ParityAuthor'
      );

      // Step 4: Scoped clear of public event for inv-p-2
      await rsvpService.adminBatchUpdateAttendance(
        {
          invitationCodeIds: ['inv-p-2'],
          status: 'clear',
          subEventIds: ['se-parity-public'],
        },
        'ParityAuthor'
      );

      const [invites, rsvps, accesses, snapshots] = await Promise.all([
        testPrisma.invitationCode.findMany({ orderBy: { id: 'asc' } }),
        testPrisma.subEventRsvp.findMany({
          orderBy: [{ invitationCodeId: 'asc' }, { subEventId: 'asc' }],
        }),
        testPrisma.subEventAccess.findMany({
          orderBy: [{ invitationCodeId: 'asc' }, { subEventId: 'asc' }],
        }),
        testPrisma.snapshotVersion.findMany({
          orderBy: [{ createdAt: 'asc' }, { entityType: 'asc' }, { entityId: 'asc' }],
        }),
      ]);

      // Step 5: Delete private event and capture post-delete state too
      await adminService.delete('se-parity-private', 'ParityAuthor');
      const postDeleteInvites = await testPrisma.invitationCode.findMany({ orderBy: { id: 'asc' } });

      return {
        returnedRecords: normalizeInviteStateForParity(batchAttending.records),
        invites: normalizeInviteStateForParity(invites),
        rsvps: normalizeRsvpStateForParity(rsvps),
        accessPairs: accesses.map((a) => `${a.subEventId}:${a.invitationCodeId}`),
        snapshots: normalizeSnapshotStateForParity(snapshots),
        postDeleteInvites: normalizeInviteStateForParity(postDeleteInvites),
      };
    };

    const rawState = await runWorkflow(true);
    const fallbackState = await runWorkflow(false);

    expect(rawState.returnedRecords).toEqual(fallbackState.returnedRecords);
    expect(rawState.invites).toEqual(fallbackState.invites);
    expect(rawState.rsvps).toEqual(fallbackState.rsvps);
    expect(rawState.accessPairs).toEqual(fallbackState.accessPairs);
    expect(rawState.snapshots).toEqual(fallbackState.snapshots);
    expect(rawState.postDeleteInvites).toEqual(fallbackState.postDeleteInvites);
  }, 30_000);
});
