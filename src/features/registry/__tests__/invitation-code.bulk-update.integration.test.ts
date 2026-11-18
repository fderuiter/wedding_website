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
    await realPrisma.contributor.deleteMany();
    await realPrisma.invitationCode.deleteMany();

    service = new InvitationCodeAdminService();
    // Inject real PrismaClient
    service.repo.client = realPrisma;
  });

  afterAll(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.invitationCode.deleteMany();
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
        const originalExecuteRaw = tx.$executeRaw.bind(tx);
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
});
