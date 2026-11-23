/**
 * @jest-environment node
 */

import { Pool } from 'pg';

// Unmock pg for direct query inspection
jest.unmock('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

describe('Composite & Foreign Key Indexes Verification', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('PostgreSQL Schema Indexes Verification', () => {
    it('defines all required composite and individual foreign key indexes in pg_indexes', async () => {
      const res = await pool.query<{ indexname: string; tablename: string; indexdef: string }>(`
        SELECT tablename, indexname, indexdef 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
          AND tablename IN ('Contributor', 'RegistryItem', 'BroadcastRecipient', 'SnapshotVersion')
        ORDER BY tablename, indexname;
      `);

      const indexNames = res.rows.map((r) => r.indexname);

      // Contributor indexes
      expect(indexNames).toContain('Contributor_thankYouStatus_date_idx');
      expect(indexNames).toContain('Contributor_registryItemId_idx');
      expect(indexNames).toContain('Contributor_invitationCodeId_idx');

      // RegistryItem indexes
      expect(indexNames).toContain('RegistryItem_imageId_idx');
      expect(indexNames).toContain('RegistryItem_category_price_idx');

      // BroadcastRecipient indexes
      expect(indexNames).toContain('BroadcastRecipient_broadcastId_idx');
      expect(indexNames).toContain('BroadcastRecipient_invitationCodeId_idx');
      expect(indexNames).toContain('BroadcastRecipient_broadcastId_status_idx');

      // SnapshotVersion indexes
      expect(indexNames).toContain('SnapshotVersion_entityType_entityId_createdAt_idx');

      // Verify column order in composite indexes: equality columns precede sort/range columns
      const contributorStatusDateIdx = res.rows.find((r) => r.indexname === 'Contributor_thankYouStatus_date_idx');
      expect(contributorStatusDateIdx?.indexdef).toMatch(/USING btree \("thankYouStatus", date\)/i);

      const registryCategoryPriceIdx = res.rows.find((r) => r.indexname === 'RegistryItem_category_price_idx');
      expect(registryCategoryPriceIdx?.indexdef).toMatch(/USING btree \(category, price\)/i);

      const broadcastStatusIdx = res.rows.find((r) => r.indexname === 'BroadcastRecipient_broadcastId_status_idx');
      expect(broadcastStatusIdx?.indexdef).toMatch(/USING btree \("broadcastId", status\)/i);

      const snapshotEntityHistoryIdx = res.rows.find(
        (r) => r.indexname === 'SnapshotVersion_entityType_entityId_createdAt_idx'
      );
      expect(snapshotEntityHistoryIdx?.indexdef).toMatch(
        /USING btree \("entityType", "entityId", "createdAt" DESC\)/i
      );
    });

    it('defines all reconciled foreign key constraints in pg_constraint', async () => {
      const res = await pool.query<{ conname: string }>(`
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
        ORDER BY c.conname;
      `);

      const constraintNames = res.rows.map((r) => r.conname);
      expect(constraintNames).toContain('WeddingPartyMember_photoId_fkey');
      expect(constraintNames).toContain('Attraction_imageId_fkey');
      expect(constraintNames).toContain('RegistryItem_imageId_fkey');
      expect(constraintNames).toContain('Contributor_registryItemId_fkey');
      expect(constraintNames).toContain('Contributor_invitationCodeId_fkey');
    });
  });

  describe('Query Execution Plans (EXPLAIN)', () => {
    beforeEach(async () => {
      // Temporarily disable sequential scans so optimizer selects index paths regardless of table cardinality
      await pool.query('SET enable_seqscan = off;');
    });

    afterEach(async () => {
      await pool.query('SET enable_seqscan = on;');
    });

    it('executes Contributor thank-you query via index scan without Sort nodes for date ordering', async () => {
      const explainRes = await pool.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT * FROM "Contributor" 
        WHERE "thankYouStatus" = 'Unsent' 
        ORDER BY "date" DESC 
        LIMIT 50;
      `);

      const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('Contributor_thankYouStatus_date_idx');
      expect(planText).not.toMatch(/\bSort\b/i);
    });

    it('executes Contributor status grouping via index-only scan on thankYouStatus and date', async () => {
      const explainRes = await pool.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT "thankYouStatus", count(*) 
        FROM "Contributor" 
        GROUP BY "thankYouStatus";
      `);

      const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('Contributor_thankYouStatus_date_idx');
      expect(planText).toContain('Index Only Scan');
    });

    it('executes BroadcastRecipient status counts via index-only scan on broadcastId and status', async () => {
      const explainRes = await pool.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT count(*) 
        FROM "BroadcastRecipient" 
        WHERE "broadcastId" = '00000000-0000-0000-0000-000000000000' 
          AND "status" = 'SENT';
      `);

      const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('BroadcastRecipient_broadcastId_status_idx');
      expect(planText).toContain('Index Only Scan');
    });

    it('executes RegistryItem catalog filtering and price ordering without Sort nodes', async () => {
      const explainRes = await pool.query<{ 'QUERY PLAN': string }>(`
        EXPLAIN SELECT * FROM "RegistryItem" 
        WHERE "category" = 'Kitchen' 
          AND "price" >= 25.0 
        ORDER BY "price" ASC 
        LIMIT 20;
      `);

      const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(planText).toContain('RegistryItem_category_price_idx');
      expect(planText).not.toMatch(/\bSort\b/i);
    });

    it('executes SnapshotVersion entity history lookup without Sort nodes', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN;');
        await client.query(`
          INSERT INTO "SnapshotVersion" ("id", "entityType", "entityId", "data", "author", "createdAt")
          SELECT
            'explain-seed-' || g::text,
            CASE
              WHEN g % 3 = 0 THEN 'RegistryItem'
              WHEN g % 3 = 1 THEN 'InvitationCode'
              ELSE 'ContentNode'
            END,
            'entity-' || (g % 20)::text,
            '{}'::jsonb,
            'Test',
            NOW() - (g || ' minutes')::interval
          FROM generate_series(1, 200) AS g;
        `);
        await client.query('ANALYZE "SnapshotVersion";');
        await client.query('SET LOCAL enable_seqscan = off;');

        const explainRes = await client.query<{ 'QUERY PLAN': string }>(`
          EXPLAIN SELECT * FROM "SnapshotVersion"
          WHERE "entityType" = 'RegistryItem'
            AND "entityId" = '00000000-0000-0000-0000-000000000000'
          ORDER BY "createdAt" DESC
          LIMIT 20;
        `);

        const planText = explainRes.rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(planText).toContain('SnapshotVersion_entityType_entityId_createdAt_idx');
        expect(planText).not.toMatch(/\bSort\b/i);
      } finally {
        await client.query('ROLLBACK;');
        client.release();
      }
    });
  });
});
