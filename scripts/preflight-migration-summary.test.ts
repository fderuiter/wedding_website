import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parsePrismaMigrateStatus,
  extractDdlStatements,
  getMigrationDdlSummaries,
  formatPreflightSummary,
  runPreflightCheck,
} from './preflight-migration-summary';

describe('Preflight Migration Summary & Schema Status Verification', () => {
  describe('parsePrismaMigrateStatus', () => {
    it('detects up-to-date database schema', () => {
      const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "wedding", schema "public" at "localhost:5432"

Database schema is up to date!
`;
      const result = parsePrismaMigrateStatus(output);
      expect(result.isUpToDate).toBe(true);
      expect(result.pendingMigrations).toEqual([]);
      expect(result.failedMigrations).toEqual([]);
    });

    it('parses list of pending unapplied migrations', () => {
      const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "wedding", schema "public" at "localhost:5432"

Following migrations have not yet been applied:
20261027000000_add_fee_coverage
20261028000000_add_new_feature

To apply migrations in production run prisma migrate deploy
`;
      const result = parsePrismaMigrateStatus(output);
      expect(result.isUpToDate).toBe(false);
      expect(result.pendingMigrations).toEqual([
        '20261027000000_add_fee_coverage',
        '20261028000000_add_new_feature',
      ]);
      expect(result.failedMigrations).toEqual([]);
    });

    it('detects failed migrations in database', () => {
      const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "wedding", schema "public" at "localhost:5432"

The \`20261027000000_add_fee_coverage\` migration started at 2026-11-14 12:00:00 failed
`;
      const result = parsePrismaMigrateStatus(output);
      expect(result.isUpToDate).toBe(false);
      expect(result.failedMigrations).toContain('20261027000000_add_fee_coverage');
    });
  });

  describe('extractDdlStatements', () => {
    it('extracts non-comment DDL statements accurately', () => {
      const sql = `
-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN "coverFee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

/* Block comment
   on multiple lines */
CREATE INDEX "Contributor_coverFee_idx" ON "Contributor"("coverFee");
`;
      const stmts = extractDdlStatements(sql);
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toContain('ALTER TABLE "Contributor" ADD COLUMN "coverFee"');
      expect(stmts[1]).toBe('CREATE INDEX "Contributor_coverFee_idx" ON "Contributor"("coverFee")');
    });
  });

  describe('getMigrationDdlSummaries & formatPreflightSummary', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('summarizes DDL and formats preflight markdown for pending migrations', () => {
      const migrationDir = path.join(tmpDir, '20261027000000_test_migration');
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, 'migration.sql'),
        'ALTER TABLE "User" ADD COLUMN "verified" BOOLEAN DEFAULT false;'
      );

      const ddlSummaries = getMigrationDdlSummaries(tmpDir, ['20261027000000_test_migration']);
      expect(ddlSummaries).toHaveLength(1);
      expect(ddlSummaries[0].migrationName).toBe('20261027000000_test_migration');
      expect(ddlSummaries[0].ddlStatements).toContain('ALTER TABLE "User" ADD COLUMN "verified" BOOLEAN DEFAULT false');

      const md = formatPreflightSummary({
        environment: 'production',
        status: {
          isUpToDate: false,
          pendingMigrations: ['20261027000000_test_migration'],
          failedMigrations: [],
          rawOutput: '',
        },
        ddlSummaries,
      });

      expect(md).toContain('### 📋 Pre-Flight Schema Migration Status & SQL DDL Summary');
      expect(md).toContain('**Target Environment:** `production`');
      expect(md).toContain('**Database Status:** `PENDING MIGRATIONS DETECTED`');
      expect(md).toContain('`20261027000000_test_migration`');
      expect(md).toContain('ALTER TABLE "User" ADD COLUMN "verified" BOOLEAN DEFAULT false');
    });

    it('formats preflight markdown when schema is up to date', () => {
      const md = formatPreflightSummary({
        environment: 'staging',
        status: {
          isUpToDate: true,
          pendingMigrations: [],
          failedMigrations: [],
          rawOutput: '',
        },
        ddlSummaries: [],
      });

      expect(md).toContain('**Target Environment:** `staging`');
      expect(md).toContain('**Pre-Flight Gate:** `PASSED` 🟢');
      expect(md).toContain('**Database Status:** `UP TO DATE`');
    });

    it('appends to GITHUB_STEP_SUMMARY via runPreflightCheck', () => {
      const summaryFile = path.join(tmpDir, 'step_summary.md');
      const mockOutput = 'Database schema is up to date!';

      const res = runPreflightCheck({
        environment: 'production',
        mockOutput,
        migrationsDir: tmpDir,
        stepSummaryFile: summaryFile,
      });

      expect(res.success).toBe(true);
      expect(fs.existsSync(summaryFile)).toBe(true);
      const content = fs.readFileSync(summaryFile, 'utf8');
      expect(content).toContain('Pre-Flight Schema Migration Status');
    });

    it('reports static migration inventory instead of PENDING MIGRATIONS DETECTED when DATABASE_URL is unset', () => {
      const migrationDirA = path.join(tmpDir, '20261121000000_first');
      const migrationDirB = path.join(tmpDir, '20261122000000_second');
      fs.mkdirSync(migrationDirA, { recursive: true });
      fs.mkdirSync(migrationDirB, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDirA, 'migration.sql'),
        'ALTER TABLE "AppConfig" ADD COLUMN "shippingCity" TEXT NOT NULL DEFAULT \'\';'
      );
      fs.writeFileSync(
        path.join(migrationDirB, 'migration.sql'),
        'CREATE INDEX IF NOT EXISTS "Contributor_status_idx" ON "Contributor"("status");'
      );

      const summaryFile = path.join(tmpDir, 'offline_summary.md');
      const origDbUrl = process.env.DATABASE_URL;
      const origTargetEnv = process.env.TARGET_ENVIRONMENT;
      const origNodeEnv = process.env.NODE_ENV;

      try {
        delete process.env.DATABASE_URL;
        delete process.env.TARGET_ENVIRONMENT;
        delete (process.env as Record<string, string | undefined>).NODE_ENV;

        const res = runPreflightCheck({
          migrationsDir: tmpDir,
          stepSummaryFile: summaryFile,
        });

        expect(res.success).toBe(true);
        expect(res.summary).toContain('**Target Environment:** `offline (static inventory)`');
        expect(res.summary).toContain('**Pre-Flight Gate:** `STATIC INVENTORY`');
        expect(res.summary).toContain('**Database Status:** `STATIC MIGRATION INVENTORY (NO DATABASE_URL)`');
        expect(res.summary).toContain('2 total in prisma/migrations');
        expect(res.summary).toContain('`20261122000000_second`');
        expect(res.summary).not.toContain('PENDING MIGRATIONS DETECTED');
        expect(res.summary).not.toContain('**Target Environment:** `production`');

        const stepContent = fs.readFileSync(summaryFile, 'utf8');
        expect(stepContent).toContain('STATIC MIGRATION INVENTORY (NO DATABASE_URL)');
      } finally {
        if (origDbUrl !== undefined) {
          process.env.DATABASE_URL = origDbUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
        if (origTargetEnv !== undefined) {
          process.env.TARGET_ENVIRONMENT = origTargetEnv;
        } else {
          delete process.env.TARGET_ENVIRONMENT;
        }
        if (origNodeEnv !== undefined) {
          (process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv;
        } else {
          delete (process.env as Record<string, string | undefined>).NODE_ENV;
        }
      }
    });
  });
});
