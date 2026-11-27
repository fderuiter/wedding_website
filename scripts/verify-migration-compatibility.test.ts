import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  HISTORICAL_BASELINE_MIGRATION_PATHS,
  verifyMigrationContent,
  verifyMigrations,
  verifyMigrationFiles,
  findSqlFiles,
} from './verify-migration-compatibility';
import { REQUIRED_MIGRATION_NAMES } from '../src/lib/readinessManifest';

describe('SQL Migration Backwards Compatibility Linter', () => {
  describe('verifyMigrationContent', () => {
    it('passes additive and non-destructive SQL migrations', () => {
      const sql = `
        -- CreateTable
        CREATE TABLE "RegistryItem" (
            "id" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            CONSTRAINT "RegistryItem_pkey" PRIMARY KEY ("id")
        );

        -- AlterTable
        ALTER TABLE "Contributor" ADD COLUMN "email" TEXT,
        ADD COLUMN "isPlusOne" BOOLEAN NOT NULL DEFAULT false;

        -- AlterTable
        ALTER TABLE "WeddingPartyMember" ALTER COLUMN "photoId" DROP NOT NULL;

        -- Data migration
        UPDATE "SnapshotVersion" SET "entityType" = UPPER("entityType");
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('fails on DROP TABLE statement', () => {
      const sql = `
        -- DropTable
        DROP TABLE "Guest";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('DROP TABLE');
      expect(violations[0].line).toBe(3);
    });

    it('fails on DROP COLUMN statement', () => {
      const sql = `
        ALTER TABLE "User" DROP COLUMN "legacyBio";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('DROP COLUMN');
      expect(violations[0].line).toBe(2);
    });

    it('fails on RENAME COLUMN statement', () => {
      const sql = `
        ALTER TABLE "User" RENAME COLUMN "firstName" TO "givenName";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('RENAME COLUMN');
      expect(violations[0].line).toBe(2);
    });

    it('fails on DROP CONSTRAINT statement', () => {
      const sql = `
        ALTER TABLE "Rsvp" DROP CONSTRAINT "Rsvp_guestId_fkey";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('DROP CONSTRAINT');
      expect(violations[0].line).toBe(2);
    });

    it('fails on ADD COLUMN with NOT NULL without DEFAULT', () => {
      const sql = `
        ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('ADD COLUMN NOT NULL');
      expect(violations[0].line).toBe(2);
    });

    it('fails on ADD COLUMN IF NOT EXISTS with NOT NULL without DEFAULT', () => {
      const sql = `
        ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT NOT NULL;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('ADD COLUMN NOT NULL');
      expect(violations[0].line).toBe(2);
    });

    it('fails on chained ADD COLUMN with NOT NULL without DEFAULT', () => {
      const sql = `
        ALTER TABLE "Contributor" ADD COLUMN "email" TEXT,
        ADD COLUMN "priorityLevel" INTEGER NOT NULL;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0].keyword).toBe('ADD COLUMN NOT NULL');
      expect(violations[0].line).toBe(3);
    });

    it('passes ADD COLUMN with NOT NULL when DEFAULT value is provided', () => {
      const sql = `
        ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'GUEST';
        ALTER TABLE "User" ADD COLUMN "status" TEXT DEFAULT 'ACTIVE' NOT NULL;
        ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('allows ADD COLUMN with NOT NULL without DEFAULT when allow-destructive annotation is present', () => {
      const sql = `
        -- allow-destructive: Required mandatory column for new feature
        ALTER TABLE "User" ADD COLUMN "tenantId" TEXT NOT NULL;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('scopes -- allow-destructive strictly to a single statement and flags subsequent unannotated drops', () => {
      const sql = `
        -- allow-destructive: Contract phase of guest fkey removal
        -- DropForeignKey
        ALTER TABLE "Rsvp" DROP CONSTRAINT "Rsvp_guestId_fkey";
        -- DropTable
        DROP TABLE "Rsvp";
        DROP TABLE "Guest";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(2);
      expect(violations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 6,
      });
      expect(violations[1]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 7,
      });
    });

    it('clears -- allow-destructive after a non-destructive statement so later breaking DDL still fails', () => {
      const sql = `
        -- allow-destructive: Annotation attached to safe statement
        ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
        DROP TABLE "Guest";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 4,
      });
    });

    it('scopes -- allow-destructive across multiple statements on the same line', () => {
      const sql = '-- allow-destructive: drop temporary staging table\nDROP TABLE "StageA"; DROP TABLE "StageB";';

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 2,
        snippet: 'DROP TABLE "StageB";',
      });
    });

    it('allows destructive operations when each statement has its own -- allow-destructive: <reason> annotation', () => {
      const sql = `
        -- allow-destructive: removing obsolete table
        DROP TABLE "Guest";

        -- allow-destructive: dropping old column
        ALTER TABLE "User" DROP COLUMN "legacyBio";

        DROP TABLE "TempImport"; -- allow-destructive: trailing same-line bypass reason
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('does not leak a same-line trailing -- allow-destructive comment to the next statement', () => {
      const sql = `
        DROP TABLE "TempImport"; -- allow-destructive: only applies to TempImport
        DROP TABLE "Guest";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 3,
      });
    });

    it('rejects -- allow-destructive annotations that omit a non-empty reason', () => {
      const sql = `
        -- allow-destructive
        DROP TABLE "Guest";

        -- allow-destructive:
        ALTER TABLE "User" DROP COLUMN "legacyBio";

        -- allow-destructive:    
        TRUNCATE TABLE "AuditLog";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(3);
      expect(violations.map((v) => v.keyword)).toEqual([
        'DROP TABLE',
        'DROP COLUMN',
        'TRUNCATE',
      ]);
    });

    it('ignores -- allow-destructive text inside block comments, nested block comments, strings, identifiers, and non-DO dollar quotes', () => {
      const sql = `
        /* -- allow-destructive: hidden in block comment */
        DROP TABLE "Guest";

        /* outer /* inner */ -- allow-destructive: hidden in nested block comment */
        DROP TABLE "Rsvp";

        INSERT INTO "AuditLog" ("details") VALUES ('-- allow-destructive: hidden in string literal');
        DROP TABLE "Session";

        INSERT INTO "AuditLog" ("details") VALUES (E'escaped \\' quote\n-- allow-destructive: hidden in escape string');
        ALTER TABLE "User" DROP COLUMN "legacyBio";

        SELECT 1 AS "-- allow-destructive: hidden in quoted identifier";
        ALTER TABLE "User" RENAME COLUMN "a" TO "b";

        INSERT INTO "AuditLog" ("details") VALUES ($tag$
        -- allow-destructive: hidden in dollar-quoted string
        $tag$);
        DROP TYPE "LegacyEnum";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations.map((v) => v.keyword)).toEqual([
        'DROP TABLE',
        'DROP TABLE',
        'DROP TABLE',
        'DROP COLUMN',
        'RENAME COLUMN',
        'DROP TYPE',
      ]);
    });

    it('flags multi-line destructive statements and comma-in-parens column types', () => {
      const sql = `
        DROP
          TABLE
          IF EXISTS
          "Guest";

        ALTER TABLE
          "User"
        ADD COLUMN
          "role"
          TEXT
          NOT NULL;

        ALTER TABLE "RegistryItem"
          ADD COLUMN "exactPrice" NUMERIC(10, 2) NOT NULL;

        ALTER TABLE "Contributor"
          ADD COLUMN "safeNote" TEXT,
          DROP
            COLUMN "legacyFlag",
          ALTER COLUMN "email"
            SET NOT NULL;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toHaveLength(5);
      expect(violations.map((v) => v.keyword)).toEqual([
        'DROP TABLE',
        'ADD COLUMN NOT NULL',
        'ADD COLUMN NOT NULL',
        'DROP COLUMN',
        'SET NOT NULL',
      ]);
      expect(violations[0].line).toBe(2);
      expect(violations[3].line).toBe(19);
      expect(violations[4].line).toBe(21);
    });

    it('flags TRUNCATE, SET NOT NULL, SET DATA TYPE, RENAME TO, and DROP TYPE', () => {
      const sql = `
        TRUNCATE TABLE "AuditLog";
        TRUNCATE "Session" RESTART IDENTITY CASCADE;
        ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
        ALTER TABLE "User" ALTER COLUMN "age" SET DATA TYPE BIGINT;
        ALTER TABLE "User" ALTER COLUMN "score" TYPE NUMERIC(8, 2) USING "score"::NUMERIC(8, 2);
        ALTER TABLE "Guest" RENAME TO "LegacyGuest";
        ALTER TYPE "WeddingPartySide" RENAME TO "PartySide";
        DROP TYPE IF EXISTS "LegacyStatus";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations.map((v) => ({ line: v.line, keyword: v.keyword }))).toEqual([
        { line: 2, keyword: 'TRUNCATE' },
        { line: 3, keyword: 'TRUNCATE' },
        { line: 4, keyword: 'SET NOT NULL' },
        { line: 5, keyword: 'SET DATA TYPE' },
        { line: 6, keyword: 'SET DATA TYPE' },
        { line: 7, keyword: 'RENAME TO' },
        { line: 8, keyword: 'RENAME TO' },
        { line: 9, keyword: 'DROP TYPE' },
      ]);
    });

    it('inspects PL/pgSQL DO blocks recursively for additive and destructive inner statements', () => {
      const additiveDoSql = `
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WeddingPartySide') THEN
            CREATE TYPE "WeddingPartySide" AS ENUM ('BRIDE', 'GROOM', 'JOINT');
          END IF;
        END $$;
      `;
      expect(verifyMigrationContent(additiveDoSql)).toEqual([]);

      const unannotatedDoSql = `
        DO $migration$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'Rsvp') THEN
            ALTER TABLE "Rsvp" DROP CONSTRAINT IF EXISTS "Rsvp_guestId_fkey";
            DROP TABLE IF EXISTS "Rsvp";
          END IF;
        END $migration$;
      `;
      const doViolations = verifyMigrationContent(unannotatedDoSql);
      expect(doViolations).toHaveLength(2);
      expect(doViolations[0]).toMatchObject({
        keyword: 'DROP CONSTRAINT',
        line: 5,
      });
      expect(doViolations[1]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 6,
      });
    });

    it('supports -- allow-destructive: <reason> on an outer DO block or individual inner DO statements', () => {
      const outerAnnotatedDo = `
        -- allow-destructive: Planned contract cleanup inside conditional block
        DO $$
        BEGIN
          ALTER TABLE "Rsvp" DROP CONSTRAINT IF EXISTS "Rsvp_guestId_fkey";
          DROP TABLE IF EXISTS "Rsvp";
        END $$;

        DROP TABLE "UnannotatedAfterDo";
      `;
      const outerViolations = verifyMigrationContent(outerAnnotatedDo);
      expect(outerViolations).toHaveLength(1);
      expect(outerViolations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 9,
      });

      const innerPartiallyAnnotatedDo = `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'Rsvp') THEN
            -- allow-destructive: Approved foreign key drop
            ALTER TABLE "Rsvp" DROP CONSTRAINT IF EXISTS "Rsvp_guestId_fkey";
            DROP TABLE IF EXISTS "Rsvp";
          END IF;
        END $$;
      `;
      const innerViolations = verifyMigrationContent(innerPartiallyAnnotatedDo);
      expect(innerViolations).toHaveLength(1);
      expect(innerViolations[0]).toMatchObject({
        keyword: 'DROP TABLE',
        line: 7,
      });
    });

    it('grandfathers only the historical 20250419033000_merge_guest_contributor migration when line-1 annotation is present', () => {
      const historicalPath = 'prisma/migrations/20250419033000_merge_guest_contributor/migration.sql';
      const sqlWithLineOneBypass = [
        '-- allow-destructive: Historical merge of Guest into Contributor',
        'ALTER TABLE "Contributor" ADD COLUMN IF NOT EXISTS "email" TEXT;',
        'DO $$ BEGIN DROP TABLE IF EXISTS "Guest"; END $$;',
      ].join('\n');

      expect(verifyMigrationContent(sqlWithLineOneBypass, historicalPath)).toEqual([]);

      // Same content in any other migration file path must fail on the unannotated second statement
      const otherPathViolations = verifyMigrationContent(
        sqlWithLineOneBypass,
        'prisma/migrations/20261118000000_copy/migration.sql'
      );
      expect(otherPathViolations).toHaveLength(1);
      expect(otherPathViolations[0].keyword).toBe('DROP TABLE');

      // Historical path without its line-1 bypass annotation must still be linted
      const sqlWithoutLineOneBypass = [
        '-- AlterTable',
        'ALTER TABLE "Contributor" ADD COLUMN IF NOT EXISTS "email" TEXT;',
        'DO $$ BEGIN DROP TABLE IF EXISTS "Guest"; END $$;',
      ].join('\n');
      expect(verifyMigrationContent(sqlWithoutLineOneBypass, historicalPath)).toHaveLength(1);
    });

    it('does not trigger false positive failures on comments containing destructive keywords', () => {
      const sql = `
        -- Note: This migration replaces the need to DROP TABLE Guest
        -- DropTable
        -- DropForeignKey
        -- RENAME COLUMN is avoided here
        -- DROP COLUMN is not used
        ALTER TABLE "Guest" ADD COLUMN "nickname" TEXT;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('does not trigger false positives on multi-line block comments containing destructive keywords', () => {
      const sql = `
        /*
          Legacy Notes:
          DROP TABLE "OldGuest";
          ALTER TABLE "User" DROP COLUMN "oldField";
          ALTER TABLE "User" RENAME COLUMN "a" TO "b";
          ALTER TABLE "User" DROP CONSTRAINT "fk_test";
        */
        ALTER TABLE "User" ADD COLUMN "newField" TEXT;
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('does not trigger false positives on string literals containing destructive keywords', () => {
      const sql = `
        INSERT INTO "AuditLog" ("action", "details")
        VALUES ('SCHEMA_CHANGE', 'Executed DROP TABLE query safely');
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('blocks all 23 previously unguarded destructive, locking, N-1, and PL/pgSQL/dynamic SQL patterns', () => {
      const unguardedFixtures: Array<{
        name: string;
        sql: string;
        expectedKeyword: string;
      }> = [
        // 1-7: ALTER TYPE & ALTER TABLE column, identity, default, and constraint gaps
        {
          name: 'ALTER TYPE ... RENAME VALUE',
          sql: 'ALTER TYPE "WeddingPartySide" RENAME VALUE \'BRIDE\' TO \'PARTNER_A\';',
          expectedKeyword: 'RENAME VALUE',
        },
        {
          name: 'ALTER TABLE ... ADD COLUMN ... PRIMARY KEY',
          sql: 'ALTER TABLE "User" ADD COLUMN "legacyPk" SERIAL PRIMARY KEY;',
          expectedKeyword: 'ADD COLUMN PRIMARY KEY',
        },
        {
          name: 'ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT',
          sql: 'ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;',
          expectedKeyword: 'DROP DEFAULT',
        },
        {
          name: 'ALTER TABLE ... ADD GENERATED ALWAYS',
          sql: 'ALTER TABLE "User" ADD COLUMN "seqId" INTEGER GENERATED ALWAYS AS IDENTITY;',
          expectedKeyword: 'ADD GENERATED ALWAYS',
        },
        {
          name: 'ALTER TABLE ... ADD CONSTRAINT ... CHECK without NOT VALID',
          sql: 'ALTER TABLE "RegistryItem" ADD CONSTRAINT "RegistryItem_price_check" CHECK ("price" >= 0);',
          expectedKeyword: 'ADD CHECK',
        },
        {
          name: 'ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY without NOT VALID',
          sql: 'ALTER TABLE "Contributor" ADD CONSTRAINT "Contributor_item_fkey" FOREIGN KEY ("registryItemId") REFERENCES "RegistryItem"("id");',
          expectedKeyword: 'ADD FOREIGN KEY',
        },
        {
          name: 'ALTER TABLE ... ADD CONSTRAINT ... UNIQUE without USING INDEX',
          sql: 'ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email");',
          expectedKeyword: 'ADD UNIQUE',
        },
        // 8-17: Locking index DDL, missing DROP object types, and DELETE FROM DML
        {
          name: 'CREATE INDEX without CONCURRENTLY on existing table',
          sql: 'CREATE INDEX "User_email_idx" ON "User"("email");',
          expectedKeyword: 'CREATE INDEX',
        },
        {
          name: 'DROP INDEX without CONCURRENTLY',
          sql: 'DROP INDEX IF EXISTS "User_email_idx";',
          expectedKeyword: 'DROP INDEX',
        },
        {
          name: 'DROP SCHEMA',
          sql: 'DROP SCHEMA IF EXISTS "archive" CASCADE;',
          expectedKeyword: 'DROP SCHEMA',
        },
        {
          name: 'DROP VIEW',
          sql: 'DROP VIEW IF EXISTS "ActiveGuestsView";',
          expectedKeyword: 'DROP VIEW',
        },
        {
          name: 'DROP MATERIALIZED VIEW',
          sql: 'DROP MATERIALIZED VIEW IF EXISTS "GuestSummaryMatView";',
          expectedKeyword: 'DROP MATERIALIZED VIEW',
        },
        {
          name: 'DROP TRIGGER',
          sql: 'DROP TRIGGER IF EXISTS "sync_updated_at" ON "User";',
          expectedKeyword: 'DROP TRIGGER',
        },
        {
          name: 'DROP FUNCTION',
          sql: 'DROP FUNCTION IF EXISTS "compute_household_size"(TEXT);',
          expectedKeyword: 'DROP FUNCTION',
        },
        {
          name: 'DROP PROCEDURE',
          sql: 'DROP PROCEDURE IF EXISTS "purge_expired_locks"();',
          expectedKeyword: 'DROP PROCEDURE',
        },
        {
          name: 'DROP SEQUENCE',
          sql: 'DROP SEQUENCE IF EXISTS "legacy_invoice_seq";',
          expectedKeyword: 'DROP SEQUENCE',
        },
        {
          name: 'DELETE FROM',
          sql: 'DELETE FROM "SnapshotVersion" WHERE "author" = \'System\';',
          expectedKeyword: 'DELETE FROM',
        },
        // 18-23: PL/pgSQL control-flow, routine bodies, string concatenation, format(), and variable EXECUTE
        {
          name: 'PL/pgSQL CASE header inside DO block',
          sql: `
            DO $$
            BEGIN
              CASE WHEN true THEN
                DROP TABLE "Guest";
              END CASE;
            END $$;
          `,
          expectedKeyword: 'DROP TABLE',
        },
        {
          name: 'Single-quoted DO block body',
          sql: 'DO \'BEGIN DROP TABLE "Guest"; END\';',
          expectedKeyword: 'DROP TABLE',
        },
        {
          name: 'CREATE FUNCTION body with destructive SQL',
          sql: `
            CREATE OR REPLACE FUNCTION "run_cleanup"() RETURNS void LANGUAGE plpgsql AS $$
            BEGIN
              DELETE FROM "AuditLog";
            END;
            $$;
          `,
          expectedKeyword: 'DELETE FROM',
        },
        {
          name: 'EXECUTE with || string literal concatenation',
          sql: `
            DO $$
            BEGIN
              EXECUTE 'DROP ' || 'TABLE "Guest"';
            END $$;
          `,
          expectedKeyword: 'DROP TABLE',
        },
        {
          name: 'EXECUTE format() with %I placeholder in ALTER TABLE',
          sql: `
            DO $$
            BEGIN
              EXECUTE format('ALTER TABLE %I DROP COLUMN "legacyBio"', 'User');
            END $$;
          `,
          expectedKeyword: 'DROP COLUMN',
        },
        {
          name: 'Unannotated variable EXECUTE inside DO block',
          sql: `
            DO $$
            DECLARE
              v_sql TEXT := 'DROP TABLE "Guest"';
            BEGIN
              EXECUTE v_sql;
            END $$;
          `,
          expectedKeyword: 'EXECUTE',
        },
      ];

      expect(unguardedFixtures).toHaveLength(23);

      for (const fixture of unguardedFixtures) {
        const violations = verifyMigrationContent(fixture.sql);
        expect(violations.length).toBeGreaterThanOrEqual(1);
        expect(violations[0].keyword).toBe(fixture.expectedKeyword);

        // Every non-transactional-CONCURRENTLY pattern can be explicitly authorized in Phase 3 via statement bypass
        const bypassedSql = `-- allow-destructive: Phase 3 contract test for ${fixture.name}\n${fixture.sql.trim()}`;
        expect(verifyMigrationContent(bypassedSql)).toEqual([]);
      }
    });

    it('covers additional variants: ALTER COLUMN ADD GENERATED ALWAYS, simple CASE, CREATE PROCEDURE, CTE DELETE FROM, PRIMARY KEY / EXCLUDE constraints, and format(%s)', () => {
      expect(
        verifyMigrationContent('ALTER TABLE "User" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY;')[0]?.keyword
      ).toBe('ADD GENERATED ALWAYS');

      expect(
        verifyMigrationContent('ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");')[0]?.keyword
      ).toBe('ADD PRIMARY KEY');

      expect(
        verifyMigrationContent('ALTER TABLE "SeatingTable" ADD CONSTRAINT "no_overlap" EXCLUDE USING gist ("id" WITH =);')[0]?.keyword
      ).toBe('ADD EXCLUDE');

      expect(
        verifyMigrationContent(`
          DO $$
          BEGIN
            CASE current_schema()
              WHEN 'public' THEN
                TRUNCATE TABLE "AuditLog";
            END CASE;
          END $$;
        `)[0]?.keyword
      ).toBe('TRUNCATE');

      expect(
        verifyMigrationContent(`
          CREATE PROCEDURE "archive_cleanup"()
          LANGUAGE plpgsql
          AS 'BEGIN DROP VIEW "LegacyView"; END;';
        `)[0]?.keyword
      ).toBe('DROP VIEW');

      expect(
        verifyMigrationContent(`
          WITH stale AS (SELECT "id" FROM "AuthLockout")
          DELETE FROM "AuthLockout" WHERE "keyHash" IN (SELECT "id" FROM stale);
        `)[0]?.keyword
      ).toBe('DELETE FROM');

      expect(
        verifyMigrationContent(`
          DO $$
          DECLARE
            dyn TEXT := 'DROP TABLE "User"';
          BEGIN
            EXECUTE format('%s', dyn);
          END $$;
        `)[0]?.keyword
      ).toBe('EXECUTE');
    });

    it('enforces single-statement CONCURRENTLY rules and rejects multi-statement or transactional CONCURRENTLY', () => {
      // Dedicated single-statement CONCURRENTLY files pass
      expect(
        verifyMigrationContent(
          '-- CreateIndex\nCREATE INDEX CONCURRENTLY IF NOT EXISTS "User_email_idx" ON "User"("email");\n'
        )
      ).toEqual([]);
      expect(
        verifyMigrationContent(
          'CREATE UNIQUE INDEX CONCURRENTLY "User_code_key" ON "User"("code");'
        )
      ).toEqual([]);
      expect(
        verifyMigrationContent(
          'DROP INDEX CONCURRENTLY IF EXISTS "User_email_idx";'
        )
      ).toEqual([]);

      // Paired with another DDL/DML statement -> Prisma Migrate implicit transaction (25001)
      const pairedWithAlter = `
        ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
        CREATE INDEX CONCURRENTLY "User_nickname_idx" ON "User"("nickname");
      `;
      const pairedViolations = verifyMigrationContent(pairedWithAlter);
      expect(pairedViolations).toHaveLength(1);
      expect(pairedViolations[0]).toMatchObject({
        keyword: 'CONCURRENTLY IN TRANSACTION',
        line: 3,
      });

      // Paired with explicit BEGIN / COMMIT -> PostgreSQL error 25001
      const pairedWithBegin = `
        BEGIN;
        CREATE INDEX CONCURRENTLY "User_email_idx" ON "User"("email");
        COMMIT;
      `;
      const beginViolations = verifyMigrationContent(pairedWithBegin);
      expect(beginViolations).toHaveLength(1);
      expect(beginViolations[0].keyword).toBe('CONCURRENTLY IN TRANSACTION');

      // Two CONCURRENTLY statements in a single migration.sql file -> Prisma Migrate wraps multi-statement files in BEGIN..COMMIT
      const twoConcurrentIndexes = `
        CREATE INDEX CONCURRENTLY "User_a_idx" ON "User"("a");
        CREATE INDEX CONCURRENTLY "User_b_idx" ON "User"("b");
      `;
      const multiConcurrentViolations = verifyMigrationContent(twoConcurrentIndexes);
      expect(multiConcurrentViolations).toHaveLength(2);
      expect(multiConcurrentViolations.map((v) => v.keyword)).toEqual([
        'CONCURRENTLY IN TRANSACTION',
        'CONCURRENTLY IN TRANSACTION',
      ]);

      // DROP INDEX CONCURRENTLY paired with another statement or multiple targets
      expect(
        verifyMigrationContent(
          'ALTER TABLE "User" ADD COLUMN "x" TEXT;\nDROP INDEX CONCURRENTLY "User_x_idx";'
        )[0]?.keyword
      ).toBe('CONCURRENTLY IN TRANSACTION');
      expect(
        verifyMigrationContent('DROP INDEX CONCURRENTLY "idx_a", "idx_b";')[0]?.keyword
      ).toBe('CONCURRENTLY IN TRANSACTION');

      // CONCURRENTLY inside a DO block always runs inside a transaction
      expect(
        verifyMigrationContent(
          'DO $$ BEGIN CREATE INDEX CONCURRENTLY "User_x_idx" ON "User"("x"); END $$;'
        )[0]?.keyword
      ).toBe('CONCURRENTLY IN TRANSACTION');
    });

    it('passes NOT VALID constraints, VALIDATE CONSTRAINT, and UNIQUE USING INDEX on pre-existing tables', () => {
      const safeConstraintRollout = `
        ALTER TABLE "RegistryItem"
          ADD CONSTRAINT "RegistryItem_price_nonnegative" CHECK ("price" >= 0) NOT VALID;
        ALTER TABLE "RegistryItem"
          VALIDATE CONSTRAINT "RegistryItem_price_nonnegative";

        ALTER TABLE "Contributor"
          ADD CONSTRAINT "Contributor_registryItemId_fkey"
          FOREIGN KEY ("registryItemId") REFERENCES "RegistryItem"("id")
          ON DELETE SET NULL NOT VALID;
        ALTER TABLE "Contributor"
          VALIDATE CONSTRAINT "Contributor_registryItemId_fkey";

        ALTER TABLE "Contributor"
          ADD CONSTRAINT "Contributor_stripePaymentIntentId_key"
          UNIQUE USING INDEX "Contributor_stripePaymentIntentId_key";
      `;

      expect(verifyMigrationContent(safeConstraintRollout)).toEqual([]);
    });

    it('exempts non-concurrent indexes and constraints on newly created tables while still requiring NOT VALID when referencing existing tables', () => {
      const safeNewTablesMigration = `
        CREATE TABLE "ParentNew" (
          "id" TEXT NOT NULL,
          CONSTRAINT "ParentNew_pkey" PRIMARY KEY ("id")
        );

        CREATE TABLE public."ChildNew" (
          "id" TEXT NOT NULL,
          "parentId" TEXT NOT NULL,
          "amount" INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT "ChildNew_pkey" PRIMARY KEY ("id")
        );

        CREATE INDEX "ChildNew_parentId_idx" ON "ChildNew"("parentId");
        CREATE UNIQUE INDEX "ParentNew_id_unique_idx" ON public."ParentNew"("id");
        ALTER TABLE "ChildNew" ADD CONSTRAINT "ChildNew_amount_check" CHECK ("amount" >= 0);
        ALTER TABLE "ChildNew" ADD CONSTRAINT "ChildNew_parentId_fkey"
          FOREIGN KEY ("parentId") REFERENCES "ParentNew"("id") ON DELETE CASCADE;
      `;
      expect(verifyMigrationContent(safeNewTablesMigration)).toEqual([]);

      // Foreign key from a newly created table to a pre-existing table still locks the pre-existing table without NOT VALID
      const newChildToExistingParent = `
        CREATE TABLE "AuditEntry" (
          "id" TEXT NOT NULL,
          "invitationCodeId" TEXT NOT NULL,
          CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
        );

        ALTER TABLE "AuditEntry"
          ADD CONSTRAINT "AuditEntry_invitationCodeId_fkey"
          FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE CASCADE;
      `;
      const fkViolations = verifyMigrationContent(newChildToExistingParent);
      expect(fkViolations).toHaveLength(1);
      expect(fkViolations[0].keyword).toBe('ADD FOREIGN KEY');

      // Adding NOT VALID resolves the lock on the pre-existing parent table
      const newChildToExistingParentNotValid = `
        CREATE TABLE "AuditEntry" (
          "id" TEXT NOT NULL,
          "invitationCodeId" TEXT NOT NULL,
          CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
        );

        ALTER TABLE "AuditEntry"
          ADD CONSTRAINT "AuditEntry_invitationCodeId_fkey"
          FOREIGN KEY ("invitationCodeId") REFERENCES "InvitationCode"("id") ON DELETE CASCADE NOT VALID;
        ALTER TABLE "AuditEntry"
          VALIDATE CONSTRAINT "AuditEntry_invitationCodeId_fkey";
      `;
      expect(verifyMigrationContent(newChildToExistingParentNotValid)).toEqual([]);
    });

    it('scopes HISTORICAL_BASELINE_MIGRATION_PATHS narrowly to legacy locking/default patterns while keeping destructive checks active', () => {
      expect(Object.isFrozen(HISTORICAL_BASELINE_MIGRATION_PATHS)).toBe(true);
      expect(HISTORICAL_BASELINE_MIGRATION_PATHS.size).toBe(49);

      const manifestPaths = new Set(
        REQUIRED_MIGRATION_NAMES.map((name) => `prisma/migrations/${name}/migration.sql`)
      );
      for (const baselinePath of HISTORICAL_BASELINE_MIGRATION_PATHS) {
        expect(manifestPaths.has(baselinePath)).toBe(true);
      }

      const legacyBaselinePath =
        'prisma/migrations/20261122010000_reconcile_schema_migration_drift/migration.sql';
      const newMigrationPath =
        'prisma/migrations/20990101000000_future_migration/migration.sql';

      const legacyExemptedPatterns = `
        ALTER TABLE "AppConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
        CREATE INDEX IF NOT EXISTS "SnapshotVersion_createdAt_idx" ON "SnapshotVersion"("createdAt");
        ALTER TABLE "Contributor" ADD CONSTRAINT "Contributor_item_fkey"
          FOREIGN KEY ("registryItemId") REFERENCES "RegistryItem"("id");
      `;
      expect(verifyMigrationContent(legacyExemptedPatterns, legacyBaselinePath)).toEqual([]);
      expect(
        verifyMigrationContent(legacyExemptedPatterns, newMigrationPath).map((v) => v.keyword)
      ).toEqual(['DROP DEFAULT', 'CREATE INDEX', 'ADD FOREIGN KEY']);

      // Destructive operations remain blocked even on historical baseline paths
      const destructiveOnHistorical = `
        DROP TABLE "RegistryItem";
        DELETE FROM "Contributor";
      `;
      expect(
        verifyMigrationContent(destructiveOnHistorical, legacyBaselinePath).map((v) => v.keyword)
      ).toEqual(['DROP TABLE', 'DELETE FROM']);
    });
  });

  describe('verifyMigrations directory check', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('scans subdirectories recursively and reports violations', () => {
      const dirA = path.join(tempDir, '20260101000000_safe');
      const dirB = path.join(tempDir, '20260102000000_unsafe');
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      fs.writeFileSync(
        path.join(dirA, 'migration.sql'),
        'CREATE TABLE "Test" ("id" TEXT PRIMARY KEY);'
      );
      fs.writeFileSync(
        path.join(dirB, 'migration.sql'),
        'DROP TABLE "Test";'
      );

      const sqlFiles = findSqlFiles(tempDir);
      expect(sqlFiles).toHaveLength(2);

      const result = verifyMigrations(tempDir);
      expect(result.valid).toBe(false);
      expect(result.totalFiles).toBe(2);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].keyword).toBe('DROP TABLE');
    });

    it('returns valid true when all files in directory pass', () => {
      const dirA = path.join(tempDir, '20260101000000_safe');
      fs.mkdirSync(dirA, { recursive: true });

      fs.writeFileSync(
        path.join(dirA, 'migration.sql'),
        'ALTER TABLE "User" ADD COLUMN "role" TEXT;'
      );

      const result = verifyMigrations(tempDir);
      expect(result.valid).toBe(true);
      expect(result.totalFiles).toBe(1);
      expect(result.violations).toHaveLength(0);
    });

    it('passes across all repository migrations in prisma/migrations without modifying historical files', () => {
      const result = verifyMigrations();
      expect(result.valid).toBe(true);
      expect(result.totalFiles).toBe(49);
      expect(result.violations).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('verifies explicit .sql file arguments passed by lint-staged via verifyMigrationFiles and CLI', () => {
      const safeFile = path.join(tempDir, 'safe.sql');
      const unsafeFile = path.join(tempDir, 'unsafe.sql');
      fs.writeFileSync(safeFile, 'ALTER TABLE "User" ADD COLUMN "bio" TEXT;\n');
      fs.writeFileSync(unsafeFile, 'DROP TABLE "User";\n');

      expect(verifyMigrationFiles([safeFile]).valid).toBe(true);
      expect(verifyMigrationFiles([safeFile, unsafeFile]).valid).toBe(false);

      const scriptPath = path.join(process.cwd(), 'scripts', 'verify-migration-compatibility.ts');
      const cliPass = spawnSync(
        process.execPath,
        ['--experimental-strip-types', scriptPath, safeFile],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      expect(cliPass.status).toBe(0);

      const cliFail = spawnSync(
        process.execPath,
        ['--experimental-strip-types', scriptPath, unsafeFile],
        { cwd: process.cwd(), encoding: 'utf8' }
      );
      expect(cliFail.status).toBe(1);
    });
  });
});
