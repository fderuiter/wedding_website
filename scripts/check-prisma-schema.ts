import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { PGlite } from '@electric-sql/pglite';
import {
  REQUIRED_MIGRATION_NAMES,
  REQUIRED_SCHEMA_TABLES,
} from '../src/lib/readinessManifest';

interface PGLiteSocketServerOptions {
  db: PGlite;
  port?: number;
  host?: string;
  path?: string;
  inspect?: boolean;
  debug?: boolean;
  idleTimeout?: number;
  maxConnections?: number;
}

interface PGLiteSocketServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  getServerConn(): string;
}

interface PGLiteSocketModule {
  PGLiteSocketServer: new (_options: PGLiteSocketServerOptions) => PGLiteSocketServerInstance;
}

const require = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket') as PGLiteSocketModule;

const PLACEHOLDER_PRIMARY_URL =
  'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?sslmode=disable';

export interface PrismaCheckOptions {
  cwd?: string;
  schemaPath?: string;
  migrationsPath?: string;
  skipValidate?: boolean;
  skipGenerate?: boolean;
  quiet?: boolean;
  requiredTables?: readonly string[];
  requiredMigrations?: readonly string[];
}

export interface PrismaCheckResult {
  ok: boolean;
  exitCode: number;
  driftSql: string;
  errorOutput: string;
}

interface SpawnCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function resolvePrismaCommand(cwd: string): { command: string; prefixArgs: string[] } {
  const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const localBin = path.join(cwd, 'node_modules', '.bin', binName);
  if (fs.existsSync(localBin)) {
    return { command: localBin, prefixArgs: [] };
  }
  return { command: 'npx', prefixArgs: ['prisma'] };
}

function spawnAsync(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<SpawnCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

interface PGliteConstructorOptions {
  loadDataDir?: Blob;
  relaxedDurability?: boolean;
}

async function createFastPgliteInstance(cwd: string): Promise<PGlite> {
  const cacheFile = path.join(cwd, 'node_modules', '.cache', 'pglite', 'empty-cluster.tar');
  if (fs.existsSync(cacheFile)) {
    try {
      const cachedBuffer = fs.readFileSync(cacheFile);
      const db = new PGlite({
        loadDataDir: new Blob([cachedBuffer]),
        relaxedDurability: true,
      } as PGliteConstructorOptions);
      await db.waitReady;
      return db;
    } catch {
      // Fall back to fresh initialization if cached snapshot is stale or corrupted
    }
  }

  const db = new PGlite({ relaxedDurability: true } as PGliteConstructorOptions);
  await db.waitReady;
  try {
    const dumpBlob = await db.dumpDataDir('none');
    const dumpBuffer = Buffer.from(await dumpBlob.arrayBuffer());
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmpFile = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, dumpBuffer);
    fs.renameSync(tmpFile, cacheFile);
  } catch {
    // Non-fatal if node_modules/.cache is read-only
  }
  return db;
}

async function startPgliteShadowServer(cwd: string): Promise<{
  db: PGlite;
  server: PGLiteSocketServerInstance;
  shadowUrl: string;
}> {
  const db = await createFastPgliteInstance(cwd);
  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 10,
  });
  await server.start();
  const shadowUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  return { db, server, shadowUrl };
}

function extractSchemaTableNames(schemaRaw: string): string[] {
  const tables: string[] = [];
  const modelBlockRegex = /^model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelBlockRegex.exec(schemaRaw)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/);
    tables.push(mapMatch ? mapMatch[1] : modelName);
  }
  return tables;
}

function listMigrationDirectoryNames(migrationsDirAbs: string): string[] {
  if (!fs.existsSync(migrationsDirAbs)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDirAbs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function findDuplicates(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      duplicates.add(item);
    }
    seen.add(item);
  }
  return Array.from(duplicates);
}

export function verifyReadinessManifestParity(options: {
  cwd?: string;
  schemaPath?: string;
  migrationsPath?: string;
  requiredTables?: readonly string[];
  requiredMigrations?: readonly string[];
} = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const schemaAbsPath = path.resolve(cwd, options.schemaPath ?? 'prisma/schema.prisma');
  const migrationsAbsPath = path.resolve(cwd, options.migrationsPath ?? 'prisma/migrations');
  const manifestTables = options.requiredTables ?? REQUIRED_SCHEMA_TABLES;
  const manifestMigrations = options.requiredMigrations ?? REQUIRED_MIGRATION_NAMES;

  const issues: string[] = [];

  if (!fs.existsSync(schemaAbsPath)) {
    issues.push(`Prisma schema file not found at ${schemaAbsPath}.`);
    return issues;
  }

  const schemaRaw = fs.readFileSync(schemaAbsPath, 'utf8');
  const expectedTables = extractSchemaTableNames(schemaRaw);
  const manifestTableSet = new Set(manifestTables);
  const expectedTableSet = new Set(expectedTables);

  const missingTables = expectedTables.filter((table) => !manifestTableSet.has(table));
  const extraTables = manifestTables.filter((table) => !expectedTableSet.has(table));
  const duplicateTables = findDuplicates(manifestTables);

  if (missingTables.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_SCHEMA_TABLES omits Prisma schema model table(s): ${missingTables.join(', ')}`
    );
  }
  if (extraTables.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_SCHEMA_TABLES contains stale table(s) absent from prisma/schema.prisma: ${extraTables.join(', ')}`
    );
  }
  if (duplicateTables.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_SCHEMA_TABLES contains duplicate table entry/entries: ${duplicateTables.join(', ')}`
    );
  }

  const expectedMigrations = listMigrationDirectoryNames(migrationsAbsPath);
  const manifestMigrationSet = new Set(manifestMigrations);
  const expectedMigrationSet = new Set(expectedMigrations);

  const missingMigrations = expectedMigrations.filter(
    (migrationName) => !manifestMigrationSet.has(migrationName)
  );
  const extraMigrations = manifestMigrations.filter(
    (migrationName) => !expectedMigrationSet.has(migrationName)
  );
  const duplicateMigrations = findDuplicates(manifestMigrations);

  if (missingMigrations.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_MIGRATION_NAMES omits migration directory/directories: ${missingMigrations.join(', ')}`
    );
  }
  if (extraMigrations.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_MIGRATION_NAMES contains stale migration(s) absent from prisma/migrations: ${extraMigrations.join(', ')}`
    );
  }
  if (duplicateMigrations.length > 0) {
    issues.push(
      `Readiness manifest REQUIRED_MIGRATION_NAMES contains duplicate migration entry/entries: ${duplicateMigrations.join(', ')}`
    );
  }

  const readyRouteAbsPath = path.join(cwd, 'src', 'app', 'api', 'ready', 'route.ts');
  if (fs.existsSync(readyRouteAbsPath)) {
    const readyRouteRaw = fs.readFileSync(readyRouteAbsPath, 'utf8');
    if (
      !readyRouteRaw.includes('REQUIRED_SCHEMA_TABLES') ||
      !readyRouteRaw.includes('REQUIRED_MIGRATION_NAMES') ||
      !readyRouteRaw.includes('readinessManifest')
    ) {
      issues.push(
        'src/app/api/ready/route.ts must import and enforce REQUIRED_SCHEMA_TABLES and REQUIRED_MIGRATION_NAMES from @/lib/readinessManifest.'
      );
    }
  }

  return issues;
}

export async function checkPrismaSchema(
  options: PrismaCheckOptions = {}
): Promise<PrismaCheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const schemaPath = options.schemaPath ?? 'prisma/schema.prisma';
  const migrationsPath = options.migrationsPath ?? 'prisma/migrations';
  const quiet = options.quiet ?? false;

  const { command, prefixArgs } = resolvePrismaCommand(cwd);
  const log = (...args: unknown[]) => {
    if (!quiet) {
      console.log(...args);
    }
  };

  log('🔍 Validating Prisma schema, generating Prisma Client, and checking migration drift...');

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: PLACEHOLDER_PRIMARY_URL,
  };
  delete baseEnv.POSTGRES_URL_NON_POOLING;

  const validatePromise = options.skipValidate
    ? Promise.resolve<SpawnCommandResult>({ exitCode: 0, stdout: '', stderr: '' })
    : spawnAsync(command, [...prefixArgs, 'validate'], { cwd, env: baseEnv });

  const generatePromise = options.skipGenerate
    ? Promise.resolve<SpawnCommandResult>({ exitCode: 0, stdout: '', stderr: '' })
    : spawnAsync(command, [...prefixArgs, 'generate'], { cwd, env: baseEnv });

  const diffTaskPromise = (async (): Promise<{
    diffCheckRes: SpawnCommandResult;
    driftSql: string;
  }> => {
    const pgliteHandle = await startPgliteShadowServer(cwd);
    try {
      const diffEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: PLACEHOLDER_PRIMARY_URL,
        POSTGRES_URL_NON_POOLING: pgliteHandle.shadowUrl,
      };

      const diffCheckRes = await spawnAsync(
        command,
        [
          ...prefixArgs,
          'migrate',
          'diff',
          '--from-migrations',
          migrationsPath,
          '--to-schema',
          schemaPath,
          '--exit-code',
        ],
        { cwd, env: diffEnv }
      );

      let driftSql = '';
      if (diffCheckRes.exitCode === 2) {
        const scriptRes = await spawnAsync(
          command,
          [
            ...prefixArgs,
            'migrate',
            'diff',
            '--from-migrations',
            migrationsPath,
            '--to-schema',
            schemaPath,
            '--script',
          ],
          { cwd, env: diffEnv }
        );
        driftSql = scriptRes.stdout.trim();
      }

      return { diffCheckRes, driftSql };
    } finally {
      await pgliteHandle.server.stop().catch(() => undefined);
      await pgliteHandle.db.close().catch(() => undefined);
    }
  })();

  const [validateRes, generateRes, { diffCheckRes, driftSql }] = await Promise.all([
    validatePromise,
    generatePromise,
    diffTaskPromise,
  ]);

  if (validateRes.exitCode !== 0) {
    return {
      ok: false,
      exitCode: validateRes.exitCode,
      driftSql: '',
      errorOutput: `${validateRes.stdout}\n${validateRes.stderr}`.trim(),
    };
  }
  if (validateRes.stdout.trim()) {
    log(validateRes.stdout.trim());
  }

  if (generateRes.exitCode !== 0) {
    return {
      ok: false,
      exitCode: generateRes.exitCode,
      driftSql: '',
      errorOutput: `${generateRes.stdout}\n${generateRes.stderr}`.trim(),
    };
  }
  if (generateRes.stdout.trim()) {
    log(generateRes.stdout.trim());
  }

  if (diffCheckRes.exitCode === 0) {
    const manifestIssues = verifyReadinessManifestParity({
      cwd,
      schemaPath,
      migrationsPath,
      requiredTables: options.requiredTables,
      requiredMigrations: options.requiredMigrations,
    });
    if (manifestIssues.length > 0) {
      return {
        ok: false,
        exitCode: 1,
        driftSql: '',
        errorOutput: [
          'Readiness manifest drift detected in src/lib/readinessManifest.ts:',
          ...manifestIssues.map((issue) => `  - ${issue}`),
        ].join('\n'),
      };
    }

    log(
      '✅ Prisma schema validation, client generation, and migration sync check passed (readiness manifest verified)!'
    );
    return {
      ok: true,
      exitCode: 0,
      driftSql: '',
      errorOutput: '',
    };
  }

  if (diffCheckRes.exitCode === 2) {
    return {
      ok: false,
      exitCode: 2,
      driftSql,
      errorOutput:
        'Unmigrated Prisma schema drift detected between prisma/migrations and prisma/schema.prisma.',
    };
  }

  return {
    ok: false,
    exitCode: diffCheckRes.exitCode,
    driftSql: '',
    errorOutput: `${diffCheckRes.stdout}\n${diffCheckRes.stderr}`.trim(),
  };
}

export function parsePrismaCheckArgs(argv: string[]): PrismaCheckOptions {
  const opts: PrismaCheckOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--schema' && argv[i + 1]) {
      opts.schemaPath = argv[++i];
    } else if (arg === '--migrations' && argv[i + 1]) {
      opts.migrationsPath = argv[++i];
    } else if (arg === '--skip-validate') {
      opts.skipValidate = true;
    } else if (arg === '--skip-generate') {
      opts.skipGenerate = true;
    } else if (arg === '--quiet') {
      opts.quiet = true;
    }
  }
  return opts;
}

export function formatPrismaCheckFailure(result: PrismaCheckResult): string {
  const sections: string[] = ['\n❌ Prisma schema or migration check failed:\n'];
  if (result.errorOutput) {
    sections.push(result.errorOutput);
  }
  if (result.driftSql) {
    sections.push('\n--- Unmigrated SQL DDL Drift ---');
    sections.push(result.driftSql);
    sections.push('--------------------------------');
  }

  if (result.exitCode === 2) {
    sections.push(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Unmigrated edits were detected in prisma/schema.prisma relative to
   prisma/migrations.
2. Run 'npm run migrate:dev' against your local PostgreSQL database to record a
   new migration file in prisma/migrations/, then run 'npm run lint:migrations'.
3. Once reconciled, re-run 'npm run check:prisma' to verify zero schema drift.
================================================================================
`);
  } else if (result.errorOutput.includes('Readiness manifest drift detected')) {
    sections.push(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Update REQUIRED_SCHEMA_TABLES and REQUIRED_MIGRATION_NAMES in
   src/lib/readinessManifest.ts so GET /api/ready checks every persisted model
   in prisma/schema.prisma and every committed directory in prisma/migrations/.
2. Re-run 'npm run check:prisma' to verify readiness manifest parity.
================================================================================
`);
  } else {
    sections.push(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Inspect prisma/schema.prisma and prisma/migrations/ for syntax errors,
   missing field mappings, or invalid SQL migration statements.
2. Run 'npx prisma validate' or 'npm run migrate:dev' locally to diagnose errors.
3. Once corrected, run 'npm run prisma:generate' to update Prisma Client.
================================================================================
`);
  }

  return sections.join('\n');
}

async function main(): Promise<void> {
  try {
    const cliOptions = parsePrismaCheckArgs(process.argv.slice(2));
    const result = await checkPrismaSchema(cliOptions);
    if (result.ok) {
      process.exit(0);
    }

    console.error(formatPrismaCheckFailure(result));
    process.exit(1);
  } catch (error: unknown) {
    console.error('\n❌ Unexpected Prisma schema check failure:\n', error);
    process.exit(1);
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('check-prisma-schema.ts') ||
    process.argv[1].endsWith('check-prisma-schema.js'));

if (isDirectExecution) {
  void main();
}
