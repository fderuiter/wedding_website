/**
 * @jest-environment node
 */

import { SeatingTableAdminService } from '../admin.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Unmock @prisma/client for this integration test file
jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

jest.mock('@/lib/audit', () => {
  const actual = jest.requireActual('@/lib/audit');
  return {
    ...actual,
    pruneSnapshotsBulk: jest.fn().mockResolvedValue(undefined),
  };
});

const { PrismaClient } = jest.requireActual('@prisma/client');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

describe('SeatingTableAdminService Auto-Assign Bulk Integration', () => {
  let service: SeatingTableAdminService;

  beforeAll(async () => {
    try {
      await realPrisma.seatingTable.findFirst();
    } catch {
      const { execSync } = await import('node:child_process');
      execSync('npx prisma db push', { stdio: 'pipe' });
    }
  });

  beforeEach(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.invitationCode.deleteMany();
    await realPrisma.seatingTable.deleteMany();

    service = new SeatingTableAdminService();
    service.repo.client = realPrisma;
  });

  afterAll(async () => {
    await realPrisma.snapshotVersion.deleteMany();
    await realPrisma.invitationCode.deleteMany();
    await realPrisma.seatingTable.deleteMany();
    await realPrisma.$disconnect();
    await pool.end();
  });

  it('successfully auto-assigns 500 guests in bulk under 1000ms with real database and creates audit snapshots', async () => {
    // 1. Create 50 tables of capacity 10 each
    const tableData = Array.from({ length: 50 }, (_, i) => ({
      id: `table-bulk-${i + 1}`,
      name: `Table ${String(i + 1).padStart(2, '0')}`,
      capacity: 10,
    }));
    await realPrisma.seatingTable.createMany({ data: tableData });

    // 2. Create 500 unassigned guests in various households
    const guestData: any[] = [];
    let householdId = 1;
    let count = 0;
    while (count < 500) {
      const size = Math.min((householdId % 5) + 1, 500 - count);
      const householdName = `Household_${householdId}`;
      for (let j = 0; j < size; j++) {
        count++;
        guestData.push({
          id: `guest-bulk-${count}`,
          code: `CODE-BULK-${count}`,
          guestName: `Guest ${count}`,
          householdName,
          tableId: null,
          seatNumber: null,
        });
      }
      householdId++;
    }
    await realPrisma.invitationCode.createMany({ data: guestData });

    // 3. Execute autoAssignSeats and measure duration
    const startTime = Date.now();
    const result = await service.autoAssignSeats('BulkTestAuthor');
    const executionTimeMs = Date.now() - startTime;

    expect(result.assignedCount).toBe(500);
    expect(result.unassignedCount).toBe(0);
    expect(result.assignedGuests).toHaveLength(500);
    expect(executionTimeMs).toBeLessThan(1000);

    // 4. Verify in DB that all 500 guests now have tableId and seatNumber
    const assignedDbGuests = await realPrisma.invitationCode.findMany({
      where: { tableId: { not: null } },
    });
    expect(assignedDbGuests).toHaveLength(500);
    expect(assignedDbGuests.every((g: any) => g.seatNumber !== null && g.seatNumber > 0)).toBe(true);

    // 5. Verify that 500 audit snapshot records exist in DB
    const snapshots = await realPrisma.snapshotVersion.findMany({
      where: { entityType: 'InvitationCode', author: 'BulkTestAuthor' },
    });
    expect(snapshots).toHaveLength(500);
  });

  it('rolls back completely if raw SQL execution or audit snapshot fails during transaction', async () => {
    // 1. Create 2 tables of capacity 2 each
    await realPrisma.seatingTable.createMany({
      data: [
        { id: 't-rollback-1', name: 'Table 1', capacity: 2 },
        { id: 't-rollback-2', name: 'Table 2', capacity: 2 },
      ],
    });

    // 2. Create 4 unassigned guests
    await realPrisma.invitationCode.createMany({
      data: [
        { id: 'g-rb-1', code: 'C-RB-1', guestName: 'Guest 1', tableId: null },
        { id: 'g-rb-2', code: 'C-RB-2', guestName: 'Guest 2', tableId: null },
        { id: 'g-rb-3', code: 'C-RB-3', guestName: 'Guest 3', tableId: null },
        { id: 'g-rb-4', code: 'C-RB-4', guestName: 'Guest 4', tableId: null },
      ],
    });

    // Mock client.$executeRaw on the transaction to simulate failure
    const originalTransaction = service.repo.transaction.bind(service.repo);
    service.repo.transaction = async (callback: any) => {
      return originalTransaction(async (txRepo: any) => {
        const originalExecuteRaw = txRepo.client.$executeRaw.bind(txRepo.client);
        txRepo.client.$executeRaw = jest.fn().mockImplementation(async (...args: any[]) => {
          throw new Error('Simulated raw SQL failure');
        });
        return callback(txRepo);
      });
    };

    await expect(service.autoAssignSeats('Admin')).rejects.toThrow('Simulated raw SQL failure');

    // 3. Verify no guest assignments were committed
    const assignedDbGuests = await realPrisma.invitationCode.findMany({
      where: { tableId: { not: null } },
    });
    expect(assignedDbGuests).toHaveLength(0);

    // 4. Verify no snapshots were committed
    const snapshots = await realPrisma.snapshotVersion.findMany();
    expect(snapshots).toHaveLength(0);
  });
});
