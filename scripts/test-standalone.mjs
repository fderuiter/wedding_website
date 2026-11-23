import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAvailableDbPort,
  runCheckedCommand,
  runSmokeRouteProbes,
  waitForPostgresReady,
  waitForServerReady,
} from './smoke-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.TEST_PORT || '3001';
const HOST_HEADER = `127.0.0.1:${PORT}`;
const BASE_URL = `http://${HOST_HEADER}`;
const COMPOSE_ARGS = [
  '--env-file',
  '.env.ci',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.ci.yml',
];

function createEphemeralScryptHash() {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(crypto.randomBytes(24).toString('hex'), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

async function main() {
  console.log('=== Standalone Execution Smoke Test ===');

  // 1. Verify provider-neutral environment: Unset Vercel, Netlify, or provider-specific vars
  const providerVars = [
    'VERCEL',
    'VERCEL_ENV',
    'VERCEL_URL',
    'NEXT_PUBLIC_VERCEL_ENV',
    'NETLIFY',
    'NETLIFY_IMAGES_CDN_DOMAIN',
    'AWS_LAMBDA_FUNCTION_NAME',
  ];

  for (const v of providerVars) {
    if (process.env[v]) {
      console.warn(
        `⚠️ Provider-specific variable ${v} was set. Unsetting for provider-neutral test.`
      );
      delete process.env[v];
    }
  }

  // 2. Verify standalone server entrypoint and staged static/public assets exist without masking missing copies
  const standaloneDir = path.join(rootDir, '.next', 'standalone');
  const standaloneServerPath = path.join(standaloneDir, 'server.js');
  const standaloneStaticDir = path.join(standaloneDir, '.next', 'static');
  const standalonePublicDir = path.join(standaloneDir, 'public');

  if (!fs.existsSync(standaloneServerPath)) {
    console.error(
      `❌ Standalone server build not found at ${standaloneServerPath}. Run 'npm run build' first.`
    );
    process.exit(1);
  }
  if (!fs.existsSync(standaloneStaticDir)) {
    console.error(
      `❌ Standalone static assets not found at ${standaloneStaticDir}. Run 'npm run build' first.`
    );
    process.exit(1);
  }
  if (!fs.existsSync(standalonePublicDir)) {
    console.error(
      `❌ Standalone public assets not found at ${standalonePublicDir}. Run 'npm run build' first.`
    );
    process.exit(1);
  }

  // 3. Prepare environment for standalone server execution
  const ephemeralAdminPassword = process.env.ADMIN_PASSWORD || createEphemeralScryptHash();
  const ephemeralGuestPasscode =
    process.env.GUEST_PASSCODE || `standalone-passcode-${crypto.randomBytes(8).toString('hex')}`;
  const ephemeralGuestSessionSecret =
    process.env.GUEST_SESSION_SECRET ||
    `standalone-session-secret-${crypto.randomBytes(24).toString('hex')}`;

  const defaultDbPort = await getAvailableDbPort();
  const configuredDbUrl =
    process.env.DATABASE_URL ||
    `postgresql://wedding:wedding123@localhost:${defaultDbPort}/wedding`;

  let targetDbHost = '127.0.0.1';
  let targetDbPort = defaultDbPort;
  let dbUser = process.env.DB_USER || 'wedding';
  let dbName = process.env.DB_NAME || 'wedding';

  try {
    const parsedDb = new URL(configuredDbUrl);
    if (parsedDb.hostname) {
      targetDbHost = parsedDb.hostname === 'localhost' ? '127.0.0.1' : parsedDb.hostname;
    }
    if (parsedDb.port) {
      targetDbPort = parseInt(parsedDb.port, 10);
    }
    if (parsedDb.username) {
      dbUser = decodeURIComponent(parsedDb.username);
    }
    const pathDbName = parsedDb.pathname.replace(/^\/+/, '');
    if (pathDbName) {
      dbName = decodeURIComponent(pathDbName);
    }
  } catch {
    // Keep defaults if URL is invalid (prisma migrate deploy will report a clear validation error)
  }

  const composeEnv = {
    ...process.env,
    DB_USER: dbUser,
    DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123',
    DB_NAME: dbName,
    DB_PORT: String(targetDbPort),
    ADMIN_PASSWORD: ephemeralAdminPassword,
    GUEST_PASSCODE: ephemeralGuestPasscode,
    GUEST_SESSION_SECRET: ephemeralGuestSessionSecret,
  };
  delete composeEnv.POSTGRES_URL_NON_POOLING;

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT,
    HOSTNAME: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,${HOST_HEADER}`,
    DATABASE_URL: configuredDbUrl,
    ADMIN_PASSWORD: ephemeralAdminPassword,
    GUEST_PASSCODE: ephemeralGuestPasscode,
    GUEST_SESSION_SECRET: ephemeralGuestSessionSecret,
  };
  delete env.POSTGRES_URL_NON_POOLING;

  for (const v of providerVars) {
    delete env[v];
  }

  let serverProcess = null;
  let serverLogs = '';
  let killed = false;
  let passed = false;

  const cleanup = () => {
    if (!killed && serverProcess && !serverProcess.killed) {
      killed = true;
      serverProcess.kill('SIGTERM');
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // 4. Ensure clean PostgreSQL container is running over TCP and migrations succeed
    const dbUrl = env.DATABASE_URL || '';
    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
      console.log('Resetting and starting PostgreSQL container for standalone smoke test...');
      child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
        cwd: rootDir,
        env: composeEnv,
      });

      runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], {
        cwd: rootDir,
        env: composeEnv,
      });

      console.log('Waiting for PostgreSQL TCP readiness (pg_isready -h localhost + host socket)...');
      await waitForPostgresReady({
        composeArgs: COMPOSE_ARGS,
        composeEnv,
        rootDir,
        host: targetDbHost,
        port: targetDbPort,
        dbUser,
        dbName,
        maxAttempts: 30,
      });

      console.log('Applying Prisma migrations against clean PostgreSQL database...');
      const migrateEnv = {
        ...process.env,
        DATABASE_URL: env.DATABASE_URL,
      };
      delete migrateEnv.POSTGRES_URL_NON_POOLING;

      runCheckedCommand('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: rootDir,
        env: migrateEnv,
      });
    }

    // 5. Start standalone server and execute shared smoke route probes
    console.log(`Starting standalone server on port ${PORT}...`);
    serverProcess = child_process.spawn('node', [standaloneServerPath], {
      cwd: standaloneDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      serverLogs += text;
      process.stdout.write(`[standalone] ${text}`);
    });
    serverProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      serverLogs += text;
      process.stderr.write(`[standalone err] ${text}`);
    });

    console.log('Waiting for standalone server readiness on GET /api/ready...');
    await waitForServerReady({
      baseUrl: BASE_URL,
      hostHeader: HOST_HEADER,
      maxAttempts: 30,
      intervalMs: 1000,
      label: 'Standalone server',
    });
    console.log('✅ Standalone server reported ready!');

    await runSmokeRouteProbes({
      baseUrl: BASE_URL,
      hostHeader: HOST_HEADER,
      guestPasscode: ephemeralGuestPasscode,
      label: 'standalone',
    });

    console.log('=============================================');
    console.log('🎉 Standalone server smoke tests PASSED successfully!');
    console.log('=============================================');
    passed = true;
  } catch (err) {
    console.error('\n❌ Standalone Smoke Test FAILED!');
    console.error(err instanceof Error ? err.message : err);
    console.error('\n=== Actionable Application / Standalone Server Logs ===');
    console.error(serverLogs || '(No server logs captured)');
    process.exitCode = 1;
  } finally {
    cleanup();
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      cwd: rootDir,
      env: composeEnv,
    });
    setTimeout(() => {
      process.exit(passed ? 0 : 1);
    }, 300);
  }
}

main();
