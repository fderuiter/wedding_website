/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import { buildPostgresRuntimeConfig } from '@/lib/postgresPool';
import { SubEventService } from '../service';

describe('SubEventService.getAccessMatrix PostgreSQL wire-level integration', () => {
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
    await testPrisma.$transaction([
      testPrisma.subEventRsvp.deleteMany(),
      testPrisma.subEventAccess.deleteMany(),
      testPrisma.subEvent.deleteMany(),
      testPrisma.broadcastRecipient.deleteMany(),
      testPrisma.contributor.deleteMany(),
      testPrisma.invitationCode.deleteMany(),
    ]);
  });

  it('executes at most 3 wire-level SELECT statements on pg.Pool, aggregates distinct filters in SQL, and matches fallback output', async () => {
    const welcomeEvent = await testPrisma.subEvent.create({
      data: {
        id: 'se-1-welcome',
        title: 'Welcome Reception',
        description: 'Cocktails on the terrace',
        startTime: new Date('2026-09-18T17:30:00.000Z'),
        endTime: new Date('2026-09-18T20:00:00.000Z'),
        locationName: 'Sunset Terrace',
        location: '100 Ocean View',
        category: 'Social',
        isPrivate: true,
        mealOptions: [
          { id: 'm-fish', label: 'Grilled Sea Bass', description: '', dietaryTags: ['gluten-free'] },
        ],
        customQuestions: [
          { id: 'q-shuttle', prompt: 'Need shuttle?', type: 'choice', required: false, options: ['Yes', 'No'] },
        ],
      },
    });

    const ceremonyEvent = await testPrisma.subEvent.create({
      data: {
        id: 'se-2-ceremony',
        title: 'Main Ceremony',
        description: 'Garden ceremony',
        startTime: new Date('2026-09-19T15:00:00.000Z'),
        endTime: new Date('2026-09-19T16:00:00.000Z'),
        locationName: 'Rose Garden',
        location: '100 Ocean View',
        category: 'Ceremony',
        isPrivate: false,
      },
    });

    const brunchEvent = await testPrisma.subEvent.create({
      data: {
        id: 'se-3-brunch',
        title: 'Farewell Brunch',
        description: 'Sunday morning brunch',
        startTime: null,
        endTime: null,
        locationName: 'Atrium',
        location: '100 Ocean View',
        category: 'Dining',
        isPrivate: true,
      },
    });

    const guestRows = Array.from({ length: 130 }, (_, idx) => {
      const num = String(idx + 1).padStart(3, '0');
      const group = idx % 3 === 0 ? 'Bridal Party' : idx % 3 === 1 ? 'Family' : null;
      const household = idx % 4 === 0 ? 'Smith Household' : idx % 4 === 1 ? 'Patel Household' : '';
      const tags =
        idx % 2 === 0
          ? ['VIP', ' Out of Town ']
          : idx % 5 === 0
            ? ['College Friends']
            : [];

      return {
        id: `inv-${num}`,
        code: `CODE${num}`,
        guestName: `Guest ${num}`,
        householdName: household || null,
        partyGroup: group,
        partyTags: tags,
      };
    });

    await testPrisma.invitationCode.createMany({ data: guestRows });

    // Grant Welcome Reception to 115 guests (>100 cross-page requirement) and Brunch to every 5th guest
    const accessRows = guestRows.flatMap((guest, idx) => {
      const grants: Array<{ id: string; subEventId: string; invitationCodeId: string }> = [];
      if (idx < 115) {
        grants.push({
          id: `acc-welcome-${String(idx + 1).padStart(3, '0')}`,
          subEventId: welcomeEvent.id,
          invitationCodeId: guest.id,
        });
      }
      if (idx % 5 === 0) {
        grants.push({
          id: `acc-brunch-${String(idx + 1).padStart(3, '0')}`,
          subEventId: brunchEvent.id,
          invitationCodeId: guest.id,
        });
      }
      return grants;
    });

    await testPrisma.subEventAccess.createMany({ data: accessRows });

    // Warm up connection pool before recording wire-level SELECT statements
    await testPrisma.$queryRaw`SELECT 1`;

    const recordedSelects: Array<{ sql: string; rowCount: number }> = [];
    const originalPoolQuery = pool.query.bind(pool);

    const querySpy = jest
      .spyOn(pool, 'query')
      .mockImplementation(((...args: unknown[]) => {
        const firstArg = args[0] as string | { text?: string } | undefined;
        const sqlText =
          typeof firstArg === 'string'
            ? firstArg
            : firstArg && typeof firstArg === 'object' && typeof firstArg.text === 'string'
              ? firstArg.text
              : '';

        const result = (originalPoolQuery as (...a: unknown[]) => unknown)(...args);

        if (/^\s*(WITH\b|SELECT\b)/i.test(sqlText) && result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<{ rows?: unknown[] }>).then((res) => {
            recordedSelects.push({
              sql: sqlText,
              rowCount: Array.isArray(res?.rows) ? res.rows.length : 0,
            });
            return res;
          });
        }

        return result;
      }) as typeof pool.query);

    const rawService = new SubEventService(testPrisma);
    let rawMatrix: Awaited<ReturnType<SubEventService['getAccessMatrix']>>;
    try {
      rawMatrix = await rawService.getAccessMatrix({ page: 1, limit: 25 });
    } finally {
      querySpy.mockRestore();
    }

    // Acceptance Criterion 1: at most 3 wire-level SELECT statements on PostgreSQL pg.Pool
    expect(recordedSelects.length).toBeLessThanOrEqual(3);
    expect(recordedSelects).toHaveLength(3);

    // Filter aggregation query returns 1 aggregated row over the wire rather than scanning all 130 guest rows over the wire
    const metadataWireQuery = recordedSelects.find((q) => q.sql.includes('code_filters'));
    expect(metadataWireQuery).toBeDefined();
    expect(metadataWireQuery?.rowCount).toBe(1);

    // Uncapped allowedInvitationCodeIds preserved across >100 guests
    const welcomeOut = rawMatrix.subEvents.find((e) => e.id === welcomeEvent.id);
    const ceremonyOut = rawMatrix.subEvents.find((e) => e.id === ceremonyEvent.id);
    const brunchOut = rawMatrix.subEvents.find((e) => e.id === brunchEvent.id);
    expect(welcomeOut?.allowedInvitationCodeIds).toHaveLength(115);
    expect(welcomeOut?.allowedInvitationCodeIds).toContain('inv-115');
    expect(ceremonyOut?.allowedInvitationCodeIds).toEqual([]);
    expect(brunchOut?.allowedInvitationCodeIds).toHaveLength(26);

    // Distinct filter options sorted cleanly
    expect(rawMatrix.filterOptions).toEqual({
      partyTags: ['College Friends', 'Out of Town', 'VIP'],
      partyGroups: ['Bridal Party', 'Family'],
      householdNames: ['Patel Household', 'Smith Household'],
    });

    // Acceptance Criterion 2: exact output parity between $queryRaw path and fallback path
    const fallbackClientWithoutQueryRaw = {
      subEvent: testPrisma.subEvent,
      invitationCode: testPrisma.invitationCode,
    };
    const fallbackService = new SubEventService(fallbackClientWithoutQueryRaw);

    const fallbackMatrix = await fallbackService.getAccessMatrix({ page: 1, limit: 25 });
    expect(rawMatrix).toEqual(fallbackMatrix);

    // Filtered + paginated query parity as well
    const filteredParams = {
      page: 1,
      limit: 10,
      search: 'Guest 01',
      partyTag: 'VIP',
      partyGroup: 'Bridal Party',
    };
    const [rawFiltered, fallbackFiltered] = await Promise.all([
      rawService.getAccessMatrix(filteredParams),
      fallbackService.getAccessMatrix(filteredParams),
    ]);
    expect(rawFiltered).toEqual(fallbackFiltered);
  });
});
