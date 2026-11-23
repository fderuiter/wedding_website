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
    await pool.query('VACUUM ANALYZE "SnapshotVersion", "InvitationCode", "SeatingTable";');
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
        txRepo.client.$executeRaw = jest.fn().mockImplementation(async () => {
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

  it('persists plusOneSeatNumbers integer arrays, skips zero-capacity landmarks, and enforces keepHouseholdsIntact in PostgreSQL', async () => {
    const cleanPrisma = new PrismaClient({ adapter });
    service.repo.client = cleanPrisma;
    try {
      await cleanPrisma.seatingTable.createMany({
        data: [
          { id: 'lm-dance-int', name: 'Dance Floor', shape: 'dance-floor', capacity: 0 },
          { id: 'lm-bar-int', name: 'Open Bar', shape: 'bar', capacity: 0 },
          { id: 'tbl-int-1', name: 'Table 01', shape: 'round', capacity: 4 },
          { id: 'tbl-int-2', name: 'Table 02', shape: 'round', capacity: 2 },
        ],
      });

      await cleanPrisma.invitationCode.createMany({
        data: [
          {
            id: 'g-plus-int-1',
            code: 'C-PLUS-1',
            guestName: 'Host With Two Plus Ones',
            partyGroup: 'VIP',
            partyTags: ['bridal-party'],
            used: true,
            extraFields: { attending: true, plusOneNames: ['Guest Plus A', 'Guest Plus B'] },
            tableId: null,
            seatNumber: null,
          },
          {
            id: 'g-plus-int-2',
            code: 'C-PLUS-2',
            guestName: 'Solo VIP Friend',
            partyGroup: 'VIP',
            partyTags: ['bridal-party'],
            used: true,
            extraFields: { attending: true },
            tableId: null,
            seatNumber: null,
          },
          // Intact household of 3 invitations cannot fit into remaining Table 02 (cap 2) when keepHouseholdsIntact: true
          {
            id: 'g-hh-int-1',
            code: 'C-HH-1',
            guestName: 'Household Member 1',
            householdName: 'Bennett Household',
            used: true,
            extraFields: { attending: true },
            tableId: null,
          },
          {
            id: 'g-hh-int-2',
            code: 'C-HH-2',
            guestName: 'Household Member 2',
            householdName: 'Bennett Household',
            used: true,
            extraFields: { attending: true },
            tableId: null,
          },
          {
            id: 'g-hh-int-3',
            code: 'C-HH-3',
            guestName: 'Household Member 3',
            householdName: 'Bennett Household',
            used: true,
            extraFields: { attending: true },
            tableId: null,
          },
        ],
      });

      const result = await service.autoAssignSeats('IntegrationAdmin', {
        keepHouseholdsIntact: true,
      });

      expect(result.assignedCount).toBe(2);
      expect(result.unassignedCount).toBe(3);

      const hostRow = await cleanPrisma.invitationCode.findUnique({ where: { id: 'g-plus-int-1' } });
      const soloRow = await cleanPrisma.invitationCode.findUnique({ where: { id: 'g-plus-int-2' } });
      const landmarkGuests = await cleanPrisma.invitationCode.findMany({
        where: { tableId: { in: ['lm-dance-int', 'lm-bar-int'] } },
      });

      expect(landmarkGuests).toHaveLength(0);
      expect(hostRow.tableId).toBe('tbl-int-1');
      expect(hostRow.seatNumber).toBe(1);
      expect(hostRow.plusOneSeatNumbers).toEqual([2, 3]);
      expect(soloRow.tableId).toBe('tbl-int-1');
      expect(soloRow.seatNumber).toBe(4);
      expect(soloRow.plusOneSeatNumbers).toEqual([]);
    } finally {
      await cleanPrisma.$disconnect();
    }
  });
});
