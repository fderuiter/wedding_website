import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const lockfilePath = path.join(rootDir, 'package-lock.json');
const hashCacheDir = path.join(rootDir, 'node_modules');
const hashCachePath = path.join(hashCacheDir, '.package-lock-hash');
const pretestCacheDir = path.join(hashCacheDir, '.cache');
const pretestStatePath = path.join(pretestCacheDir, 'pretest-state.json');
const prismaSchemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
const prismaMigrationsDir = path.join(rootDir, 'prisma', 'migrations');

function computeFileSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listCommittedMigrationNames() {
  if (!fs.existsSync(prismaMigrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(prismaMigrationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(prismaMigrationsDir, entry.name, 'migration.sql'))
    )
    .map((entry) => entry.name)
    .sort();
}

function computeMigrationsAndSchemaHash() {
  if (!fs.existsSync(prismaSchemaPath)) {
    return '';
  }
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(prismaSchemaPath));
  for (const migrationName of listCommittedMigrationNames()) {
    hash.update(`\n--migration:${migrationName}--\n`);
    hash.update(fs.readFileSync(path.join(prismaMigrationsDir, migrationName, 'migration.sql')));
  }
  return hash.digest('hex');
}

function readPretestState() {
  if (!fs.existsSync(pretestStatePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(pretestStatePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePretestState(state) {
  try {
    fs.mkdirSync(pretestCacheDir, { recursive: true });
    fs.writeFileSync(pretestStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // Non-fatal cache write failure
  }
}

function hasGeneratedPrismaClient() {
  return (
    fs.existsSync(path.join(rootDir, 'node_modules', '.prisma', 'client', 'index.js')) &&
    fs.existsSync(path.join(rootDir, 'node_modules', '@prisma', 'client'))
  );
}

function recordInstallState() {
  const lockHash = computeFileSha256(lockfilePath);
  if (lockHash) {
    fs.mkdirSync(hashCacheDir, { recursive: true });
    fs.writeFileSync(hashCachePath, lockHash, 'utf8');
  }

  const schemaHash = computeFileSha256(prismaSchemaPath);
  if (schemaHash && hasGeneratedPrismaClient()) {
    const state = readPretestState();
    state.prismaClientSchemaHash = schemaHash;
    writePretestState(state);
  }
}

// Helper to run a command and inherit streams or fail
function runCommand(command, args, options = {}) {
  const { ignoreFailure = false, ...spawnOptions } = options;
  const result = child_process.spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...spawnOptions,
  });
  if (result.status !== 0) {
    const errorMsg = `Command failed: ${command} ${args.join(' ')}`;
    console.error(errorMsg);
    if (!ignoreFailure) {
      process.exit(result.status || 1);
    }
  }
}

function parseTargetSchemaName(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return parsed.searchParams.get('schema') || 'public';
  } catch {
    return 'public';
  }
}

async function probeDatabaseState(connectionString, expectedMigrations) {
  let client;
  try {
    const pgModule = await import('pg');
    const Client = pgModule.default?.Client || pgModule.Client;
    client = new Client({
      connectionString,
      connectionTimeoutMillis: 1500,
    });
    await client.connect();
    const targetSchema = parseTargetSchemaName(connectionString);
    const tablesRes = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ($2, $3)',
      [targetSchema, 'AppConfig', '_prisma_migrations']
    );
    const tableNames = new Set((tablesRes?.rows || []).map((row) => row.table_name));
    const hasAppConfigTable = tableNames.has('AppConfig');
    let allMigrationsApplied = false;

    if (
      hasAppConfigTable &&
      tableNames.has('_prisma_migrations') &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(targetSchema)
    ) {
      const escapedSchema = targetSchema.replace(/"/g, '""');
      const migRes = await client.query(
        `SELECT migration_name FROM "${escapedSchema}"."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
      );
      const appliedSet = new Set((migRes?.rows || []).map((row) => row.migration_name));
      allMigrationsApplied = expectedMigrations.every((name) => appliedSet.has(name));
    }

    return {
      serverReachable: true,
      hasAppConfigTable,
      allMigrationsApplied,
    };
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    // A 5-character SQLSTATE code (e.g. 3D000 missing database) indicates Postgres is accepting connections
    const serverReachable = /^[0-9A-Z]{5}$/.test(code);
    return {
      serverReachable,
      hasAppConfigTable: false,
      allMigrationsApplied: false,
    };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

async function ensureLocalDockerPostgresReady() {
  let dockerRunning = false;
  try {
    const docInfo = child_process.spawnSync('docker', ['info'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    if (docInfo.status === 0) {
      dockerRunning = true;
    }
  } catch {
    // Docker command not found or not running
  }

  if (!dockerRunning) {
    console.log('Docker command not found or daemon not running. Skipping database container auto-start.');
    return;
  }

  console.log('Ensuring local PostgreSQL database container is running...');
  const ciComposeArgs = [
    'compose',
    '--env-file',
    '.env.ci',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.ci.yml',
  ];
  const ciComposeEnv = {
    ...process.env,
    DB_USER: process.env.DB_USER || 'wedding',
    DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123',
    DB_NAME: process.env.DB_NAME || 'wedding',
    ADMIN_PASSWORD:
      process.env.ADMIN_PASSWORD ||
      'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
    GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'build-fallback-guest-passcode',
    GUEST_SESSION_SECRET:
      process.env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min',
  };
  const startResult = child_process.spawnSync('docker', [...ciComposeArgs, 'up', '-d', 'db'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: ciComposeEnv,
  });

  if (startResult.status !== 0) {
    console.warn('Failed to start database container via docker compose. Proceeding assuming database is already running...');
    return;
  }

  console.log('Waiting for database to be ready...');
  let ready = false;
  for (let i = 0; i < 15; i++) {
    try {
      const check = child_process.spawnSync(
        'docker',
        [...ciComposeArgs, 'exec', '-T', 'db', 'pg_isready', '-U', 'wedding'],
        {
          stdio: 'ignore',
          shell: process.platform === 'win32',
          cwd: rootDir,
          env: ciComposeEnv,
        }
      );
      if (check.status === 0) {
        ready = true;
        console.log('Database is ready.');
        break;
      }
    } catch {
      // Ignored
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    console.log('Database was not ready in time, proceeding anyway...');
  }
}

async function applyTestDatabaseMigrations(testDbUrl) {
  const parsedTestUrl = new URL(testDbUrl);
  const targetDbName = decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ''));
  const targetSchema = parsedTestUrl.searchParams.get('schema') || 'public';
  const isIsolatedTestDb =
    targetDbName === 'wedding_test' ||
    targetDbName.endsWith('_test') ||
    targetDbName.startsWith('wedding_test_');

  if (isIsolatedTestDb && /^[A-Za-z0-9_-]+$/.test(targetDbName)) {
    try {
      const pgModule = await import('pg');
      const Client = pgModule.default?.Client || pgModule.Client;
      const adminUrl = new URL(testDbUrl);
      adminUrl.pathname = '/postgres';
      adminUrl.search = '';
      const adminClient = new Client({ connectionString: adminUrl.toString() });
      await adminClient.connect();
      try {
        const existsResult = await adminClient.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [targetDbName]
        );
        if (existsResult.rowCount === 0) {
          const escapedDb = targetDbName.replace(/"/g, '""');
          await adminClient.query(`CREATE DATABASE "${escapedDb}"`);
        }
      } finally {
        await adminClient.end();
      }
    } catch {
      // Database may be unreachable when running unit-only suites without Docker; let Prisma report if needed
    }
  }

  console.log('Applying Prisma migrations to isolated test database (provider: postgresql)...');

  const migrateEnv = { ...process.env, DATABASE_URL: testDbUrl };
  delete migrateEnv.POSTGRES_URL_NON_POOLING;

  const migrateResult = child_process.spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: migrateEnv,
  });

  const migrateStdout = migrateResult.stdout ? migrateResult.stdout.toString() : '';
  const migrateStderr = migrateResult.stderr ? migrateResult.stderr.toString() : '';
  if (migrateStdout) process.stdout.write(migrateStdout);
  if (migrateStderr) process.stderr.write(migrateStderr);

  if (migrateResult.status !== 0) {
    const combinedMigrateOutput = `${migrateStdout}\n${migrateStderr}`;
    if (
      /\bP3005\b/.test(combinedMigrateOutput) &&
      isIsolatedTestDb &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(targetSchema)
    ) {
      console.warn(
        `Detected unbaselined schema "${targetSchema}" in "${targetDbName}" from prior local "prisma db push" state (P3005). Resetting "${targetSchema}" schema and retrying "npx prisma migrate deploy"...`
      );
      const pgModule = await import('pg');
      const Client = pgModule.default?.Client || pgModule.Client;
      const resetClient = new Client({ connectionString: testDbUrl });
      await resetClient.connect();
      try {
        const escapedSchema = targetSchema.replace(/"/g, '""');
        await resetClient.query(`DROP SCHEMA IF EXISTS "${escapedSchema}" CASCADE`);
        await resetClient.query(`CREATE SCHEMA "${escapedSchema}"`);
        await resetClient.query(`GRANT ALL ON SCHEMA "${escapedSchema}" TO CURRENT_USER`);
        await resetClient.query(`GRANT ALL ON SCHEMA "${escapedSchema}" TO PUBLIC`);
      } finally {
        await resetClient.end();
      }

      runCommand('npx', ['prisma', 'migrate', 'deploy'], {
        env: migrateEnv,
      });
    } else {
      console.error('Command failed: npx prisma migrate deploy');
      process.exit(migrateResult.status || 1);
    }
  }
}

async function main() {
  if (process.argv.includes('--record-install-state')) {
    recordInstallState();
    return;
  }

  // 1. Verify dependency alignment
  let needsInstall = false;

  if (!fs.existsSync(hashCacheDir)) {
    needsInstall = true;
  } else if (fs.existsSync(lockfilePath)) {
    const currentHash = computeFileSha256(lockfilePath);
    let cachedHash = '';
    if (fs.existsSync(hashCachePath)) {
      cachedHash = fs.readFileSync(hashCachePath, 'utf8').trim();
    }
    if (currentHash !== cachedHash) {
      needsInstall = true;
    }
  }

  if (needsInstall) {
    console.log('Local dependencies out of sync or missing. Performing clean installation...');
    const result = child_process.spawnSync('npm', ['ci'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    if (result.status !== 0) {
      console.error('Dependency installation failed!');
      if (result.stdout) console.error(result.stdout.toString());
      if (result.stderr) console.error(result.stderr.toString());
      process.exit(result.status || 1);
    }

    recordInstallState();
    console.log('Dependency installation completed successfully.');
  }

  // 2. Always reset Jest accessibility violations before Jest executes
  const testResultsDir = path.join(rootDir, 'test-results');
  fs.mkdirSync(testResultsDir, { recursive: true });
  fs.writeFileSync(path.join(testResultsDir, 'jest-a11y-violations.json'), '[]\n', 'utf8');

  // 3. Strict Test Environment Isolation with explicit TEST_DATABASE_URL override support
  const explicitTestDbUrl = (process.env.TEST_DATABASE_URL || '').trim();
  const envPath = path.join(rootDir, '.env.test');

  const pgVars = [
    'DATABASE_URL',
    'POSTGRES_URL_NON_POOLING',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
    'PGHOST',
    'PGPORT',
    'PGDATASOURCE',
    'ADMIN_PASSWORD',
  ];
  for (const v of pgVars) {
    delete process.env[v];
  }

  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Fallback if error reading file
    }
  }

  const configuredTestDbOverride = explicitTestDbUrl || (process.env.TEST_DATABASE_URL || '').trim();
  const hasExplicitTestDbOverride = Boolean(configuredTestDbOverride);
  const testDbUrl = configuredTestDbOverride || process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

  process.env.DATABASE_URL = testDbUrl;
  if (hasExplicitTestDbOverride) {
    process.env.TEST_DATABASE_URL = configuredTestDbOverride;
  }

  // 4. Probe external database readiness before starting local Docker container
  const expectedMigrations = listCommittedMigrationNames();
  const dbProbe = await probeDatabaseState(testDbUrl, expectedMigrations);
  if (!dbProbe.serverReachable && !hasExplicitTestDbOverride) {
    await ensureLocalDockerPostgresReady();
  }

  // 5. Synchronize Prisma migrations and generate Prisma Client only when invalidated
  const schemaHash = computeFileSha256(prismaSchemaPath);
  const migrationsHash = computeMigrationsAndSchemaHash();
  const state = readPretestState();

  const isDbSchemaCached =
    dbProbe.hasAppConfigTable &&
    dbProbe.allMigrationsApplied &&
    Boolean(migrationsHash) &&
    state.dbSync?.schemaHash === migrationsHash &&
    state.dbSync?.testDbUrl === testDbUrl;

  if (!isDbSchemaCached) {
    await applyTestDatabaseMigrations(testDbUrl);
    state.dbSync = { schemaHash: migrationsHash, testDbUrl };
    writePretestState(state);
  }

  const isPrismaClientCached =
    hasGeneratedPrismaClient() &&
    Boolean(schemaHash) &&
    state.prismaClientSchemaHash === schemaHash;

  if (!isPrismaClientCached) {
    console.log('Generating Prisma Client...');
    runCommand('npm', ['run', 'prisma:generate']);
    state.prismaClientSchemaHash = schemaHash;
    writePretestState(state);
  }
}

main().catch((err) => {
  console.error('Pretest preflight script failed with error:', err);
  process.exit(1);
});
