import fs from 'fs';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import {
  parsePrismaMigrateStatus,
  parsePreflightCliArgs,
  redactDatabaseUrls,
  extractDdlStatements,
  getMigrationDdlSummaries,
  getChangedMigrationsFromGitDiff,
  formatPreflightSummary,
  runPreflightCheck,
  type ParsedMigrateStatus,
  type MigrationDdlSummary,
  type OfflineDiffMetadata,
  type PreflightCliArgs,
  type PreflightCheckOptions,
} from './preflight-migration-summary';
import {
  extractPrismaCliCommand,
  isPooledPostgresUrl,
  isSamePostgresDatabase,
  resolvePrismaDatasourceUrl,
  resolvePrismaShadowDatabaseUrl,
} from '../prisma.config';

function execGit(cwd: string, args: string[]): string {
  const res = child_process.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Runner',
      GIT_AUTHOR_EMAIL: 'runner@example.com',
      GIT_COMMITTER_NAME: 'Test Runner',
      GIT_COMMITTER_EMAIL: 'runner@example.com',
    },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

describe('Preflight Migration Summary & Schema Status Verification', () => {
  describe('parsePrismaMigrateStatus', () => {
    it('detects up-to-date database schema', () => {
      const output = `
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "wedding", schema "public" at "localhost:5432"

Database schema is up to date!
`;
      const result: ParsedMigrateStatus = parsePrismaMigrateStatus(output);
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

    it('parses Prisma 7 singular pending migration header on exit code 1 as healthy pending state', () => {
      const output = `
12 migrations found in prisma/migrations
Following migration have not yet been applied:
20261121000000_add_registry_shipping_and_order_tracking

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.
`;
      const result = parsePrismaMigrateStatus(output, { exitCode: 1 });
      expect(result.isUpToDate).toBe(false);
      expect(result.hasError).toBe(false);
      expect(result.hasDrift).toBe(false);
      expect(result.hasFatalError).toBe(false);
      expect(result.pendingMigrations).toEqual([
        '20261121000000_add_registry_shipping_and_order_tracking',
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

    it('detects Prisma 7 singular and plural failed migration headers', () => {
      const singularFailed = `
12 migrations found in prisma/migrations
Following migration have failed:
20261027000000_add_fee_coverage

During development if the failed migration(s) have not been deployed to a production database you can then fix the migration(s) and run prisma migrate dev.
`;
      const singularRes = parsePrismaMigrateStatus(singularFailed, { exitCode: 1 });
      expect(singularRes.isUpToDate).toBe(false);
      expect(singularRes.failedMigrations).toEqual(['20261027000000_add_fee_coverage']);

      const pluralFailed = `
Following migrations have failed:
20261027000000_add_fee_coverage
20261028000000_second_failed

The failed migration(s) can be marked as rolled back or applied:
`;
      const pluralRes = parsePrismaMigrateStatus(pluralFailed, { exitCode: 1 });
      expect(pluralRes.failedMigrations).toEqual([
        '20261027000000_add_fee_coverage',
        '20261028000000_second_failed',
      ]);
    });

    it('flags historiesDiverge / schema drift and clears pendingMigrations so deploy halts', () => {
      const divergedOutput = `
Your local migration history and the migrations table from your database are different:

The last common migration is: 20261120010000_add_appconfig_modules

The migration have not yet been applied:
20261121000000_add_registry_shipping_and_order_tracking

The migration from the database are not found locally in prisma/migrations:
20261120990000_remote_manual_hotfix
`;
      const res = parsePrismaMigrateStatus(divergedOutput, { exitCode: 1 });
      expect(res.hasDrift).toBe(true);
      expect(res.hasFatalError).toBe(true);
      expect(res.isUpToDate).toBe(false);
      expect(res.pendingMigrations).toEqual([]);
    });

    it('flags P3025, P1001 connectivity errors, spawn errors, and unexpected exit codes', () => {
      const p3025Res = parsePrismaMigrateStatus(
        'Error: P3025\nThe shadow database you provided appears to be the same as the main database.',
        { exitCode: 1 }
      );
      expect(p3025Res.hasError).toBe(true);
      expect(p3025Res.hasFatalError).toBe(true);
      expect(p3025Res.errorMessage).toContain('P3025');

      const p1001Output = `
Error: P1001: Can't reach database server at \`db.prod.internal:5432\`
Please make sure your database server is running at \`postgresql://wedding_admin:TOP_SECRET_PW@db.prod.internal:5432/wedding\`.
`;
      const p1001Res = parsePrismaMigrateStatus(p1001Output, { exitCode: 1 });
      expect(p1001Res.hasError).toBe(true);
      expect(p1001Res.isUpToDate).toBe(false);
      expect(p1001Res.errorMessage).toContain('P1001');

      const spawnErrRes = parsePrismaMigrateStatus('', {
        exitCode: null,
        spawnError: new Error('spawn npx ENOENT for postgres://u:SECRET2@localhost:5432/db'),
      });
      expect(spawnErrRes.hasError).toBe(true);
      expect(spawnErrRes.errorMessage).toContain('[REDACTED_DATABASE_URL]');
      expect(spawnErrRes.errorMessage).not.toContain('SECRET2');

      const badExitZero = parsePrismaMigrateStatus('Some unexpected message', { exitCode: 0 });
      expect(badExitZero.hasError).toBe(true);
      expect(badExitZero.isUpToDate).toBe(false);

      const badExitTwo = parsePrismaMigrateStatus(
        'Following migration have not yet been applied:\n20261027000000_add_fee_coverage\n',
        { exitCode: 2 }
      );
      expect(badExitTwo.hasError).toBe(true);
      expect(badExitTwo.pendingMigrations).toEqual([]);
    });
  });

  describe('parsePreflightCliArgs & redactDatabaseUrls', () => {
    it('parses --require-db, --offline, and --base-ref CLI flags and rejects conflicts', () => {
      const reqDb: PreflightCliArgs = parsePreflightCliArgs(['--require-db']);
      expect(reqDb).toEqual({
        requireDb: true,
        offline: false,
        baseRef: 'HEAD^1',
        cliError: undefined,
      });

      const offlineCustom = parsePreflightCliArgs(['--offline', '--base-ref', 'HEAD~2']);
      expect(offlineCustom).toEqual({
        requireDb: false,
        offline: true,
        baseRef: 'HEAD~2',
        cliError: undefined,
      });

      const offlineEq = parsePreflightCliArgs(['--offline', '--base-ref=origin/main']);
      expect(offlineEq.baseRef).toBe('origin/main');
      expect(offlineEq.cliError).toBeUndefined();

      const withHeadAlias = parsePreflightCliArgs(['--offline', '--base', 'abc1234', '--head', 'def5678']);
      expect(withHeadAlias).toEqual({
        requireDb: false,
        offline: true,
        baseRef: 'abc1234',
        headRef: 'def5678',
        cliError: undefined,
      });

      const conflict = parsePreflightCliArgs(['--require-db', '--offline']);
      expect(conflict.cliError).toContain('Cannot specify both --require-db and --offline');

      const badRef = parsePreflightCliArgs(['--offline', '--base-ref', '--output=/tmp/evil']);
      expect(badRef.cliError).toContain('Invalid or missing value for --base-ref');
    });

    it('redacts postgres:// and postgresql:// URLs from diagnostics', () => {
      const raw =
        'Connection failed for postgresql://admin:myS3cret!@10.0.0.5:5432/prod?sslmode=require and fallback (postgres://user:pw2@/db?host=/cloudsql/p:r:i)';
      const redacted = redactDatabaseUrls(raw);
      expect(redacted).not.toContain('postgresql://');
      expect(redacted).not.toContain('postgres://');
      expect(redacted).not.toContain('myS3cret!');
      expect(redacted).not.toContain('pw2');
      expect(redacted).toContain('[REDACTED_DATABASE_URL]');
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

      const ddlSummaries: MigrationDdlSummary[] = getMigrationDdlSummaries(tmpDir, [
        '20261027000000_test_migration',
      ]);
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

    it('formats FAILED gate with redacted URLs instead of false PASSED when status is not up to date and pendingMigrations is empty', () => {
      const md = formatPreflightSummary({
        environment: 'production',
        status: {
          isUpToDate: false,
          pendingMigrations: [],
          failedMigrations: [],
          rawOutput:
            'Error: P1001: Can\'t reach database server at postgresql://db_user:ULTRA_SECRET@db.internal:5432/wedding',
        },
        ddlSummaries: [],
      });

      expect(md).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(md).not.toContain('**Pre-Flight Gate:** `PASSED`');
      expect(md).toContain('P1001');
      expect(md).toContain('[REDACTED_DATABASE_URL]');
      expect(md).not.toContain('postgresql://');
      expect(md).not.toContain('ULTRA_SECRET');
    });

    it('appends to GITHUB_STEP_SUMMARY via runPreflightCheck', () => {
      const summaryFile = path.join(tmpDir, 'step_summary.md');
      const mockOutput = 'Database schema is up to date!';

      const opts: PreflightCheckOptions = {
        environment: 'production',
        mockOutput,
        migrationsDir: tmpDir,
        stepSummaryFile: summaryFile,
      };
      const res = runPreflightCheck(opts);

      expect(res.success).toBe(true);
      expect(fs.existsSync(summaryFile)).toBe(true);
      const content = fs.readFileSync(summaryFile, 'utf8');
      expect(content).toContain('Pre-Flight Schema Migration Status');
    });

    it('fails runPreflightCheck on P3025, P1001, drift, unmanaged schema, failed migrations, and --require-db without DATABASE_URL', () => {
      const summaryFile = path.join(tmpDir, 'failure_summary.md');

      const missingDbRes = runPreflightCheck({
        environment: 'production',
        requireDb: true,
        databaseUrl: '',
        migrationsDir: tmpDir,
        stepSummaryFile: summaryFile,
      });
      expect(missingDbRes.success).toBe(false);
      expect(missingDbRes.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(missingDbRes.summary).toContain('Missing mandatory DATABASE_URL');

      const p3025Res = runPreflightCheck({
        environment: 'production',
        mockOutput:
          'Error: P3025\nThe shadow database you provided appears to be the same as the main database.',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(p3025Res.success).toBe(false);
      expect(p3025Res.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(p3025Res.summary).toContain('P3025');

      const p1001Res = runPreflightCheck({
        environment: 'production',
        mockOutput:
          'Error: P1001: Can\'t reach database server at postgres://admin:SECRET_TOKEN_99@127.0.0.1:5432/wedding',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(p1001Res.success).toBe(false);
      expect(p1001Res.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(p1001Res.summary).not.toContain('SECRET_TOKEN_99');
      expect(p1001Res.summary).not.toContain('postgres://');

      const driftRes = runPreflightCheck({
        environment: 'production',
        mockOutput:
          'Your local migration history and the migrations table from your database are different:\nThe last common migration is: 20261120010000_base',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(driftRes.success).toBe(false);
      expect(driftRes.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(driftRes.summary).toContain('SCHEMA DRIFT / DIVERGED HISTORY');

      const unmanagedRes = runPreflightCheck({
        environment: 'production',
        mockOutput: 'The current database is not managed by Prisma Migrate.',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(unmanagedRes.success).toBe(false);
      expect(unmanagedRes.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');

      const failedBlockRes = runPreflightCheck({
        environment: 'production',
        mockOutput:
          'Following migration have failed:\n20261122000000_failed_step\n\nRead more about how to resolve migration issues in a production database:',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(failedBlockRes.success).toBe(false);
      expect(failedBlockRes.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      expect(failedBlockRes.summary).toContain('20261122000000_failed_step');

      const singlePendingDir = path.join(tmpDir, '20261121000000_single_pending');
      fs.mkdirSync(singlePendingDir, { recursive: true });
      fs.writeFileSync(
        path.join(singlePendingDir, 'migration.sql'),
        'ALTER TABLE "Guest" ADD COLUMN "tableNote" TEXT;'
      );
      const singlePendingRes = runPreflightCheck({
        environment: 'production',
        mockOutput:
          'Following migration have not yet been applied:\n20261121000000_single_pending\n\nTo apply migrations in production run prisma migrate deploy.',
        mockExitCode: 1,
        migrationsDir: tmpDir,
      });
      expect(singlePendingRes.success).toBe(true);
      expect(singlePendingRes.summary).toContain('**Pre-Flight Gate:** `READY TO APPLY` 🟡');
      expect(singlePendingRes.summary).toContain('`20261121000000_single_pending`');
      expect(singlePendingRes.summary).toContain('ALTER TABLE "Guest" ADD COLUMN "tableNote" TEXT');
    });

    it('preserves and normalizes POSTGRES_URL_NON_POOLING when spawning prisma migrate status, unsets blank values, returns READY TO APPLY on clean exit 1, and fails closed on non-pending exit 1', () => {
      const migrationDir = path.join(tmpDir, '20261122010000_add_guest_notes');
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, 'migration.sql'),
        'ALTER TABLE "Guest" ADD COLUMN "notes" TEXT;'
      );

      const originalDbUrl = process.env.DATABASE_URL;
      const originalShadowUrl = process.env.POSTGRES_URL_NON_POOLING;
      process.env.DATABASE_URL =
        'postgresql://wedding:secret@pooler.internal:6543/wedding?pgbouncer=true&schema=public';
      process.env.POSTGRES_URL_NON_POOLING =
        '"postgresql://wedding:secret@/wedding?host=/cloudsql/proj:us-central1:db&schema=public"';

      const spawnSpy = jest.spyOn(child_process, 'spawnSync');
      try {
        spawnSpy.mockReturnValueOnce({
          pid: 1234,
          output: ['', '', ''],
          stdout: [
            '1 migration found in prisma/migrations',
            'Following migration have not yet been applied:',
            '20261122010000_add_guest_notes',
            '',
            'To apply migrations in production run prisma migrate deploy.',
          ].join('\n'),
          stderr: '',
          status: 1,
          signal: null,
        });

        const pendingRes = runPreflightCheck({
          environment: 'production',
          migrationsDir: tmpDir,
        });

        expect(pendingRes.success).toBe(true);
        expect(pendingRes.summary).toContain('**Pre-Flight Gate:** `READY TO APPLY` 🟡');
        expect(pendingRes.summary).toContain('20261122010000_add_guest_notes');
        const spawnedEnv = spawnSpy.mock.calls[0]?.[2]?.env;
        expect(spawnedEnv?.POSTGRES_URL_NON_POOLING).toBe(
          'postgresql://wedding:secret@localhost/wedding?host=/cloudsql/proj:us-central1:db&schema=public'
        );

        process.env.POSTGRES_URL_NON_POOLING = '""';
        spawnSpy.mockReturnValueOnce({
          pid: 1235,
          output: ['', '', ''],
          stdout: '',
          stderr: 'unexpected network failure without prisma code',
          status: 1,
          signal: null,
        });

        const failedRes = runPreflightCheck({
          environment: 'production',
          migrationsDir: tmpDir,
        });

        expect(failedRes.success).toBe(false);
        expect(failedRes.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
        const secondSpawnedEnv = spawnSpy.mock.calls[1]?.[2]?.env;
        expect(secondSpawnedEnv?.POSTGRES_URL_NON_POOLING).toBeUndefined();
      } finally {
        spawnSpy.mockRestore();
        if (originalDbUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDbUrl;
        }
        if (originalShadowUrl === undefined) {
          delete process.env.POSTGRES_URL_NON_POOLING;
        } else {
          process.env.POSTGRES_URL_NON_POOLING = originalShadowUrl;
        }
      }
    });

    it('emits accurate git diff DDL in --offline or unset DATABASE_URL mode without fabricating slice(-3) pending migrations and falls back when HEAD^1 is missing', () => {
      const repoDir = path.join(tmpDir, 'git-repo');
      const migrationsDir = path.join(repoDir, 'prisma', 'migrations');
      fs.mkdirSync(migrationsDir, { recursive: true });

      execGit(repoDir, ['init']);

      // Seed 4 historical migrations in initial commit
      const historicalNames = [
        '20261118000000_first_baseline',
        '20261119000000_second_baseline',
        '20261120010000_third_baseline',
        '20261120020000_fourth_baseline',
      ];
      for (const name of historicalNames) {
        const dir = path.join(migrationsDir, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'migration.sql'), `CREATE TABLE "${name}" ("id" TEXT PRIMARY KEY);`);
      }
      execGit(repoDir, ['add', '.']);
      execGit(repoDir, ['commit', '-m', 'Initial baseline migrations']);
      const baseSha = execGit(repoDir, ['rev-parse', 'HEAD']);

      // Single-commit repo has no HEAD^1: must fall back to zero diff items cleanly
      const missingParentRes = runPreflightCheck({
        environment: 'production',
        offline: true,
        cwd: repoDir,
        migrationsDir,
      });
      expect(missingParentRes.success).toBe(true);
      expect(missingParentRes.summary).toContain('**Database Status:** `NOT QUERIED`');
      expect(missingParentRes.summary).toContain('**Changed Migration Files:** `0`');
      expect(missingParentRes.summary).not.toContain('PENDING MIGRATIONS DETECTED');
      for (const historical of historicalNames) {
        expect(missingParentRes.summary).not.toContain(historical);
      }

      // Second commit with no migration changes: must report 0 changed files (never slice(-3))
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# App update without schema changes\n');
      execGit(repoDir, ['add', 'README.md']);
      execGit(repoDir, ['commit', '-m', 'Code-only commit']);
      const codeOnlySha = execGit(repoDir, ['rev-parse', 'HEAD']);

      const zeroDiffRes = runPreflightCheck({
        environment: 'production',
        databaseUrl: '',
        cwd: repoDir,
        migrationsDir,
      });
      expect(zeroDiffRes.success).toBe(true);
      expect(zeroDiffRes.summary).toContain('**Database Status:** `NOT QUERIED`');
      expect(zeroDiffRes.summary).toContain('**Changed Migration Files:** `0`');
      expect(zeroDiffRes.summary).not.toContain('PENDING MIGRATIONS DETECTED');
      for (const historical of historicalNames) {
        expect(zeroDiffRes.summary).not.toContain(historical);
      }

      // Third commit adds one new migration: --offline against HEAD^1 reports only the new DDL
      const newMigration = '20261121000000_add_registry_shipping_and_order_tracking';
      const newMigDir = path.join(migrationsDir, newMigration);
      fs.mkdirSync(newMigDir, { recursive: true });
      fs.writeFileSync(
        path.join(newMigDir, 'migration.sql'),
        'ALTER TABLE "RegistryItem" ADD COLUMN "trackingNumber" TEXT;'
      );
      execGit(repoDir, ['add', '.']);
      execGit(repoDir, ['commit', '-m', 'Add registry shipping tracking migration']);
      const ddlSha = execGit(repoDir, ['rev-parse', 'HEAD']);

      const diffCheck = getChangedMigrationsFromGitDiff({
        migrationsDir,
        baseRef: 'HEAD^1',
        cwd: repoDir,
      });
      expect(diffCheck).toEqual({
        changedMigrations: [newMigration],
        baseRef: 'HEAD^1',
        baseRefMissing: false,
      });

      const rangeCheck = getChangedMigrationsFromGitDiff({
        migrationsDir,
        baseRef: baseSha,
        headRef: codeOnlySha,
        cwd: repoDir,
      });
      expect(rangeCheck.changedMigrations).toEqual([]);

      const ddlRangeCheck = getChangedMigrationsFromGitDiff({
        migrationsDir,
        baseRef: baseSha,
        headRef: ddlSha,
        cwd: repoDir,
      });
      expect(ddlRangeCheck.changedMigrations).toEqual([newMigration]);

      const offlineDiffMeta: OfflineDiffMetadata = {
        baseRef: diffCheck.baseRef,
        baseRefMissing: diffCheck.baseRefMissing,
      };
      expect(offlineDiffMeta.baseRefMissing).toBe(false);

      const changedDiffRes = runPreflightCheck({
        environment: 'production',
        offline: true,
        baseRef: 'HEAD~2',
        cwd: repoDir,
        migrationsDir,
        databaseUrl: 'postgresql://ignored_in_offline:secret@localhost:5432/wedding',
      });
      expect(changedDiffRes.success).toBe(true);
      expect(changedDiffRes.summary).toContain('**Database Status:** `NOT QUERIED`');
      expect(changedDiffRes.summary).toContain('**Changed Migration Files:** `1`');
      expect(changedDiffRes.summary).toContain(`\`${newMigration}\``);
      expect(changedDiffRes.summary).toContain(
        'ALTER TABLE "RegistryItem" ADD COLUMN "trackingNumber" TEXT'
      );
      expect(changedDiffRes.summary).not.toContain('PENDING MIGRATIONS DETECTED');
      for (const historical of historicalNames) {
        expect(changedDiffRes.summary).not.toContain(historical);
      }
    });

    it('defaults Target Environment to offline when DATABASE_URL is unset and development for local status checks when NODE_ENV/TARGET_ENVIRONMENT are omitted', () => {
      const summaryFile = path.join(tmpDir, 'default_env_summary.md');
      const origDbUrl = process.env.DATABASE_URL;
      const origTargetEnv = process.env.TARGET_ENVIRONMENT;
      const origNodeEnv = process.env.NODE_ENV;

      try {
        delete process.env.DATABASE_URL;
        delete process.env.TARGET_ENVIRONMENT;
        delete (process.env as Record<string, string | undefined>).NODE_ENV;

        const offlineFallbackRes = runPreflightCheck({
          cwd: tmpDir,
          migrationsDir: tmpDir,
          stepSummaryFile: summaryFile,
        });
        expect(offlineFallbackRes.success).toBe(true);
        expect(offlineFallbackRes.summary).toContain('**Target Environment:** `offline`');
        expect(offlineFallbackRes.summary).toContain('**Database Status:** `NOT QUERIED`');
        expect(offlineFallbackRes.summary).not.toContain('PENDING MIGRATIONS DETECTED');
        expect(offlineFallbackRes.summary).not.toContain('**Target Environment:** `production`');
        expect(fs.readFileSync(summaryFile, 'utf8')).toContain('**Database Status:** `NOT QUERIED`');

        const localDbRes = runPreflightCheck({
          mockOutput: 'Database schema is up to date!',
          mockExitCode: 0,
          migrationsDir: tmpDir,
        });
        expect(localDbRes.success).toBe(true);
        expect(localDbRes.summary).toContain('**Target Environment:** `development`');
        expect(localDbRes.summary).toContain('**Database Status:** `UP TO DATE`');
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

  describe('prisma.config.ts shadow and non-pooling URL resolution', () => {
    const directDb = 'postgresql://wedding:pass@db.example.com:5432/wedding_db?schema=public';
    const shadowDb = 'postgresql://wedding:pass@db.example.com:5432/wedding_shadow?schema=public';
    const pooledNeon =
      'postgresql://wedding:pass@ep-cool-pooler.us-east-1.aws.neon.tech:5432/wedding_db?sslmode=require&pgbouncer=true';
    const directNeon =
      'postgresql://wedding:pass@ep-cool.us-east-1.aws.neon.tech:5432/wedding_db?sslmode=require';

    it('extracts positional Prisma CLI subcommands ignoring flags and flag arguments', () => {
      expect(
        extractPrismaCliCommand([
          'node',
          'prisma',
          '--config',
          'prisma.config.ts',
          'migrate',
          'deploy',
          '--schema=prisma/schema.prisma',
        ])
      ).toEqual(['migrate', 'deploy']);
      expect(extractPrismaCliCommand(['node', 'prisma', 'migrate', 'dev', '-n', 'init'])).toEqual([
        'migrate',
        'dev',
      ]);
    });

    it('detects pooled PostgreSQL URLs and matching database endpoints accurately', () => {
      expect(isPooledPostgresUrl(pooledNeon)).toBe(true);
      expect(
        isPooledPostgresUrl('postgresql://wedding:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres')
      ).toBe(true);
      expect(isPooledPostgresUrl(directDb)).toBe(false);

      expect(isSamePostgresDatabase(directDb, directDb)).toBe(true);
      expect(
        isSamePostgresDatabase(
          'postgres://wedding:pass@db.example.com/wedding_db',
          'postgresql://wedding:pass@db.example.com:5432/wedding_db?schema=public'
        )
      ).toBe(true);
      expect(isSamePostgresDatabase(pooledNeon, directNeon)).toBe(true);
      expect(isSamePostgresDatabase(directDb, shadowDb)).toBe(false);
    });

    it('resolves shadowDatabaseUrl to undefined outside migrate dev/reset/diff or when matching DATABASE_URL', () => {
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'deploy'])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'status'])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'generate'])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(directDb, directDb, ['node', 'prisma', 'migrate', 'dev'])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(directNeon, pooledNeon, ['node', 'prisma', 'migrate', 'dev'])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(directNeon, pooledNeon, ['node', 'prisma', 'migrate', 'diff'])
      ).toBeUndefined();

      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'dev'])
      ).toBe(shadowDb);
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'reset'])
      ).toBe(shadowDb);
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, [
          'node',
          'prisma',
          'migrate',
          'diff',
          '--from-migrations',
          'prisma/migrations',
          '--to-schema',
          'prisma/schema.prisma',
        ])
      ).toBe(shadowDb);
    });

    it('promotes POSTGRES_URL_NON_POOLING for datasource.url only when DATABASE_URL is pooled and POSTGRES_URL_NON_POOLING is unpooled with matching database and schema', () => {
      for (const subcommand of ['deploy', 'status', 'resolve'] as const) {
        expect(
          resolvePrismaDatasourceUrl(pooledNeon, directNeon, [
            'node',
            'prisma',
            'migrate',
            subcommand,
          ])
        ).toBe(directNeon);
      }

      // Promotes across distinct external pooler and direct PostgreSQL hosts when DB & schema match
      const pooledExternal =
        'postgresql://wedding:pass@pgbouncer.internal:6543/wedding?pgbouncer=true&schema=public';
      const directExternal =
        'postgresql://wedding:pass@postgres-primary.internal:5432/wedding?schema=public';
      expect(
        resolvePrismaDatasourceUrl(pooledExternal, directExternal, [
          'node',
          'prisma',
          'migrate',
          'deploy',
        ])
      ).toBe(directExternal);

      // Keeps primary DATABASE_URL when POSTGRES_URL_NON_POOLING points to wedding_shadow
      expect(
        resolvePrismaDatasourceUrl(pooledNeon, shadowDb, ['node', 'prisma', 'migrate', 'deploy'])
      ).toBe(pooledNeon);

      // Keeps primary DATABASE_URL when POSTGRES_URL_NON_POOLING targets a different schema
      const wrongSchemaDirect =
        'postgresql://user:pass@ep-cool-darkness-123456.us-east-2.aws.neon.tech/wedding?sslmode=require&schema=staging';
      expect(
        resolvePrismaDatasourceUrl(pooledNeon, wrongSchemaDirect, [
          'node',
          'prisma',
          'migrate',
          'deploy',
        ])
      ).toBe(pooledNeon);

      // Keeps primary DATABASE_URL when POSTGRES_URL_NON_POOLING is also pooled
      const secondaryPooled =
        'postgresql://user:pass@ep-other-pooler.us-east-2.aws.neon.tech/wedding?sslmode=require';
      expect(
        resolvePrismaDatasourceUrl(pooledNeon, secondaryPooled, [
          'node',
          'prisma',
          'migrate',
          'deploy',
        ])
      ).toBe(pooledNeon);

      // Prevents P3025 during migrate dev when pooled DATABASE_URL + direct POSTGRES_URL_NON_POOLING share DB/schema
      expect(
        resolvePrismaShadowDatabaseUrl(directNeon, pooledNeon, [
          'node',
          'prisma',
          'migrate',
          'dev',
        ])
      ).toBeUndefined();
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, pooledNeon, [
          'node',
          'prisma',
          'migrate',
          'dev',
        ])
      ).toBe(shadowDb);

      // Keeps primary DATABASE_URL when unpooled or outside deploy/status/resolve
      expect(
        resolvePrismaDatasourceUrl(directDb, shadowDb, ['node', 'prisma', 'migrate', 'deploy'])
      ).toBe(directDb);
      expect(
        resolvePrismaDatasourceUrl(pooledNeon, directNeon, ['node', 'prisma', 'generate'])
      ).toBe(pooledNeon);
    });
  });
});
