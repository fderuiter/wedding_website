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
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGHOST',
  'PGPORT',
  'PGDATASOURCE',
  'ADMIN_PASSWORD',
];

export function isCiEnv(env) {
  const targetEnv = env ?? process.env;
  const rawCi = String(targetEnv.CI ?? '').trim().toLowerCase();
  return rawCi === 'true' || rawCi === '1';
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

  const lockfileContent = fs.readFileSync(lockfilePath);
  const currentHash = crypto.createHash('sha256').update(lockfileContent).digest('hex');

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
    const lockfileContent = fs.readFileSync(lockfilePath);
    const currentHash = crypto.createHash('sha256').update(lockfileContent).digest('hex');
    fs.mkdirSync(hashCacheDir, { recursive: true });
    fs.writeFileSync(hashCachePath, currentHash, 'utf8');
    return currentHash;
  }
  return null;
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

  const testDbUrl = preservedDbUrl || env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
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
    shell: true,
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

export async function main(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const env = options.env ?? process.env;
  const spawnSync = options.spawnSync ?? child_process.spawnSync;
  const probeTcp = options.probeTcp ?? probeTcpReadiness;
  const exit = options.exit ?? process.exit;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  // 1. Verify dependency alignment
  let installedFreshDeps = false;
  const needsInstall = shouldInstallDependencies({ rootDir, env });

  if (needsInstall) {
    console.log('Local dependencies out of sync or missing. Performing clean installation...');
    const result = spawnSync('npm', ['ci'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env,
    });

    if (result.status !== 0) {
      console.error('Dependency installation failed!');
      if (result.stdout) console.error(result.stdout.toString());
      if (result.stderr) console.error(result.stderr.toString());
      exit(result.status || 1);
      return;
    }

    writeLockfileHash(rootDir);
    installedFreshDeps = true;
    console.log('Dependency installation completed successfully.');
  }

  // 2. Selective Execution based on lifecycle event
  const lifecycleEvent = env.npm_lifecycle_event || '';
  const isUnitTest = lifecycleEvent.includes('test');

  if (isUnitTest) {
    console.log('Unit test phase detected. Skipping full build...');

    const testResultsDir = path.join(rootDir, 'test-results');
    fs.mkdirSync(testResultsDir, { recursive: true });
    fs.writeFileSync(path.join(testResultsDir, 'jest-a11y-violations.json'), '[]\n', 'utf8');

    // Resolve isolated test environment while preserving explicit CI or TEST_DATABASE_URL overrides
    const testDbUrl = resolveTestEnvironment({ rootDir, env });
    const { host: dbHost, port: dbPort } = parseDatabaseEndpoint(testDbUrl);
    const dbListenerActive = await probeTcp(dbHost, dbPort);

    if (dbListenerActive) {
      console.log(
        `PostgreSQL listener already active at ${dbHost}:${dbPort}. Skipping Docker Compose database startup.`
      );
    } else if (isCiEnv(env)) {
      console.log(
        `CI environment detected without an active listener at ${dbHost}:${dbPort}. Skipping Docker Compose auto-start.`
      );
    } else {
      // Check if Docker is available and running
      let dockerRunning = false;
      try {
        const docInfo = spawnSync('docker', ['info'], { stdio: 'ignore', shell: true, env });
        if (docInfo.status === 0) {
          dockerRunning = true;
        }
      } catch {
        // Docker command not found or not running
      }

      if (dockerRunning) {
        console.log('Ensuring local PostgreSQL database container is running...');
        const ciComposeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];
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
          shell: true,
          env: ciComposeEnv,
        });

        if (startResult.status !== 0) {
          console.warn(
            'Failed to start database container via docker compose. Proceeding assuming database is already running...'
          );
        } else {
          console.log('Waiting for database to be ready...');
          let ready = false;
          for (let i = 0; i < 15; i++) {
            try {
              const check = spawnSync(
                'docker',
                [...ciComposeArgs, 'exec', '-T', 'db', 'pg_isready', '-U', 'wedding'],
                { stdio: 'ignore', shell: true, cwd: rootDir, env: ciComposeEnv }
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
          if (!ready) {
            console.log('Database was not ready in time, proceeding anyway...');
          }
        }
      } else {
        console.log('Docker command not found or daemon not running. Skipping database container auto-start.');
      }
    }

    console.log('Synchronizing schema to isolated test database (provider: postgresql)...');

    runCommand('npx', ['prisma', 'db', 'push', '--accept-data-loss'], {
      cwd: rootDir,
      spawnSync,
      exit,
      env: { ...env, DATABASE_URL: testDbUrl },
    });

    if (shouldGeneratePrismaClient({ rootDir, env, installedFreshDeps })) {
      console.log('Generating Prisma Client...');
      runCommand('npm', ['run', 'prisma:generate'], { cwd: rootDir, spawnSync, exit, env });
    } else {
      console.log('Prisma Client already aligned. Skipping duplicate prisma:generate.');
    }

    console.log('Staging documentation portal...');
    runCommand('npx', ['tsx', 'scripts/generate-portal.ts', '--stage-only'], {
      cwd: rootDir,
      spawnSync,
      exit,
      env,
    });
  } else {
    console.log('Running full build...');
    runCommand('npm', ['run', 'build'], { cwd: rootDir, spawnSync, exit, env });
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
