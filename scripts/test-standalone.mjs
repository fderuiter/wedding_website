import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(SCRIPT_DIR, '..');

export const COMPOSE_ARGS = [
  '-p',
  'wedding-smoke-standalone',
  '--env-file',
  '.env.ci',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.ci.yml',
];

export async function getAvailableLoopbackPort(overridePort, excludePorts = []) {
  if (overridePort !== undefined && overridePort !== null && String(overridePort).trim() !== '') {
    const parsed = Number.parseInt(String(overridePort).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid port override: ${overridePort}`);
    }
    return parsed;
  }

  const excluded = new Set(excludePorts.map((p) => Number(p)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const assignedPort = typeof addr === 'object' && addr ? addr.port : 0;
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(assignedPort);
        });
      });
    });
    if (!excluded.has(port)) {
      return port;
    }
  }
  throw new Error('Failed to allocate a distinct loopback port.');
}

/**
 * @param {Record<string, string | undefined>} [envInput]
 * @param {Array<number | string>} [excludePorts]
 */
export async function resolveStandaloneDatabaseTarget(envInput = process.env, excludePorts = []) {
  const explicitUrl = typeof envInput.DATABASE_URL === 'string' ? envInput.DATABASE_URL.trim() : '';
  if (explicitUrl) {
    return {
      databaseUrl: explicitUrl,
      dbPort: null,
      useComposeDb: false,
    };
  }

  const dbPort = await getAvailableLoopbackPort(envInput.DB_PORT, excludePorts);
  const dbUser = envInput.DB_USER || 'wedding';
  const dbPassword = envInput.DB_PASSWORD || 'wedding123';
  const dbName = envInput.DB_NAME || 'wedding';

  return {
    databaseUrl: `postgresql://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}`,
    dbPort,
    useComposeDb: true,
  };
}

function createEphemeralScryptHash() {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(crypto.randomBytes(24).toString('hex'), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

function request(urlPath, baseUrl, port) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, baseUrl);
    const req = http.get(fullUrl, {
      headers: {
        Host: `127.0.0.1:${port}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlPath}`));
    });
  });
}

async function waitForTcpPort(port, host = '127.0.0.1', retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ port, host, timeout: 1000 });
        socket.on('connect', () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

export async function main() {
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
      console.warn(`⚠️ Provider-specific variable ${v} was set. Unsetting for provider-neutral test.`);
      delete process.env[v];
    }
  }

  // Check that standalone server entrypoint exists
  const standaloneServerPath = path.join(rootDir, '.next', 'standalone', 'server.js');
  if (!fs.existsSync(standaloneServerPath)) {
    console.error(`❌ Standalone server build not found at ${standaloneServerPath}. Run 'npm run build' first.`);
    process.exit(1);
  }

  // Ensure public and static assets are synced to standalone folder if needed
  const standaloneNextDir = path.join(rootDir, '.next', 'standalone', '.next');
  const standaloneStaticDir = path.join(standaloneNextDir, 'static');
  const srcStaticDir = path.join(rootDir, '.next', 'static');

  if (fs.existsSync(srcStaticDir) && !fs.existsSync(standaloneStaticDir)) {
    fs.mkdirSync(standaloneNextDir, { recursive: true });
    fs.cpSync(srcStaticDir, standaloneStaticDir, { recursive: true });
  }

  const standalonePublicDir = path.join(rootDir, '.next', 'standalone', 'public');
  const srcPublicDir = path.join(rootDir, 'public');

  if (fs.existsSync(srcPublicDir) && !fs.existsSync(standalonePublicDir)) {
    fs.cpSync(srcPublicDir, standalonePublicDir, { recursive: true });
  }

  const portNum = await getAvailableLoopbackPort(process.env.TEST_PORT);
  const PORT = String(portNum);
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const dbTarget = await resolveStandaloneDatabaseTarget(process.env, [portNum]);

  // Prepare environment for standalone server execution
  const ephemeralAdminPassword = process.env.ADMIN_PASSWORD || createEphemeralScryptHash();
  const ephemeralGuestPasscode =
    process.env.GUEST_PASSCODE || `standalone-passcode-${crypto.randomBytes(8).toString('hex')}`;
  const ephemeralGuestSessionSecret =
    process.env.GUEST_SESSION_SECRET ||
    `standalone-session-secret-${crypto.randomBytes(24).toString('hex')}`;
  const composeEnv = {
    ...process.env,
    PORT,
    ...(dbTarget.dbPort !== null ? { DB_PORT: String(dbTarget.dbPort) } : {}),
    DB_USER: process.env.DB_USER || 'wedding',
    DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123',
    DB_NAME: process.env.DB_NAME || 'wedding',
    ADMIN_PASSWORD: ephemeralAdminPassword,
    GUEST_PASSCODE: ephemeralGuestPasscode,
    GUEST_SESSION_SECRET: ephemeralGuestSessionSecret,
  };

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT,
    HOSTNAME: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,127.0.0.1:${PORT}`,
    DATABASE_URL: dbTarget.databaseUrl,
    ADMIN_PASSWORD: ephemeralAdminPassword,
    GUEST_PASSCODE: ephemeralGuestPasscode,
    GUEST_SESSION_SECRET: ephemeralGuestSessionSecret,
  };

  // Remove any remaining provider flags from env
  for (const v of providerVars) {
    delete env[v];
  }

  let managedComposeDb = false;
  let serverProcess = null;
  let serverLogs = '';
  let killed = false;

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
    if (dbTarget.useComposeDb) {
      console.log(`Ensuring isolated database is ready on 127.0.0.1:${dbTarget.dbPort} for standalone execution...`);
      try {
        child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
          stdio: 'ignore',
          shell: true,
          cwd: rootDir,
          env: composeEnv,
        });
        managedComposeDb = true;
        child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], {
          stdio: 'inherit',
          shell: true,
          cwd: rootDir,
          env: composeEnv,
        });
        let dbReady = false;
        for (let i = 0; i < 30; i++) {
          const check = child_process.spawnSync(
            'docker',
            ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'pg_isready', '-U', composeEnv.DB_USER, '-d', composeEnv.DB_NAME],
            { stdio: 'ignore', shell: true, cwd: rootDir, env: composeEnv }
          );
          if (check.status === 0) {
            dbReady = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (dbReady && (await waitForTcpPort(dbTarget.dbPort))) {
          child_process.spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
            stdio: 'inherit',
            shell: true,
            cwd: rootDir,
            env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
          });
        }
      } catch (dbErr) {
        console.warn('⚠️ Database setup check warning:', dbErr.message);
      }
    } else {
      console.log('Using caller-supplied DATABASE_URL; skipping isolated database container startup.');
    }

    console.log(`Starting standalone server on port ${PORT}...`);
    serverProcess = child_process.spawn('node', [standaloneServerPath], {
      cwd: path.join(rootDir, '.next', 'standalone'),
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

    // Wait for server readiness
    console.log('Waiting for standalone server to accept requests...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request('/api/health', BASE_URL, PORT);
        if (res.statusCode === 200) {
          ready = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!ready) {
      throw new Error('Standalone server failed to respond on /api/health within 30 seconds.');
    }

    console.log('✅ Standalone server is listening!');

    // Test 0: Verify Liveness (/api/live)
    console.log('Testing GET /api/live...');
    const liveRes = await request('/api/live', BASE_URL, PORT);
    if (liveRes.statusCode !== 200) {
      throw new Error(`Liveness check returned status ${liveRes.statusCode}: ${liveRes.body}`);
    }
    const liveJson = JSON.parse(liveRes.body);
    if (liveJson.status !== 'alive' || typeof liveJson.timestamp !== 'string') {
      throw new Error(`Liveness check body invalid: ${liveRes.body}`);
    }
    console.log('✅ /api/live OK');

    // Test 1: Verify Health (Startup / Rollout Readiness)
    console.log('Testing GET /api/health...');
    const healthRes = await request('/api/health', BASE_URL, PORT);
    if (healthRes.statusCode !== 200) {
      throw new Error(`Health check returned status ${healthRes.statusCode}: ${healthRes.body}`);
    }
    const healthJson = JSON.parse(healthRes.body);
    const healthStatus = healthJson.status || healthJson.data?.status;
    if (healthStatus !== 'ok') {
      throw new Error(`Health check body invalid: ${healthRes.body}`);
    }
    console.log('✅ /api/health OK');

    // Test 2: Verify Readiness
    console.log('Testing GET /api/ready...');
    const readyRes = await request('/api/ready', BASE_URL, PORT);
    if (readyRes.statusCode !== 200) {
      throw new Error(`Readiness check returned status ${readyRes.statusCode}: ${readyRes.body}`);
    }
    const readyJson = JSON.parse(readyRes.body);
    if (readyJson.status !== 'ready') {
      throw new Error(`Readiness check body invalid: ${readyRes.body}`);
    }
    console.log('✅ /api/ready OK');

    // Test 3: Verify Representative Public Routes
    const routesToTest = [
      { path: '/guest/login', expectedStatus: 200, name: 'Guest Login page' },
      { path: '/', expectedStatus: 303, name: 'Home page (redirects to guest login when unauthenticated)' },
      { path: '/api/registry/items', expectedStatus: 401, name: 'Registry items API (requires auth)' },
    ];

    for (const route of routesToTest) {
      console.log(`Testing route ${route.name} (${route.path})...`);
      const res = await request(route.path, BASE_URL, PORT);
      if (res.statusCode !== route.expectedStatus) {
        throw new Error(`Route ${route.path} returned status ${res.statusCode}, expected ${route.expectedStatus}`);
      }
      console.log(`✅ ${route.name} (${route.path}) returned ${res.statusCode}`);
    }

    console.log('=============================================');
    console.log('🎉 Standalone server smoke tests PASSED successfully!');
    console.log('=============================================');
  } catch (err) {
    console.error('\n❌ Standalone Smoke Test FAILED!');
    console.error(err.message || err);
    console.error('\n=== Actionable Application / Standalone Server Logs ===');
    console.error(serverLogs || '(No server logs captured)');
    process.exitCode = 1;
  } finally {
    cleanup();
    if (managedComposeDb) {
      child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
        stdio: 'ignore',
        shell: true,
        cwd: rootDir,
        env: composeEnv,
      });
    }
    setTimeout(() => {
      process.exit(process.exitCode || 0);
    }, 500);
  }
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('test-standalone.mjs');

if (isDirectCall) {
  main();
}
