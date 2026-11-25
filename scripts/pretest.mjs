import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const defaultRootDir = path.resolve(path.dirname(SCRIPT_FILE), '..');

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

const ISOLATED_PG_ENV_VARS = [
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

function computeFileSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getPretestStatePath(rootDir = defaultRootDir) {
  return path.join(rootDir, 'node_modules', '.cache', 'pretest-state.json');
}

function readPretestState(rootDir = defaultRootDir) {
  const pretestStatePath = getPretestStatePath(rootDir);
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

function writePretestState(state, rootDir = defaultRootDir) {
  try {
    const pretestStatePath = getPretestStatePath(rootDir);
    fs.mkdirSync(path.dirname(pretestStatePath), { recursive: true });
    fs.writeFileSync(pretestStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // Non-fatal cache write failure
  }
}

function listCommittedMigrationNames(rootDir = defaultRootDir) {
  const prismaMigrationsDir = path.join(rootDir, 'prisma', 'migrations');
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

function computeMigrationsAndSchemaHash(rootDir = defaultRootDir) {
  const prismaSchemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  if (!fs.existsSync(prismaSchemaPath)) {
    return '';
  }
  const prismaMigrationsDir = path.join(rootDir, 'prisma', 'migrations');
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(prismaSchemaPath));
  for (const migrationName of listCommittedMigrationNames(rootDir)) {
    hash.update(`\n--migration:${migrationName}--\n`);
    hash.update(fs.readFileSync(path.join(prismaMigrationsDir, migrationName, 'migration.sql')));
  }
  return hash.digest('hex');
}

export function isCiEnv(env) {
  const targetEnv = env ?? process.env;
  const rawCi = String(targetEnv.CI ?? '').trim().toLowerCase();
  return rawCi === 'true' || rawCi === '1';
}

export function isDatabaseRequired(options = {}) {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const rawRequireDb = String(env.CI_REQUIRE_DB ?? '').trim().toLowerCase();
  if (rawRequireDb === 'true' || rawRequireDb === '1') {
    return true;
  }
  return Array.isArray(argv) && argv.includes('--require-db');
}

export function shouldInstallDependencies(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const env = options.env ?? process.env;
  const lockfilePath = path.join(rootDir, 'package-lock.json');
  const hashCacheDir = path.join(rootDir, 'node_modules');
  const npmLockMarkerPath = path.join(hashCacheDir, '.package-lock.json');
  const hashCachePath = path.join(hashCacheDir, '.package-lock-hash');

  if (!fs.existsSync(hashCacheDir)) {
    return true;
  }

  if (isCiEnv(env) && fs.existsSync(npmLockMarkerPath)) {
    return false;
  }

  if (!fs.existsSync(lockfilePath)) {
    return false;
  }

  const currentHash = computeFileSha256(lockfilePath);

  let cachedHash = '';
  if (fs.existsSync(hashCachePath)) {
    cachedHash = fs.readFileSync(hashCachePath, 'utf8').trim();
  }

  return currentHash !== cachedHash;
}

export function writeLockfileHash(rootDir = defaultRootDir) {
  const lockfilePath = path.join(rootDir, 'package-lock.json');
  const hashCacheDir = path.join(rootDir, 'node_modules');
  const hashCachePath = path.join(hashCacheDir, '.package-lock-hash');

  if (fs.existsSync(lockfilePath)) {
    const currentHash = computeFileSha256(lockfilePath);
    fs.mkdirSync(hashCacheDir, { recursive: true });
    fs.writeFileSync(hashCachePath, currentHash, 'utf8');
    return currentHash;
  }
  return null;
}

function matchesLockConstraintList(list, value) {
  if (!Array.isArray(list) || list.length === 0) {
    return true;
  }
  const positives = list.filter((entry) => typeof entry === 'string' && !entry.startsWith('!'));
  const negatives = list
    .filter((entry) => typeof entry === 'string' && entry.startsWith('!'))
    .map((entry) => entry.slice(1));
  if (negatives.includes(value)) {
    return false;
  }
  if (positives.length > 0 && !positives.includes(value)) {
    return false;
  }
  return true;
}

function isLockNodeHostCompatible(node, platform, arch) {
  if (!node || !node.optional) {
    return true;
  }
  return (
    matchesLockConstraintList(node.os, platform) && matchesLockConstraintList(node.cpu, arch)
  );
}

function removeEmptyModuleAncestors(targetDir, nodeModulesRoot) {
  let currentDir = path.dirname(targetDir);
  const resolvedStop = path.resolve(nodeModulesRoot);
  while (currentDir.startsWith(resolvedStop) && path.resolve(currentDir) !== resolvedStop) {
    try {
      const remaining = fs.readdirSync(currentDir);
      if (remaining.length > 0) {
        break;
      }
      fs.rmdirSync(currentDir);
    } catch {
      break;
    }
    currentDir = path.dirname(currentDir);
  }
}

export function pruneUnreachableOptionalPackages(rootDir = defaultRootDir, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (arch === 'wasm32') {
    return [];
  }

  const lockfilePath = path.join(rootDir, 'package-lock.json');
  const nodeModulesDir = path.join(rootDir, 'node_modules');
  if (!fs.existsSync(lockfilePath) || !fs.existsSync(nodeModulesDir)) {
    return [];
  }

  let lockData;
  try {
    lockData = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  } catch {
    return [];
  }
  const packages = lockData && typeof lockData === 'object' ? lockData.packages : null;
  if (!packages || typeof packages !== 'object') {
    return [];
  }

  const reachable = new Set(['']);
  const queue = [''];
  while (queue.length > 0) {
    const cur = queue.shift();
    const node = packages[cur];
    if (!node || typeof node !== 'object') {
      continue;
    }
    const depMap = {
      ...(node.dependencies ?? {}),
      ...(node.devDependencies ?? {}),
      ...(node.optionalDependencies ?? {}),
      ...(node.peerDependencies ?? {}),
    };
    for (const depName of Object.keys(depMap)) {
      let cursor = cur;
      while (true) {
        const candidate = `${cursor ? `${cursor}/` : ''}node_modules/${depName}`;
        const candidateNode = packages[candidate];
        if (candidateNode) {
          if (
            isLockNodeHostCompatible(candidateNode, platform, arch) &&
            !reachable.has(candidate)
          ) {
            reachable.add(candidate);
            queue.push(candidate);
          }
          break;
        }
        const parentIdx = cursor.lastIndexOf('/node_modules/');
        if (parentIdx !== -1) {
          cursor = cursor.slice(0, parentIdx);
        } else if (cursor.startsWith('node_modules/')) {
          cursor = '';
        } else {
          break;
        }
      }
    }
  }

  const unreachableOptionalPaths = Object.entries(packages)
    .filter(([pkgPath, pkgNode]) => Boolean(pkgPath) && pkgNode?.optional === true && !reachable.has(pkgPath))
    .map(([pkgPath]) => pkgPath)
    .sort((a, b) => b.length - a.length);

  if (unreachableOptionalPaths.length === 0) {
    return [];
  }

  const pruned = [];
  for (const relPkgPath of unreachableOptionalPaths) {
    const absPkgPath = path.join(rootDir, relPkgPath);
    if (fs.existsSync(absPkgPath)) {
      fs.rmSync(absPkgPath, { recursive: true, force: true });
      removeEmptyModuleAncestors(absPkgPath, nodeModulesDir);
      pruned.push(relPkgPath);
    }
  }

  const hiddenLockPath = path.join(nodeModulesDir, '.package-lock.json');
  if (fs.existsSync(hiddenLockPath)) {
    try {
      const hiddenLock = JSON.parse(fs.readFileSync(hiddenLockPath, 'utf8'));
      if (hiddenLock && typeof hiddenLock.packages === 'object' && hiddenLock.packages) {
        let modified = false;
        for (const relPkgPath of unreachableOptionalPaths) {
          if (Object.prototype.hasOwnProperty.call(hiddenLock.packages, relPkgPath)) {
            delete hiddenLock.packages[relPkgPath];
            modified = true;
          }
        }
        if (modified) {
          fs.writeFileSync(hiddenLockPath, `${JSON.stringify(hiddenLock, null, 2)}\n`, 'utf8');
        }
      }
    } catch {
      // Ignore unreadable hidden lockfile
    }
  }

  return pruned;
}

export function recordInstallState(rootDir = defaultRootDir, options = {}) {
  pruneUnreachableOptionalPackages(rootDir, options);
  writeLockfileHash(rootDir);

  const schemaHash = computeFileSha256(path.join(rootDir, 'prisma', 'schema.prisma'));
  const clientIndexPath = path.join(rootDir, 'node_modules', '.prisma', 'client', 'index.js');
  if (schemaHash && fs.existsSync(clientIndexPath)) {
    const state = readPretestState(rootDir);
    state.prismaClientSchemaHash = schemaHash;
    writePretestState(state, rootDir);
  }
}

function applyEnvFileFallback(envPath, targetEnv) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    if (targetEnv[key] !== undefined) {
      continue;
    }
    let val = match[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith('\'') && val.endsWith('\''))
    ) {
      val = val.slice(1, -1);
    }
    targetEnv[key] = val;
  }
}

export function resolveTestEnvironment(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const env = options.env ?? process.env;
  const envPath = path.join(rootDir, '.env.test');
  const isCi = isCiEnv(env);
  const rawTestDbUrl = typeof env.TEST_DATABASE_URL === 'string' ? env.TEST_DATABASE_URL.trim() : '';
  const callerDbUrl = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';

  let preservedDbUrl;
  if (rawTestDbUrl && rawTestDbUrl.toLowerCase() !== 'false' && rawTestDbUrl !== '0') {
    preservedDbUrl =
      rawTestDbUrl.toLowerCase() === 'true' || rawTestDbUrl === '1'
        ? callerDbUrl || undefined
        : rawTestDbUrl;
  } else if (isCi && callerDbUrl) {
    preservedDbUrl = callerDbUrl;
  }

  for (const v of ISOLATED_PG_ENV_VARS) {
    delete env[v];
  }

  if (fs.existsSync(envPath)) {
    try {
      if (env === process.env && typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      } else {
        applyEnvFileFallback(envPath, env);
      }
    } catch {
      // Fallback if error reading file
    }
  }

  const envFileTestOverride =
    typeof env.TEST_DATABASE_URL === 'string' ? env.TEST_DATABASE_URL.trim() : '';
  const resolvedOverride =
    preservedDbUrl ||
    (envFileTestOverride &&
    envFileTestOverride.toLowerCase() !== 'false' &&
    envFileTestOverride !== '0' &&
    envFileTestOverride.toLowerCase() !== 'true' &&
    envFileTestOverride !== '1'
      ? envFileTestOverride
      : undefined);

  const testDbUrl = resolvedOverride || env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  env.DATABASE_URL = testDbUrl;
  return testDbUrl;
}

export function parseDatabaseEndpoint(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const host = (parsed.hostname || 'localhost').replace(/^\[|\]$/g, '');
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
    return {
      host: host || 'localhost',
      port: Number.isFinite(port) && port > 0 ? port : 5432,
    };
  } catch {
    return { host: 'localhost', port: 5432 };
  }
}

function tryTcpConnectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (reachable) => {
      if (settled) {
        return;
      }
      settled = true;
      if (socket) {
        socket.destroy();
      }
      resolve(reachable);
    };

    try {
      socket = net.createConnection({
        host,
        port,
        autoSelectFamily: true,
      });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export async function probeTcpReadiness(host, port, timeoutMs = 1000) {
  if (await tryTcpConnectOnce(host, port, timeoutMs)) {
    return true;
  }
  if (host === 'localhost') {
    return tryTcpConnectOnce('127.0.0.1', port, timeoutMs);
  }
  return false;
}

export function shouldGeneratePrismaClient(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const env = options.env ?? process.env;
  const installedFreshDeps = options.installedFreshDeps ?? false;
  const clientIndexPath = path.join(rootDir, 'node_modules', '.prisma', 'client', 'index.js');
  if (!fs.existsSync(clientIndexPath)) {
    return true;
  }

  if (installedFreshDeps || isCiEnv(env)) {
    return false;
  }

  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    return false;
  }

  const state = readPretestState(rootDir);
  const currentSchemaHash = computeFileSha256(schemaPath);
  if (state.prismaClientSchemaHash && currentSchemaHash) {
    return state.prismaClientSchemaHash !== currentSchemaHash;
  }

  try {
    const clientMtime = fs.statSync(clientIndexPath).mtimeMs;
    const schemaMtime = fs.statSync(schemaPath).mtimeMs;
    return schemaMtime > clientMtime;
  } catch {
    return true;
  }
}

// Helper to run a command and inherit streams or fail
function runCommand(command, args, options = {}) {
  const {
    ignoreFailure = false,
    spawnSync = child_process.spawnSync,
    cwd = defaultRootDir,
    exit = process.exit,
    ...spawnOptions
  } = options;
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...spawnOptions,
  });
  if (result.status !== 0) {
    const errorMsg = `Command failed: ${command} ${args.join(' ')}`;
    console.error(errorMsg);
    if (!ignoreFailure) {
      exit(result.status || 1);
    }
  }
  return result;
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
      hasAppConfigTable,
      allMigrationsApplied,
    };
  } catch {
    return {
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

export async function main(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const spawnSync = options.spawnSync ?? child_process.spawnSync;
  const probeTcp = options.probeTcp ?? probeTcpReadiness;
  const probeDbState = options.probeDbState ?? probeDatabaseState;
  const ensureDatabase = options.ensureDatabase ?? ensureIsolatedTestDatabase;
  const resetSchema = options.resetSchema ?? resetDatabaseSchema;
  const exit = options.exit ?? process.exit;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (argv.includes('--record-install-state')) {
    if (String(env.npm_config_package_lock_only ?? '').trim().toLowerCase() === 'true') {
      return;
    }
    recordInstallState(rootDir);
    return;
  }

  // 1. Verify dependency alignment
  let installedFreshDeps = false;
  const needsInstall = shouldInstallDependencies({ rootDir, env });

  if (needsInstall) {
    console.log('Local dependencies out of sync or missing. Performing clean installation...');
    const result = spawnSync('npm', ['ci'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env,
    });

    if (result.status !== 0) {
      console.error('Dependency installation failed!');
      if (result.stdout) console.error(result.stdout.toString());
      if (result.stderr) console.error(result.stderr.toString());
      exit(result.status || 1);
      return;
    }

    recordInstallState(rootDir);
    installedFreshDeps = true;
    console.log('Dependency installation completed successfully.');
  }

  // 2. Always reset Jest accessibility violations and stale worker shards before Jest executes
  const testResultsDir = path.join(rootDir, 'test-results');
  fs.mkdirSync(testResultsDir, { recursive: true });
  for (const entry of fs.readdirSync(testResultsDir)) {
    if (entry.startsWith('.jest-a11y-violations.shard-')) {
      fs.rmSync(path.join(testResultsDir, entry), { force: true });
    }
  }
  fs.writeFileSync(path.join(testResultsDir, 'jest-a11y-violations.json'), '[]\n', 'utf8');

  // 3. Resolve isolated test environment while preserving explicit CI or TEST_DATABASE_URL overrides
  const testDbUrl = resolveTestEnvironment({ rootDir, env });
  const { host: dbHost, port: dbPort } = parseDatabaseEndpoint(testDbUrl);
  const dbListenerActive = await probeTcp(dbHost, dbPort);
  const isLocalDefaultDbEndpoint =
    (dbHost === 'localhost' || dbHost === '127.0.0.1' || dbHost === '::1') && dbPort === 5432;
  let dbReachable = dbListenerActive;

  if (dbListenerActive) {
    // Listener already active; skip Docker Compose database startup
  } else if (isCiEnv(env)) {
    console.log(
      `CI environment detected without an active listener at ${dbHost}:${dbPort}. Skipping Docker Compose auto-start.`
    );
  } else if (!isLocalDefaultDbEndpoint) {
    console.log(
      `Database endpoint ${dbHost}:${dbPort} is offline. Skipping default Docker Compose auto-start.`
    );
  } else {
    let dockerRunning = false;
    try {
      const docInfo = spawnSync('docker', ['info'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
        env,
      });
      if (docInfo.status === 0) {
        dockerRunning = true;
      }
    } catch {
      // Docker command not found or not running
    }

    if (dockerRunning) {
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
        ...env,
        DB_USER: env.DB_USER || 'wedding',
        DB_PASSWORD: env.DB_PASSWORD || 'wedding123',
        DB_NAME: env.DB_NAME || 'wedding',
        ADMIN_PASSWORD:
          env.ADMIN_PASSWORD ||
          'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
        GUEST_PASSCODE: env.GUEST_PASSCODE || 'build-fallback-guest-passcode',
        GUEST_SESSION_SECRET:
          env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min',
      };
      const startResult = spawnSync('docker', [...ciComposeArgs, 'up', '-d', 'db'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: ciComposeEnv,
      });

      if (startResult.status !== 0) {
        console.warn(
          'Failed to start database container via docker compose. Proceeding assuming database is already running...'
        );
        dbReachable = await probeTcp(dbHost, dbPort);
      } else {
        console.log('Waiting for database to be ready...');
        let ready = false;
        for (let i = 0; i < 15; i++) {
          try {
            const check = spawnSync(
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
          await sleep(1000);
        }
        if (ready) {
          dbReachable = true;
        } else {
          console.log('Database was not ready in time, proceeding anyway...');
          dbReachable = await probeTcp(dbHost, dbPort);
        }
      }
    } else {
      console.log('Docker command not found or daemon not running. Skipping database container auto-start.');
    }
  }

  // 4. Synchronize Prisma migrations only when invalidated or unapplied
  const schemaHash = computeFileSha256(path.join(rootDir, 'prisma', 'schema.prisma'));
  const migrationsHash = computeMigrationsAndSchemaHash(rootDir);
  const expectedMigrations = listCommittedMigrationNames(rootDir);
  const state = readPretestState(rootDir);
  const requireDb = isDatabaseRequired({ env, argv });

  if (!dbReachable) {
    if (requireDb) {
      console.error(
        `PostgreSQL database at ${dbHost}:${dbPort} is unreachable while database readiness is required (CI_REQUIRE_DB=true or --require-db).`
      );
      exit(1);
      return;
    }
    if (state.dbSync) {
      delete state.dbSync;
      writePretestState(state, rootDir);
    }
    console.warn(
      `PostgreSQL is offline at ${dbHost}:${dbPort}; skipping Prisma migrations (set CI_REQUIRE_DB=true or pass --require-db to require database readiness).`
    );
  } else {
    let isDbSchemaCached = false;
    if (
      Boolean(migrationsHash) &&
      state.dbSync?.schemaHash === migrationsHash &&
      state.dbSync?.testDbUrl === testDbUrl
    ) {
      const dbState = await probeDbState(testDbUrl, expectedMigrations);
      isDbSchemaCached = Boolean(dbState?.hasAppConfigTable && dbState?.allMigrationsApplied);
    }

    if (!isDbSchemaCached) {
      let targetDbName = '';
      let targetSchema = 'public';
      try {
        const parsedTestUrl = new URL(testDbUrl);
        targetDbName = decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ''));
        targetSchema = parsedTestUrl.searchParams.get('schema') || 'public';
      } catch {
        // Keep defaults when URL cannot be parsed
      }
      const isIsolatedTestDb =
        targetDbName === 'wedding_test' ||
        targetDbName.endsWith('_test') ||
        targetDbName.startsWith('wedding_test_');

      await ensureDatabase(testDbUrl);

      console.log('Applying Prisma migrations to isolated test database (provider: postgresql)...');

      const migrateEnv = { ...env, DATABASE_URL: testDbUrl };
      delete migrateEnv.POSTGRES_URL_NON_POOLING;

      const migrateResult = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
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
          await resetSchema(testDbUrl, targetSchema);

          runCommand('npx', ['prisma', 'migrate', 'deploy'], {
            cwd: rootDir,
            spawnSync,
            exit,
            env: migrateEnv,
          });
        } else {
          console.error('Command failed: npx prisma migrate deploy');
          exit(migrateResult.status || 1);
          return;
        }
      }

      if (migrationsHash) {
        state.dbSync = { schemaHash: migrationsHash, testDbUrl };
        writePretestState(state, rootDir);
      }
    }
  }

  // 5. Generate Prisma Client only when missing or invalidated
  if (shouldGeneratePrismaClient({ rootDir, env, installedFreshDeps })) {
    console.log('Generating Prisma Client...');
    runCommand('npm', ['run', 'prisma:generate'], { cwd: rootDir, spawnSync, exit, env });
    if (schemaHash) {
      state.prismaClientSchemaHash = schemaHash;
      writePretestState(state, rootDir);
    }
  }
}

async function ensureIsolatedTestDatabase(testDbUrl) {
  let parsedTestUrl;
  try {
    parsedTestUrl = new URL(testDbUrl);
  } catch {
    return;
  }
  const targetDbName = decodeURIComponent(parsedTestUrl.pathname.replace(/^\//, ''));
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
}

async function resetDatabaseSchema(testDbUrl, targetSchema) {
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
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(SCRIPT_FILE) ||
    process.argv[1].endsWith('pretest.mjs'));

if (isDirectCall) {
  main().catch((err) => {
    console.error('Pretest preflight script failed with error:', err);
    process.exit(1);
  });
}
