/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  checkPrismaSchema,
  formatPrismaCheckFailure,
  parsePrismaCheckArgs,
  verifyReadinessManifestParity,
} from './check-prisma-schema';
import {
  REQUIRED_MIGRATION_NAMES,
  REQUIRED_SCHEMA_TABLES,
} from '../src/lib/readinessManifest';

describe('check-prisma-schema PGlite migration drift guard', () => {
  let tempDir: string;
  const tsxBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-prisma-schema-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses CLI flags and formats actionable remediation messages', () => {
    expect(typeof checkPrismaSchema).toBe('function');
    expect(
      parsePrismaCheckArgs([
        '--schema',
        'tmp/schema.prisma',
        '--migrations',
        'prisma/migrations',
        '--skip-validate',
        '--skip-generate',
        '--quiet',
      ]),
    ).toEqual({
      schemaPath: 'tmp/schema.prisma',
      migrationsPath: 'prisma/migrations',
      skipValidate: true,
      skipGenerate: true,
      quiet: true,
    });

    const driftMessage = formatPrismaCheckFailure({
      ok: false,
      exitCode: 2,
      driftSql: 'ALTER TABLE "ContentNode" ADD COLUMN "drift" TEXT;',
      errorOutput: 'Unmigrated Prisma schema drift detected',
    });
    expect(driftMessage).toContain(
      'ALTER TABLE "ContentNode" ADD COLUMN "drift" TEXT;',
    );
    expect(driftMessage).toContain('npm run migrate:dev');
  });

  it('exits 0 when prisma/migrations and prisma/schema.prisma are reconciled', () => {
    const res = spawnSync(
      tsxBin,
      ['scripts/check-prisma-schema.ts', '--skip-generate'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      'Prisma schema validation, client generation, and migration sync check passed',
    );
  }, 20000);

  it('exits non-zero and instructs developer to run npm run migrate:dev when schema has unmigrated edits', () => {
    const baseSchema = fs.readFileSync(
      path.join(process.cwd(), 'prisma/schema.prisma'),
      'utf8',
    );
    const driftedSchemaPath = path.join(tempDir, 'schema.prisma');
    fs.writeFileSync(
      driftedSchemaPath,
      baseSchema.replace(
        'model ContentNode {',
        'model ContentNode {\n  unmigratedTestColumn String @default("drift")',
      ),
      'utf8',
    );

    const res = spawnSync(
      tsxBin,
      [
        'scripts/check-prisma-schema.ts',
        '--schema',
        driftedSchemaPath,
        '--skip-validate',
        '--skip-generate',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('unmigratedTestColumn');
    expect(res.stderr).toContain('npm run migrate:dev');
  }, 20000);

  it('verifies readiness manifest covers all 18 schema models and all 49 migration directories', () => {
    expect(REQUIRED_SCHEMA_TABLES).toHaveLength(18);
    expect(REQUIRED_MIGRATION_NAMES).toHaveLength(49);
    expect(verifyReadinessManifestParity({ cwd: process.cwd() })).toEqual([]);

    const missingTableIssues = verifyReadinessManifestParity({
      cwd: process.cwd(),
      requiredTables: REQUIRED_SCHEMA_TABLES.filter(
        (table) => table !== 'AuthLockout',
      ),
    });
    expect(missingTableIssues).toEqual([
      expect.stringContaining('AuthLockout'),
    ]);

    const missingMigration = '20261123020000_add_plus_one_seat_numbers';
    const missingMigrationIssues = verifyReadinessManifestParity({
      cwd: process.cwd(),
      requiredMigrations: REQUIRED_MIGRATION_NAMES.filter(
        (migration) => migration !== missingMigration,
      ),
    });
    expect(missingMigrationIssues).toEqual([
      expect.stringContaining(missingMigration),
    ]);
  });

  it('exits non-zero when prisma/migrations contains a directory omitted from readinessManifest', () => {
    const copiedMigrationsDir = path.join(tempDir, 'migrations');
    fs.cpSync(
      path.join(process.cwd(), 'prisma/migrations'),
      copiedMigrationsDir,
      {
        recursive: true,
      },
    );
    const extraMigrationDir = path.join(
      copiedMigrationsDir,
      '20261231000000_unregistered_manifest_migration',
    );
    fs.mkdirSync(extraMigrationDir, { recursive: true });
    fs.writeFileSync(
      path.join(extraMigrationDir, 'migration.sql'),
      '-- no-op test migration\n',
    );

    const res = spawnSync(
      tsxBin,
      [
        'scripts/check-prisma-schema.ts',
        '--migrations',
        copiedMigrationsDir,
        '--skip-validate',
        '--skip-generate',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Readiness manifest drift detected');
    expect(res.stderr).toContain(
      '20261231000000_unregistered_manifest_migration',
    );
    expect(res.stderr).toContain('src/lib/readinessManifest.ts');
  }, 25000);
});
