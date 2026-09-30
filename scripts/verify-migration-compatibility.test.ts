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

    it('allows destructive operations when global -- allow-destructive annotation is present', () => {
      const sql = `
        -- allow-destructive: Contract phase of guest table deprecation
        -- DropForeignKey
        ALTER TABLE "Rsvp" DROP CONSTRAINT "Rsvp_guestId_fkey";
        -- DropTable
        DROP TABLE "Rsvp";
        DROP TABLE "Guest";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
    });

    it('allows destructive operations when inline -- allow-destructive annotation is present', () => {
      const sql = `
        -- allow-destructive: removing obsolete table
        DROP TABLE "Guest";

        -- allow-destructive: dropping old column
        ALTER TABLE "User" DROP COLUMN "legacyBio";
      `;

      const violations = verifyMigrationContent(sql);
      expect(violations).toEqual([]);
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
  });
});
