import child_process from 'node:child_process';
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
  'wedding-smoke-container',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.ci.yml',
];

const CI_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

const DEFAULT_GHA_CACHE_SCOPE = process.arch === 'arm64' ? 'app-arm64' : 'app-amd64';

/**
 * @param {Record<string, string | undefined>} [extra]
 * @returns {Record<string, string | undefined>}
 */
export function buildCiComposeEnv(extra = {}) {
  return {
    ...process.env,
    GHA_CACHE_SCOPE: process.env.GHA_CACHE_SCOPE || DEFAULT_GHA_CACHE_SCOPE,
    DB_USER: process.env.DB_USER || 'wedding',
    DB_PASSWORD: process.env.DB_PASSWORD || 'wedding123',
    DB_NAME: process.env.DB_NAME || 'wedding',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || CI_ADMIN_PASSWORD,
    GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'playwright-e2e-guest-passcode',
    GUEST_SESSION_SECRET:
      process.env.GUEST_SESSION_SECRET || 'playwright-e2e-session-secret-32-chars-min',
    E2E_TEST: process.env.E2E_TEST || 'true',
    ...extra,
  };
}

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

function runCommand(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = child_process.spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function request(urlPath, baseUrl, port, timeoutMs = 5000) {
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
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlPath}`));
    });
  });
}

function queryContainerDb(sql, composeEnv) {
  const res = child_process.spawnSync(
    'docker',
    ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', composeEnv.DB_USER, '-d', composeEnv.DB_NAME, '-c', sql],
    { cwd: rootDir, env: composeEnv, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`psql query failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function printLogs(composeEnv) {
  console.error('\n=== Actionable Migration Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'migration'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
  console.error('\n=== Actionable App Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'app'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
  console.error('\n=== Actionable DB Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'db'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
}

export async function main() {
  console.log('=== OCI Container & Clean Database Smoke Test ===');

  let passed = false;
  let activeComposeEnv = buildCiComposeEnv();

  try {
    // 1. Clean up any leftover isolated smoke containers before selecting ports
    console.log('Cleaning up any existing isolated smoke containers...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
      stdio: 'ignore',
      shell: true,
      cwd: rootDir,
      env: activeComposeEnv,
    });

    const appPortNum = await getAvailableLoopbackPort(process.env.TEST_PORT);
    const dbPort = await getAvailableLoopbackPort(process.env.DB_PORT, [appPortNum]);
    const PORT = String(appPortNum);
    const BASE_URL = `http://127.0.0.1:${PORT}`;
    activeComposeEnv = buildCiComposeEnv({
      PORT,
      DB_PORT: dbPort.toString(),
    });
    console.log(`Using isolated loopback ports PORT=${PORT} and DB_PORT=${dbPort} for container smoke test...`);

    // 2. Start PostgreSQL from scratch
    console.log('Starting clean PostgreSQL database container...');
    runCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], {
      env: activeComposeEnv,
    });

    // 3. Wait for PostgreSQL container health check & port opening
    console.log('Waiting for PostgreSQL container to become ready...');
    let dbReady = false;
    for (let i = 0; i < 30; i++) {
      const check = child_process.spawnSync(
        'docker',
        ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'pg_isready', '-U', activeComposeEnv.DB_USER, '-d', activeComposeEnv.DB_NAME],
        { stdio: 'ignore', shell: true, cwd: rootDir, env: activeComposeEnv }
      );
      if (check.status === 0) {
        dbReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!dbReady) {
      throw new Error('PostgreSQL container failed to become ready within 30 seconds.');
    }

    // Ensure TCP port is accepting connections from host
    let portReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ port: dbPort, host: '127.0.0.1', timeout: 1000 });
          socket.on('connect', () => { socket.end(); resolve(); });
          socket.on('error', reject);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
        });
        portReady = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!portReady) {
      throw new Error(`PostgreSQL port ${dbPort} not reachable on 127.0.0.1 within 30 seconds.`);
    }

    console.log('✅ PostgreSQL container is ready!');

    const skipImageBuild = process.env.SKIP_IMAGE_BUILD === 'true';
    const forceContainerMigration = process.argv.includes('--container-migration');
    const hostPrismaBin = path.join(
      rootDir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
    );
    const useHostPrisma = !forceContainerMigration && fs.existsSync(hostPrismaBin);
    const composeEnv = activeComposeEnv;

    if (skipImageBuild) {
      runCommand('docker', ['image', 'inspect', 'wedding-website:latest'], {
        stdio: 'ignore',
        env: composeEnv,
      });
    } else if (!useHostPrisma) {
      console.log('Building OCI image via Docker Compose ahead of container-based migration smoke test...');
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        env: composeEnv,
      });
    }

    // 4. Test clean-database migration path
    console.log('Testing clean-database Prisma migration deploy path...');
    if (useHostPrisma) {
      const testDbUrl = `postgresql://${composeEnv.DB_USER}:${composeEnv.DB_PASSWORD}@127.0.0.1:${dbPort}/${composeEnv.DB_NAME}`;
      runCommand('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: testDbUrl, DB_PORT: dbPort.toString() },
      });
    } else {
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'run', '--rm', 'migration'], {
        env: composeEnv,
      });
    }
    console.log('✅ Clean-database migrations applied successfully!');

    // 5. Build OCI image (unless pre-built) & start app container
    if (skipImageBuild) {
      console.log('Starting pre-built OCI app container via Docker Compose (SKIP_IMAGE_BUILD=true)...');
    } else if (useHostPrisma) {
      console.log('Building OCI image and starting app container via Docker Compose...');
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        env: composeEnv,
      });
    } else {
      console.log('Starting newly built OCI app container via Docker Compose...');
    }
    runCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', '--no-build', 'app'], {
      env: composeEnv,
    });

    // 6. Poll app container health/readiness
    console.log(`Waiting for application container to respond on ${BASE_URL}...`);
    let appReady = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await request('/api/health', BASE_URL, PORT);
        if (res.statusCode === 200) {
          appReady = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!appReady) {
      throw new Error('App container failed to respond on /api/health within 120 seconds.');
    }

    console.log('✅ App container is responsive!');

    // 7. Verify Liveness Probe
    console.log('Testing GET /api/live against container...');
    const liveRes = await request('/api/live', BASE_URL, PORT);
    if (liveRes.statusCode !== 200) {
      throw new Error(`Container /api/live returned status ${liveRes.statusCode}`);
    }
    const liveJson = JSON.parse(liveRes.body);
    if (liveJson.status !== 'alive' || typeof liveJson.timestamp !== 'string') {
      throw new Error(`Container /api/live body invalid: ${liveRes.body}`);
    }
    console.log('✅ Container /api/live OK');

    // 8. Verify Health Probe
    console.log('Testing GET /api/health against container...');
    const healthRes = await request('/api/health', BASE_URL, PORT);
    if (healthRes.statusCode !== 200) {
      throw new Error(`Container /api/health returned status ${healthRes.statusCode}`);
    }
    const healthJson = JSON.parse(healthRes.body);
    const healthStatus = healthJson.status || healthJson.data?.status;
    if (healthStatus !== 'ok') {
      throw new Error(`Container /api/health body invalid: ${healthRes.body}`);
    }
    console.log('✅ Container /api/health OK');

    // 9. Verify Readiness Probe
    console.log('Testing GET /api/ready against container...');
    const readyRes = await request('/api/ready', BASE_URL, PORT);
    if (readyRes.statusCode !== 200) {
      throw new Error(`Container /api/ready returned status ${readyRes.statusCode}`);
    }
    const readyJson = JSON.parse(readyRes.body);
    if (readyJson.status !== 'ready') {
      throw new Error(`Container /api/ready body invalid: ${readyRes.body}`);
    }
    console.log('✅ Container /api/ready OK');

    // 9b. Verify Representative Public Routes
    const routesToTest = [
      { path: '/guest/login', expectedStatus: 200, name: 'Guest Login page' },
      { path: '/', expectedStatus: 303, name: 'Home page (redirects when unauthenticated)' },
      { path: '/api/registry/items', expectedStatus: 401, name: 'Registry items API (requires auth)' },
    ];

    for (const route of routesToTest) {
      console.log(`Testing container route ${route.name} (${route.path})...`);
      const res = await request(route.path, BASE_URL, PORT);
      if (res.statusCode !== route.expectedStatus) {
        throw new Error(`Container route ${route.path} returned status ${res.statusCode}, expected ${route.expectedStatus}`);
      }
      console.log(`✅ Container ${route.name} (${route.path}) returned ${res.statusCode}`);
    }

    // 10. Verify shared globalThis pool across concurrent API and SSR traffic (<= 10 PostgreSQL connections)
    console.log('Testing shared pg.Pool connection cap across concurrent API and SSR traffic...');
    const concurrentRequests = [
      ...Array.from({ length: 12 }, () => request('/api/ready', BASE_URL, PORT, 15000)),
      ...Array.from({ length: 12 }, () => request('/guest/login', BASE_URL, PORT, 15000)),
    ];
    const concurrentResults = await Promise.all(concurrentRequests);
    for (const [idx, res] of concurrentResults.entries()) {
      if (res.statusCode !== 200) {
        throw new Error(`Concurrent request #${idx} returned unexpected status ${res.statusCode}`);
      }
    }

    const activeBackendsRaw = queryContainerDb(
      `SELECT count(*) FROM pg_stat_activity WHERE datname = '${composeEnv.DB_NAME}' AND usename = '${composeEnv.DB_USER}' AND pid <> pg_backend_pid();`,
      composeEnv
    );
    const activeBackends = Number.parseInt(activeBackendsRaw, 10);
    if (!Number.isFinite(activeBackends) || activeBackends < 1 || activeBackends > 10) {
      throw new Error(`Expected 1..10 PostgreSQL pool connections across API & SSR runtimes, observed ${activeBackendsRaw}`);
    }

    const appLogsBeforeStop = child_process.spawnSync(
      'docker',
      ['compose', ...COMPOSE_ARGS, 'logs', '--no-color', 'app'],
      { cwd: rootDir, env: composeEnv, encoding: 'utf8' }
    ).stdout || '';
    const poolInitMatches = appLogsBeforeStop.match(/DEBUG \[createPrismaClient\]: Initializing PostgreSQL database client/g) || [];
    if (poolInitMatches.length !== 1) {
      throw new Error(
        `Expected exactly 1 Prisma/pg.Pool initialization across standalone runtimes, observed ${poolInitMatches.length}`
      );
    }
    console.log(`✅ Shared globalThis pool verified (${activeBackends} PostgreSQL connections <= 10, 1 runtime initialization)`);

    // 11. Verify in-flight request completes with HTTP 200 during SIGTERM (> 4500 ms drain) before container exits with 143
    console.log('Testing in-flight SSR request completion during SIGTERM graceful shutdown...');
    const containerIdRes = child_process.spawnSync(
      'docker',
      ['compose', ...COMPOSE_ARGS, 'ps', '-q', 'app'],
      { cwd: rootDir, env: composeEnv, encoding: 'utf8' }
    );
    const appContainerId = (containerIdRes.stdout || '').trim();
    if (!appContainerId) {
      throw new Error('Could not resolve running app container ID prior to SIGTERM test.');
    }

    const drainTitleMarker = 'Container SIGTERM Drain Verified';
    queryContainerDb(
      `INSERT INTO "AppConfig" ("id", "partner1Name", "partner2Name", "brideName", "groomName", "baseUrl", "seoTitle", "updatedAt")
       VALUES ('global', 'Alex', 'Taylor', 'Alex', 'Taylor', 'http://127.0.0.1:${PORT}', '${drainTitleMarker}', NOW())
       ON CONFLICT ("id") DO UPDATE SET "seoTitle" = '${drainTitleMarker}', "updatedAt" = NOW();`,
      composeEnv
    );

    const lockProc = child_process.spawn(
      'docker',
      ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', composeEnv.DB_USER, '-d', composeEnv.DB_NAME],
      { cwd: rootDir, env: composeEnv, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let lockStdout = '';
    let lockStderr = '';
    let lockReleased = false;

    try {
      const lockReadyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out acquiring AppConfig table lock. stdout=${lockStdout} stderr=${lockStderr}`));
        }, 10000);
        lockProc.stdout.on('data', (chunk) => {
          lockStdout += chunk.toString();
          if (lockStdout.includes('LOCK_ACQUIRED')) {
            clearTimeout(timer);
            resolve();
          }
        });
        lockProc.stderr.on('data', (chunk) => {
          lockStderr += chunk.toString();
        });
        lockProc.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      lockProc.stdin.write('BEGIN;\nLOCK TABLE "AppConfig" IN ACCESS EXCLUSIVE MODE;\nSELECT \'LOCK_ACQUIRED\';\n');
      await lockReadyPromise;

      // Issue in-flight SSR request that blocks on "AppConfig" inside getAppConfig()
      const inflightPromise = request('/guest/login', BASE_URL, PORT, 15000);

      let queryBlockedInDb = false;
      for (let i = 0; i < 50; i++) {
        const waitingCount = Number.parseInt(
          queryContainerDb(
            `SELECT count(*) FROM pg_stat_activity WHERE datname = '${composeEnv.DB_NAME}' AND wait_event_type = 'Lock' AND state = 'active';`,
            composeEnv
          ),
          10
        );
        if (waitingCount >= 1) {
          queryBlockedInDb = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      if (!queryBlockedInDb) {
        throw new Error('In-flight /guest/login request did not reach PostgreSQL lock wait state before SIGTERM.');
      }

      // Deliver SIGTERM via docker compose stop (honoring stop_grace_period: 15s)
      const stopProc = child_process.spawn(
        'docker',
        ['compose', ...COMPOSE_ARGS, 'stop', 'app'],
        { cwd: rootDir, env: composeEnv, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stopOutput = '';
      const stopStartedPromise = new Promise((resolve) => {
        const onChunk = (chunk) => {
          stopOutput += chunk.toString();
          if (/Stopping|Container/i.test(stopOutput)) {
            resolve();
          }
        };
        stopProc.stdout.on('data', onChunk);
        stopProc.stderr.on('data', onChunk);
        setTimeout(resolve, 250);
      });
      await stopStartedPromise;

      // Hold the in-flight request past the removed 4500 ms fallbackTimer (5000 ms)
      await new Promise((r) => setTimeout(r, 5000));

      const runningDuringDrain = child_process
        .spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', appContainerId], {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
        })
        .stdout.trim();
      if (runningDuringDrain !== 'true') {
        throw new Error(
          `App container exited prematurely before in-flight request finished draining (State.Running=${runningDuringDrain})`
        );
      }

      // Release table lock so the in-flight SSR request completes
      lockReleased = true;
      const lockExitPromise = new Promise((resolve) => lockProc.once('close', resolve));
      lockProc.stdin.end('COMMIT;\n\\q\n');
      await lockExitPromise;

      const inflightRes = await inflightPromise;
      if (inflightRes.statusCode !== 200) {
        throw new Error(`In-flight /guest/login during SIGTERM returned status ${inflightRes.statusCode}, expected 200`);
      }
      if (!inflightRes.body.includes(drainTitleMarker)) {
        throw new Error('In-flight /guest/login response did not include database-backed AppConfig title marker.');
      }

      const stopExitCode = await new Promise((resolve, reject) => {
        stopProc.once('error', reject);
        stopProc.once('close', resolve);
      });
      if (stopExitCode !== 0) {
        throw new Error(`docker compose stop app failed with status ${stopExitCode}: ${stopOutput}`);
      }

      const containerExitCode = child_process
        .spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', appContainerId], {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
        })
        .stdout.trim();
      if (containerExitCode !== '143') {
        throw new Error(`Expected app container exit code 143 after SIGTERM drain, got ${containerExitCode}`);
      }

      const dbLogsAfterStop =
        child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', '--no-color', 'db'], {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
        }).stdout || '';
      if (/unexpected EOF on client connection|Connection reset by peer/i.test(dbLogsAfterStop)) {
        throw new Error(`PostgreSQL reported abrupt socket closure during SIGTERM drain:\n${dbLogsAfterStop}`);
      }

      console.log('✅ In-flight request returned HTTP 200 after >4500 ms SIGTERM drain and container exited with code 143!');
    } finally {
      if (!lockReleased) {
        try {
          lockProc.stdin.end('ROLLBACK;\n\\q\n');
        } catch {
          // Ignore stdin errors during cleanup
        }
        try {
          lockProc.kill();
        } catch {
          // Ignore kill errors during cleanup
        }
      }
    }

    console.log('=============================================');
    console.log('🎉 Container execution & migration smoke tests PASSED!');
    console.log('=============================================');
    passed = true;
  } catch (err) {
    console.error('\n❌ Container Smoke Test FAILED!');
    console.error(err.message || err);
    printLogs(activeComposeEnv);
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up container resources...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
      stdio: 'ignore',
      shell: true,
      cwd: rootDir,
      env: activeComposeEnv,
    });
    process.exit(passed ? 0 : 1);
  }
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('test-container.mjs');

if (isDirectCall) {
  main();
}
