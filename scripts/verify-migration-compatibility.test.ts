import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  verifyMigrationContent,
  verifyMigrations,
  findSqlFiles,
} from './verify-migration-compatibility';

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
      expect(result.totalFiles).toBeGreaterThanOrEqual(31);
      expect(result.violations).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });
});
