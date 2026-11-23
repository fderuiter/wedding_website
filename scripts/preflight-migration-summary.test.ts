import fs from 'fs';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import {
  parsePrismaMigrateStatus,
  extractDdlStatements,
  getMigrationDdlSummaries,
  formatPreflightSummary,
  resolveGitChangedMigrations,
  runPreflightCheck,
} from './preflight-migration-summary';
import {
  extractPrismaCliCommand,
  isPooledPostgresUrl,
  isSamePostgresDatabase,
  resolvePrismaDatasourceUrl,
  resolvePrismaShadowDatabaseUrl,
} from '../prisma.config';

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

    it('parses singular and plural Prisma 7.10.1 pending and failed migration headers', () => {
      const singularPending = parsePrismaMigrateStatus(`
1 migration found in prisma/migrations
Following migration have not yet been applied:
20261122000000_single_pending

To apply migrations in production run prisma migrate deploy.
`);
      expect(singularPending.pendingMigrations).toEqual(['20261122000000_single_pending']);
      expect(singularPending.failedMigrations).toEqual([]);
      expect(singularPending.hasFatalError).toBe(false);

      const singularFailed = parsePrismaMigrateStatus(`
2 migrations found in prisma/migrations
Following migration have failed:
20261122000000_broken_ddl

During development if the failed migration(s) have not been deployed to a production database you can then fix the migration(s) and run prisma migrate dev.
`);
      expect(singularFailed.failedMigrations).toEqual(['20261122000000_broken_ddl']);
      expect(singularFailed.isUpToDate).toBe(false);

      const pluralFailed = parsePrismaMigrateStatus(`
3 migrations found in prisma/migrations
Following migrations have failed:
20261120000000_first_failed
20261121000000_second_failed

The failed migration(s) can be marked as rolled back or applied:
`);
      expect(pluralFailed.failedMigrations).toEqual([
        '20261120000000_first_failed',
        '20261121000000_second_failed',
      ]);
    });

    it('fails closed with FAILED summary on P3025, P1001, diverged history, unmanaged schema, and failed migrations', () => {
      const errorScenarios = [
        {
          label: 'P3025 shadow database collision',
          output:
            'Error: P3025\nThe shadow database you provided appears to be the same as the main database.',
        },
        {
          label: 'P1001 unreachable database',
          output:
            "Error: P1001: Can't reach database server at `localhost:5439`.\nPlease make sure your database server is running.",
        },
        {
          label: 'diverged migration history',
          output: `Your local migration history and the migrations table from your database are different:

The last common migration is: 20261001000000_init

The migration have not yet been applied:
20261122000000_local_only

The migration from the database are not found locally in prisma/migrations:
20261115000000_remote_only`,
        },
        {
          label: 'unmanaged database schema',
          output: `The current database is not managed by Prisma Migrate.

Read more about how to baseline an existing production database:
https://pris.ly/d/migrate-baseline`,
        },
        {
          label: 'failed migration block',
          output: `Following migration have failed:
20261122000000_failed_step

Read more about how to resolve migration issues in a production database:`,
        },
      ];

      for (const scenario of errorScenarios) {
        const res = runPreflightCheck({
          environment: 'production',
          mockOutput: scenario.output,
          mockExitCode: 1,
          migrationsDir: tmpDir,
        });
        expect(res.success).toBe(false);
        expect(res.summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
      }
    });

    it('returns success: true and READY TO APPLY when prisma migrate status exits 1 strictly for pending migrations, and fails closed on non-pending exit 1', () => {
      const migrationDir = path.join(tmpDir, '20261122010000_add_guest_notes');
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationDir, 'migration.sql'),
        'ALTER TABLE "Guest" ADD COLUMN "notes" TEXT;'
      );

      const originalDbUrl = process.env.DATABASE_URL;
      const originalShadowUrl = process.env.POSTGRES_URL_NON_POOLING;
      process.env.DATABASE_URL = 'postgresql://wedding:secret@localhost:5432/wedding?schema=public';
      process.env.POSTGRES_URL_NON_POOLING =
        'postgresql://wedding:secret@localhost:5432/wedding?schema=public';

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
        expect(spawnedEnv?.POSTGRES_URL_NON_POOLING).toBeUndefined();

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

    it('renders STATIC GIT DIFF when DATABASE_URL is unset, listing only git-changed migrations and 0 on non-DDL commits', () => {
      const repoDir = path.join(tmpDir, 'git-repo');
      const repoMigrationsDir = path.join(repoDir, 'prisma', 'migrations');
      const baselineMig = path.join(repoMigrationsDir, '20260101000000_init');
      fs.mkdirSync(baselineMig, { recursive: true });
      fs.writeFileSync(path.join(baselineMig, 'migration.sql'), 'CREATE TABLE "Init" ("id" TEXT);');
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'initial\n');

      const git = (args: string[]) => {
        const res = child_process.spawnSync('git', args, {
          cwd: repoDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Test',
            GIT_AUTHOR_EMAIL: 'test@example.com',
            GIT_COMMITTER_NAME: 'Test',
            GIT_COMMITTER_EMAIL: 'test@example.com',
          },
        });
        expect(res.status).toBe(0);
        return res.stdout.trim();
      };

      git(['init']);
      git(['add', '.']);
      git(['commit', '-m', 'chore: initial baseline']);
      const baseSha = git(['rev-parse', 'HEAD']);

      const addedMig = path.join(repoMigrationsDir, '20261122020000_add_rsvp_idx');
      fs.mkdirSync(addedMig, { recursive: true });
      fs.writeFileSync(
        path.join(addedMig, 'migration.sql'),
        'CREATE INDEX "Guest_rsvp_idx" ON "Guest"("rsvpStatus");'
      );
      git(['add', '.']);
      git(['commit', '-m', 'feat: add rsvp index migration']);
      const ddlSha = git(['rev-parse', 'HEAD']);

      fs.writeFileSync(path.join(repoDir, 'README.md'), 'updated docs only\n');
      git(['add', 'README.md']);
      git(['commit', '-m', 'docs: update readme']);
      const nonDdlSha = git(['rev-parse', 'HEAD']);

      const originalDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        const ddlDiff = resolveGitChangedMigrations({
          migrationsDir: repoMigrationsDir,
          cwd: repoDir,
          baseRef: baseSha,
          headRef: ddlSha,
        });
        expect(ddlDiff.changedMigrations).toEqual(['20261122020000_add_rsvp_idx']);

        const ddlCheck = runPreflightCheck({
          environment: 'production',
          migrationsDir: repoMigrationsDir,
          cwd: repoDir,
          baseRef: baseSha,
          headRef: ddlSha,
        });
        expect(ddlCheck.success).toBe(true);
        expect(ddlCheck.summary).toContain('`STATIC GIT DIFF`');
        expect(ddlCheck.summary).toContain('**Pre-Flight Gate:** `READY TO APPLY` 🟡');
        expect(ddlCheck.summary).toContain('20261122020000_add_rsvp_idx');
        expect(ddlCheck.summary).not.toContain('20260101000000_init');

        const nonDdlCheck = runPreflightCheck({
          environment: 'production',
          migrationsDir: repoMigrationsDir,
          cwd: repoDir,
          baseRef: ddlSha,
          headRef: nonDdlSha,
        });
        expect(nonDdlCheck.success).toBe(true);
        expect(nonDdlCheck.summary).toContain('`STATIC GIT DIFF`');
        expect(nonDdlCheck.summary).toContain('**Pre-Flight Gate:** `PASSED` 🟢');
        expect(nonDdlCheck.summary).toContain('`0 (No schema alterations in commit range)`');
        expect(nonDdlCheck.summary).not.toContain('20261122020000_add_rsvp_idx');
        expect(nonDdlCheck.summary).not.toContain('20260101000000_init');
      } finally {
        if (originalDbUrl !== undefined) {
          process.env.DATABASE_URL = originalDbUrl;
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

    it('resolves shadowDatabaseUrl to undefined outside migrate dev/reset or when matching DATABASE_URL', () => {
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
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'dev'])
      ).toBe(shadowDb);
      expect(
        resolvePrismaShadowDatabaseUrl(shadowDb, directDb, ['node', 'prisma', 'migrate', 'reset'])
      ).toBe(shadowDb);
    });

    it('prefers POSTGRES_URL_NON_POOLING for datasource.url when DATABASE_URL is pooled during migrate deploy, status, or resolve', () => {
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
