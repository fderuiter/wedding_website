/**
 * @jest-environment node
 */

import { InvitationCodeAdminService } from '../invitation-code.admin.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Unmock @prisma/client for this integration test file
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

describe('InvitationCodeAdminService Bulk SQL Update Integration', () => {
  let service: InvitationCodeAdminService;

  beforeAll(async () => {
    try {
      await realPrisma.invitationCode.findFirst();
    } catch {
      const { execSync } = await import('node:child_process');
      execSync('npx prisma db push', { stdio: 'pipe' });
    }
  });

  beforeEach(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.subEventRsvp.deleteMany();
    await realPrisma.subEventAccess.deleteMany();
    await realPrisma.subEvent.deleteMany();
    await realPrisma.contributor.deleteMany();
    await realPrisma.invitationCode.deleteMany();
    await realPrisma.seatingTable.deleteMany();

    service = new InvitationCodeAdminService();
    // Inject real PrismaClient
    service.repo.client = realPrisma;
  });

  afterAll(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.subEventRsvp.deleteMany();
    await realPrisma.subEventAccess.deleteMany();
    await realPrisma.subEvent.deleteMany();
    await realPrisma.contributor.deleteMany();
    await realPrisma.invitationCode.deleteMany();
    await realPrisma.seatingTable.deleteMany();
    await realPrisma.$disconnect();
    await pool.end();
  });

  it('updates records in bulk using parameterized executeRaw while preserving untouched fields', async () => {
    // Seed initial records
    const initialRecords = await Promise.all([
      realPrisma.invitationCode.create({
        data: {
          code: 'GUEST01',
          guestName: 'Original Guest 1',
          email: 'g1@example.com',
          city: 'Chicago',
          state: 'IL',
          plusOneAllocations: 1,
          partyTags: ['family'],
          extraFields: { dietary: 'gluten-free' },
        },
      }),
      realPrisma.invitationCode.create({
        data: {
          code: 'GUEST02',
          guestName: 'Original Guest 2',
          email: 'g2@example.com',
          city: 'New York',
          state: 'NY',
          plusOneAllocations: 0,
          partyTags: ['friends'],
          extraFields: { tablePreference: 'outdoors' },
        },
      }),
    ]);

    // Batch update:
    // GUEST01: updates guestName and city; leaves email, state, partyTags, extraFields untouched
    // GUEST02: updates guestName, sets email to null, sets partyTags to ['vip', 'wedding-party'], sets extraFields to { tablePreference: 'head-table' }
    // NEWGUEST: creates a new record
    const batchInput = [
      {
        guestName: 'Guest 1 Updated',
        code: 'GUEST01',
        city: 'Evanston',
      },
      {
        guestName: 'Guest 2 Updated',
        code: 'GUEST02',
        email: null,
        partyTags: ['vip', 'wedding-party'],
        extraFields: { tablePreference: 'head-table' },
      },
      {
        guestName: 'New Guest 3',
        code: 'GUEST03',
        email: 'g3@example.com',
      },
    ];

    const result = await service.importBatch(batchInput, 'update', 'TestAdmin');

    expect(result).toEqual({
      success: true,
      count: 3,
      imported: 1,
      skipped: 0,
      updated: 2,
    });

    // Verify database state for GUEST01
    const updated1 = await realPrisma.invitationCode.findUnique({
      where: { code: 'GUEST01' },
    });
    expect(updated1).not.toBeNull();
    expect(updated1!.guestName).toBe('Guest 1 Updated');
    expect(updated1!.city).toBe('Evanston');
    // Untouched fields must preserve original values
    expect(updated1!.email).toBe('g1@example.com');
    expect(updated1!.state).toBe('IL');
    expect(updated1!.plusOneAllocations).toBe(1);
    expect(updated1!.partyTags).toEqual(['family']);
    expect(updated1!.extraFields).toEqual({ dietary: 'gluten-free' });
    expect(updated1!.updatedAt.getTime()).toBeGreaterThanOrEqual(initialRecords[0].updatedAt.getTime());

    // Verify database state for GUEST02
    const updated2 = await realPrisma.invitationCode.findUnique({
      where: { code: 'GUEST02' },
    });
    expect(updated2).not.toBeNull();
    expect(updated2!.guestName).toBe('Guest 2 Updated');
    expect(updated2!.email).toBeNull(); // explicitly cleared
    expect(updated2!.city).toBe('New York'); // untouched
    expect(updated2!.state).toBe('NY'); // untouched
    expect(updated2!.partyTags).toEqual(['vip', 'wedding-party']);
    expect(updated2!.extraFields).toEqual({ tablePreference: 'head-table' });

    // Verify database state for GUEST03 (created)
    const created3 = await realPrisma.invitationCode.findUnique({
      where: { code: 'GUEST03' },
    });
    expect(created3).not.toBeNull();
    expect(created3!.guestName).toBe('New Guest 3');
    expect(created3!.email).toBe('g3@example.com');

    // Verify audit snapshot was created
    const snapshots = await realPrisma.snapshotVersion.findMany();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].entityType).toBe('InvitationCode');
    expect(snapshots[0].entityId).toBe('batch_import');
  });

  it('rolls back all changes when batch execution encounters an error', async () => {
    await realPrisma.invitationCode.create({
      data: {
        code: 'GUEST10',
        guestName: 'Stable Guest',
      },
    });

    // Mock tx.$executeRaw to fail inside transaction
    const originalExecuteInTransaction = realPrisma.$transaction.bind(realPrisma);
    jest.spyOn(realPrisma, '$transaction').mockImplementation(async (fn: any) => {
      return originalExecuteInTransaction(async (tx: any) => {
        // Intercept $executeRaw on the transaction client to simulate failure
        tx.$executeRaw = jest.fn().mockRejectedValue(new Error('Simulated executeRaw DB failure'));
        return fn(tx);
      });
    });

    const batchInput = [
      {
        guestName: 'Should Not Persist',
        code: 'GUEST10',
      },
    ];

    await expect(service.importBatch(batchInput, 'update')).rejects.toThrow('Simulated executeRaw DB failure');

    // Confirm that GUEST10 was not updated
    const record = await realPrisma.invitationCode.findUnique({
      where: { code: 'GUEST10' },
    });
    expect(record!.guestName).toBe('Stable Guest');

    // Confirm no audit snapshot was persisted
    const snapshots = await realPrisma.snapshotVersion.findMany();
    expect(snapshots.length).toBe(0);
  });

  it('updates guest profile and address in place while preserving seating assignments, redemption state, and event responses', async () => {
    const seatingTable = await realPrisma.seatingTable.create({
      data: { name: 'Head Table', capacity: 8 },
    });

    const subEvent = await realPrisma.subEvent.create({
      data: {
        title: 'Rehearsal Dinner',
        isPrivate: true,
        startTime: new Date('2026-09-18T18:00:00.000Z'),
        endTime: new Date('2026-09-18T21:00:00.000Z'),
      },
    });

    const usedTimestamp = new Date('2026-05-01T12:30:00.000Z');
    const guest = await realPrisma.invitationCode.create({
      data: {
        code: 'ORIG100',
        guestName: 'Original Guest',
        email: 'orig@example.com',
        householdName: 'Original Household',
        partyGroup: 'Bridal Party',
        partyTags: ['VIP'],
        plusOneAllocations: 1,
        plusOneFirstName: 'Jordan',
        plusOneLastName: 'Original',
        dietaryNotes: 'Vegetarian',
        addressLine1: '100 Old Rd',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60601',
        country: 'USA',
        used: true,
        usedAt: usedTimestamp,
        tableId: seatingTable.id,
        seatNumber: 4,
        extraFields: { attendanceStatus: 'attending', mealChoice: 'pasta' },
      },
    });

    await realPrisma.subEventAccess.create({
      data: {
        subEventId: subEvent.id,
        invitationCodeId: guest.id,
      },
    });

    await realPrisma.subEventRsvp.create({
      data: {
        subEventId: subEvent.id,
        invitationCodeId: guest.id,
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Vegetarian',
      },
    });

    await realPrisma.contributor.create({
      data: {
        name: 'Original Guest',
        amount: 150,
        invitationCodeId: guest.id,
      },
    });

    await service.update(
      guest.id,
      {
        guestName: 'Edited Guest Name',
        code: 'newcode200',
        email: 'edited@example.com',
        householdName: '',
        partyGroup: 'Family',
        partyTags: ['VIP', 'Family'],
        plusOneAllocations: 2,
        plusOneFirstName: 'Taylor',
        plusOneLastName: 'Edited',
        dietaryNotes: 'Gluten-Free',
        addressLine1: '742 Evergreen Terrace',
        addressLine2: 'Suite 2',
        city: 'Springfield',
        state: 'OR',
        zipCode: '97477',
        country: 'USA',
      },
      'TestAdmin'
    );

    const reloaded = await realPrisma.invitationCode.findUnique({
      where: { id: guest.id },
      include: {
        subEventAccesses: true,
        subEventRsvps: true,
        contributors: true,
      },
    });

    expect(reloaded).not.toBeNull();
    expect(reloaded!.guestName).toBe('Edited Guest Name');
    expect(reloaded!.code).toBe('NEWCODE200');
    expect(reloaded!.email).toBe('edited@example.com');
    expect(reloaded!.householdName).toBeNull();
    expect(reloaded!.partyGroup).toBe('Family');
    expect(reloaded!.partyTags).toEqual(['VIP', 'Family']);
    expect(reloaded!.plusOneAllocations).toBe(2);
    expect(reloaded!.plusOneFirstName).toBe('Taylor');
    expect(reloaded!.plusOneLastName).toBe('Edited');
    expect(reloaded!.dietaryNotes).toBe('Gluten-Free');
    expect(reloaded!.addressLine1).toBe('742 Evergreen Terrace');
    expect(reloaded!.addressLine2).toBe('Suite 2');
    expect(reloaded!.city).toBe('Springfield');
    expect(reloaded!.state).toBe('OR');
    expect(reloaded!.zipCode).toBe('97477');
    expect(reloaded!.country).toBe('USA');

    // Preserved seating, redemption, extraFields, and related records
    expect(reloaded!.tableId).toBe(seatingTable.id);
    expect(reloaded!.seatNumber).toBe(4);
    expect(reloaded!.used).toBe(true);
    expect(reloaded!.usedAt?.toISOString()).toBe(usedTimestamp.toISOString());
    expect(reloaded!.extraFields).toEqual({ attendanceStatus: 'attending', mealChoice: 'pasta' });
    expect(reloaded!.subEventAccesses).toHaveLength(1);
    expect(reloaded!.subEventAccesses[0].subEventId).toBe(subEvent.id);
    expect(reloaded!.subEventRsvps).toHaveLength(1);
    expect(reloaded!.subEventRsvps[0].status).toBe('attending');
    expect(reloaded!.subEventRsvps[0].plusOneCount).toBe(1);
    expect(reloaded!.contributors).toHaveLength(1);
    expect(reloaded!.contributors[0].amount).toBe(150);
  });

  describe('batchUpdateTags SQL Integration', () => {
    const cleanPrisma = new PrismaClient({ adapter });

    beforeEach(() => {
      service.repo.client = cleanPrisma;
    });

    afterAll(async () => {
      await cleanPrisma.$disconnect();
      const { prisma } = await import('@/lib/prisma');
      await prisma.$disconnect();
    });

    it('updates partyTags across 120 guests in one SQL UPDATE while preserving other columns and writing per-guest snapshots', async () => {
      const seedData = Array.from({ length: 120 }, (_, i) => {
        const idx = String(i + 1).padStart(3, '0');
        return {
          code: `BULKTAG${idx}`,
          guestName: `Bulk Guest ${idx}`,
          email: `guest${idx}@example.com`,
          city: 'Seattle',
          used: i % 3 === 0,
          partyTags: i % 2 === 0 ? ['Family'] : ['Friends'],
          extraFields: { seatNote: `note-${idx}` },
        };
      });
      await cleanPrisma.invitationCode.createMany({ data: seedData });

      const seededRows = await cleanPrisma.invitationCode.findMany({
        orderBy: { code: 'asc' },
      });
      expect(seededRows).toHaveLength(120);
      const allIds = seededRows.map((r: { id: string }) => r.id);

      let executeRawCalls = 0;
      service.repo.client = new Proxy(cleanPrisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return (fn: any, options?: any) =>
              target.$transaction((tx: any) => {
                const wrappedTx = new Proxy(tx, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === '$executeRaw') {
                      return (...args: any[]) => {
                        executeRawCalls++;
                        return txTarget.$executeRaw(...args);
                      };
                    }
                    return Reflect.get(txTarget, txProp, txReceiver);
                  },
                });
                return fn(wrappedTx);
              }, options);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const updatedAdd = await service.batchUpdateTags(
        [...allIds, allIds[0]],
        [' VIP ', 'Rehearsal', 'VIP'],
        'add',
        'TagAdmin'
      );

      expect(executeRawCalls).toBe(1);
      expect(updatedAdd).toHaveLength(120);

      const reloadedAfterAdd = await cleanPrisma.invitationCode.findMany({
        orderBy: { code: 'asc' },
      });
      expect(reloadedAfterAdd[0].partyTags).toEqual(['Family', 'VIP', 'Rehearsal']);
      expect(reloadedAfterAdd[1].partyTags).toEqual(['Friends', 'VIP', 'Rehearsal']);
      expect(reloadedAfterAdd[0].email).toBe('guest001@example.com');
      expect(reloadedAfterAdd[0].city).toBe('Seattle');
      expect(reloadedAfterAdd[0].used).toBe(true);
      expect(reloadedAfterAdd[0].extraFields).toEqual({ seatNote: 'note-001' });

      const snapshotsAfterAdd = await cleanPrisma.snapshotVersion.findMany({
        where: { entityType: 'InvitationCode' },
      });
      expect(snapshotsAfterAdd).toHaveLength(120);
      expect(
        snapshotsAfterAdd.every((s: { entityId: string }) => s.entityId !== 'batch_update_tags')
      ).toBe(true);

      // Remove a tag across all 120 guests in a single SQL UPDATE
      executeRawCalls = 0;
      await service.batchUpdateTags(allIds, ['Rehearsal'], 'remove', 'TagAdmin');
      expect(executeRawCalls).toBe(1);

      const sampleAfterRemove = await cleanPrisma.invitationCode.findUnique({
        where: { code: 'BULKTAG001' },
      });
      expect(sampleAfterRemove!.partyTags).toEqual(['Family', 'VIP']);

      // Replace with empty array to clear tags on first 10 guests
      executeRawCalls = 0;
      await service.batchUpdateTags(allIds.slice(0, 10), [], 'replace', 'TagAdmin');
      expect(executeRawCalls).toBe(1);

      const clearedSample = await cleanPrisma.invitationCode.findUnique({
        where: { code: 'BULKTAG001' },
      });
      const untouchedSample = await cleanPrisma.invitationCode.findUnique({
        where: { code: 'BULKTAG011' },
      });
      expect(clearedSample!.partyTags).toEqual([]);
      expect(untouchedSample!.partyTags).toEqual(['Family', 'VIP']);
    });

    it('returns empty array and skips SQL UPDATE and snapshots when zero rows match', async () => {
      let executeRawCalls = 0;
      service.repo.client = new Proxy(cleanPrisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return (fn: any, options?: any) =>
              target.$transaction((tx: any) => {
                const wrappedTx = new Proxy(tx, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === '$executeRaw') {
                      return (...args: any[]) => {
                        executeRawCalls++;
                        return txTarget.$executeRaw(...args);
                      };
                    }
                    return Reflect.get(txTarget, txProp, txReceiver);
                  },
                });
                return fn(wrappedTx);
              }, options);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const result = await service.batchUpdateTags(
        ['non-existent-id-1', 'non-existent-id-2'],
        ['VIP'],
        'add',
        'TagAdmin'
      );

      expect(result).toEqual([]);
      expect(executeRawCalls).toBe(0);
      const snapshots = await cleanPrisma.snapshotVersion.findMany();
      expect(snapshots).toHaveLength(0);
    });

    it('rolls back tag updates when snapshot persistence fails inside transaction', async () => {
      const guest = await cleanPrisma.invitationCode.create({
        data: {
          code: 'ROLLBACKTAG1',
          guestName: 'Rollback Guest',
          partyTags: ['Original'],
        },
      });

      service.repo.client = new Proxy(cleanPrisma, {
        get(target, prop, receiver) {
          if (prop === '$transaction') {
            return (fn: any, options?: any) =>
              target.$transaction((tx: any) => {
                const wrappedTx = new Proxy(tx, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === 'snapshotVersion') {
                      return {
                        ...txTarget.snapshotVersion,
                        createMany: jest
                          .fn()
                          .mockRejectedValue(new Error('Simulated snapshot failure')),
                      };
                    }
                    return Reflect.get(txTarget, txProp, txReceiver);
                  },
                });
                return fn(wrappedTx);
              }, options);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      await expect(
        service.batchUpdateTags([guest.id], ['VIP'], 'add', 'TagAdmin')
      ).rejects.toThrow('Simulated snapshot failure');

      const reloaded = await cleanPrisma.invitationCode.findUnique({
        where: { id: guest.id },
      });
      expect(reloaded!.partyTags).toEqual(['Original']);

      const snapshots = await cleanPrisma.snapshotVersion.findMany();
      expect(snapshots).toHaveLength(0);
    });
  });
});
