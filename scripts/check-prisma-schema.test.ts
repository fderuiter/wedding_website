/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  checkPrismaSchema,
  formatPrismaCheckFailure,
  parsePrismaCheckArgs,
} from './check-prisma-schema';

describe('check-prisma-schema PGlite migration drift guard', () => {
  let tempDir: string;
  const tsxBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
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
      ])
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
    expect(driftMessage).toContain('ALTER TABLE "ContentNode" ADD COLUMN "drift" TEXT;');
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
      }
    );

    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      'Prisma schema validation, client generation, and migration sync check passed'
    );
  }, 20000);

  it('exits non-zero and instructs developer to run npm run migrate:dev when schema has unmigrated edits', () => {
    const baseSchema = fs.readFileSync(
      path.join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    );
    const driftedSchemaPath = path.join(tempDir, 'schema.prisma');
    fs.writeFileSync(
      driftedSchemaPath,
      baseSchema.replace(
        'model ContentNode {',
        'model ContentNode {\n  unmigratedTestColumn String @default("drift")'
      ),
      'utf8'
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
      }
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('unmigratedTestColumn');
    expect(res.stderr).toContain('npm run migrate:dev');
  }, 20000);
});
