import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAvailableDbPort,
  httpRequest,
  runCheckedCommand,
  runSmokeRouteProbes,
  waitForPostgresReady,
  waitForServerReady,
} from './smoke-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.TEST_PORT || '3000';
const HOST_HEADER = `127.0.0.1:${PORT}`;
const BASE_URL = `http://${HOST_HEADER}`;
const COMPOSE_ARGS = ['-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];
const CI_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

const DEFAULT_GHA_CACHE_SCOPE = process.arch === 'arm64' ? 'app-arm64' : 'app-amd64';

function buildCiComposeEnv(extra = {}) {
  const env = {
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
    POSTGRES_URL_NON_POOLING: '',
    ...extra,
  };
  return env;
}

function request(urlPath, timeoutMs = 5000) {
  return httpRequest(BASE_URL, urlPath, {
    hostHeader: HOST_HEADER,
    timeoutMs,
  });
}

function queryContainerDb(sql, composeEnv) {
  const res = child_process.spawnSync(
    'docker',
    [
      'compose',
      ...COMPOSE_ARGS,
      'exec',
      '-T',
      'db',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-U',
      'wedding',
      '-d',
      'wedding',
      '-c',
      sql,
    ],
    { cwd: rootDir, env: composeEnv, encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`psql query failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function printLogs() {
  const composeEnv = buildCiComposeEnv();
  console.error('\n=== Actionable Migration Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'migration'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: rootDir,
    env: composeEnv,
  });
  console.error('\n=== Actionable App Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'app'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: rootDir,
    env: composeEnv,
  });
  console.error('\n=== Actionable DB Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'db'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: rootDir,
    env: composeEnv,
  });
}

async function main() {
  console.log('=== OCI Container & Clean Database Smoke Test ===');

  let passed = false;

  try {
    // 1. Clean up any leftover containers and lingering port listeners before selecting ports
    console.log('Cleaning up any existing containers and listeners...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      cwd: rootDir,
      env: buildCiComposeEnv(),
    });
    try {
      child_process.spawnSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', {
        shell: true,
        stdio: 'ignore',
      });
    } catch {
      // Ignore if lsof is not available
    }

    const dbPort = await getAvailableDbPort();
    process.env.DB_PORT = dbPort.toString();
    const composeEnv = buildCiComposeEnv({ DB_PORT: dbPort.toString() });
    console.log(`Using host database port ${dbPort} for container smoke test...`);

    // 2. Start PostgreSQL from scratch
    console.log('Starting clean PostgreSQL database container...');
    runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], {
      cwd: rootDir,
      env: composeEnv,
    });

    // 3. Wait for PostgreSQL container TCP health check & host port opening
    console.log('Waiting for PostgreSQL container TCP readiness...');
    await waitForPostgresReady({
      composeArgs: COMPOSE_ARGS,
      composeEnv,
      rootDir,
      host: '127.0.0.1',
      port: dbPort,
      dbUser: composeEnv.DB_USER,
      dbName: composeEnv.DB_NAME,
      maxAttempts: 30,
    });
    console.log('✅ PostgreSQL container is ready!');

    const skipImageBuild = process.env.SKIP_IMAGE_BUILD === 'true';
    const hostPrismaBin = path.join(
      rootDir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
    );
    const useHostPrisma =
      process.argv.includes('--host-migration') && fs.existsSync(hostPrismaBin);

    if (skipImageBuild) {
      runCheckedCommand('docker', ['image', 'inspect', 'wedding-website:latest'], {
        cwd: rootDir,
        stdio: 'ignore',
        env: composeEnv,
      });
    } else if (!useHostPrisma) {
      console.log(
        'Building OCI image via Docker Compose ahead of container-based migration smoke test...'
      );
      runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        cwd: rootDir,
        env: composeEnv,
      });
    }

    // 4. Test clean-database migration path (containerized migration service by default)
    console.log('Testing clean-database Prisma migration deploy path...');
    if (useHostPrisma) {
      const migrateEnv = {
        ...process.env,
        DATABASE_URL: `postgresql://wedding:wedding123@localhost:${dbPort}/wedding`,
        DB_PORT: dbPort.toString(),
      };
      delete migrateEnv.POSTGRES_URL_NON_POOLING;
      runCheckedCommand('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: rootDir,
        env: migrateEnv,
      });
    } else {
      runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'run', '--rm', 'migration'], {
        cwd: rootDir,
        env: composeEnv,
      });
    }
    console.log('✅ Clean-database migrations applied successfully!');

    // 5. Build OCI image (only if --host-migration deferred build) & start app container
    if (skipImageBuild) {
      console.log(
        'Starting pre-built OCI app container via Docker Compose (SKIP_IMAGE_BUILD=true)...'
      );
    } else if (useHostPrisma) {
      console.log('Building OCI image and starting app container via Docker Compose...');
      runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        cwd: rootDir,
        env: composeEnv,
      });
    } else {
      console.log('Starting newly built OCI app container via Docker Compose...');
    }
    runCheckedCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', '--no-build', 'app'], {
      cwd: rootDir,
      env: composeEnv,
    });

    // 6. Poll app container readiness via /api/ready
    console.log(`Waiting for application container readiness on ${BASE_URL}/api/ready...`);
    await waitForServerReady({
      baseUrl: BASE_URL,
      hostHeader: HOST_HEADER,
      maxAttempts: 60,
      intervalMs: 2000,
      label: 'App container',
    });
    console.log('✅ App container is ready!');

    // 7. Execute shared liveness, health, schema readiness, static asset, and authenticated data-backed probes
    await runSmokeRouteProbes({
      baseUrl: BASE_URL,
      hostHeader: HOST_HEADER,
      guestPasscode: composeEnv.GUEST_PASSCODE,
      label: 'container',
    });

    // 8. Verify shared globalThis pool across concurrent API and SSR traffic (<= 10 PostgreSQL connections)
    console.log('Testing shared pg.Pool connection cap across concurrent API and SSR traffic...');
    const concurrentRequests = [
      ...Array.from({ length: 12 }, () => request('/api/ready', 15000)),
      ...Array.from({ length: 12 }, () => request('/guest/login', 15000)),
    ];
    const concurrentResults = await Promise.all(concurrentRequests);
    for (const [idx, res] of concurrentResults.entries()) {
      if (res.statusCode !== 200) {
        throw new Error(
          `Concurrent request #${idx} returned unexpected status ${res.statusCode}`
        );
      }
    }

    const activeBackendsRaw = queryContainerDb(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = 'wedding' AND usename = 'wedding' AND pid <> pg_backend_pid();",
      composeEnv
    );
    const activeBackends = parseInt(activeBackendsRaw, 10);
    if (!Number.isFinite(activeBackends) || activeBackends < 1 || activeBackends > 10) {
      throw new Error(
        `Expected 1..10 PostgreSQL pool connections across API & SSR runtimes, observed ${activeBackendsRaw}`
      );
    }

    const appLogsBeforeStop =
      child_process.spawnSync(
        'docker',
        ['compose', ...COMPOSE_ARGS, 'logs', '--no-color', 'app'],
        { cwd: rootDir, env: composeEnv, encoding: 'utf8' }
      ).stdout || '';
    const poolInitMatches =
      appLogsBeforeStop.match(
        /DEBUG \[createPrismaClient\]: Initializing PostgreSQL database client/g
      ) || [];
    if (poolInitMatches.length !== 1) {
      throw new Error(
        `Expected exactly 1 Prisma/pg.Pool initialization across standalone runtimes, observed ${poolInitMatches.length}`
      );
    }
    console.log(
      `✅ Shared globalThis pool verified (${activeBackends} PostgreSQL connections <= 10, 1 runtime initialization)`
    );

    // 9. Verify in-flight request completes with HTTP 200 during SIGTERM (> 4500 ms drain) before container exits with 143
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
      [
        'compose',
        ...COMPOSE_ARGS,
        'exec',
        '-T',
        'db',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-U',
        'wedding',
        '-d',
        'wedding',
      ],
      { cwd: rootDir, env: composeEnv, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let lockStdout = '';
    let lockStderr = '';
    let lockReleased = false;

    try {
      const lockReadyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out acquiring AppConfig table lock. stdout=${lockStdout} stderr=${lockStderr}`
            )
          );
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

      lockProc.stdin.write(
        'BEGIN;\nLOCK TABLE "AppConfig" IN ACCESS EXCLUSIVE MODE;\nSELECT \'LOCK_ACQUIRED\';\n'
      );
      await lockReadyPromise;

      // Issue in-flight SSR request that blocks on "AppConfig" inside getAppConfig()
      const inflightPromise = request('/guest/login', 15000);

      let queryBlockedInDb = false;
      for (let i = 0; i < 50; i++) {
        const waitingCount = parseInt(
          queryContainerDb(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = 'wedding' AND wait_event_type = 'Lock' AND state = 'active';",
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
        throw new Error(
          'In-flight /guest/login request did not reach PostgreSQL lock wait state before SIGTERM.'
        );
      }

      // Deliver SIGTERM via docker compose stop (honoring stop_grace_period: 15s)
      const stopProc = child_process.spawn('docker', ['compose', ...COMPOSE_ARGS, 'stop', 'app'], {
        cwd: rootDir,
        env: composeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
        throw new Error(
          `In-flight /guest/login during SIGTERM returned status ${inflightRes.statusCode}, expected 200`
        );
      }
      if (!inflightRes.body.includes(drainTitleMarker)) {
        throw new Error(
          'In-flight /guest/login response did not include database-backed AppConfig title marker.'
        );
      }

      const stopExitCode = await new Promise((resolve, reject) => {
        stopProc.once('error', reject);
        stopProc.once('close', resolve);
      });
      if (stopExitCode !== 0) {
        throw new Error(
          `docker compose stop app failed with status ${stopExitCode}: ${stopOutput}`
        );
      }

      const containerExitCode = child_process
        .spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', appContainerId], {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
        })
        .stdout.trim();
      if (containerExitCode !== '143') {
        throw new Error(
          `Expected app container exit code 143 after SIGTERM drain, got ${containerExitCode}`
        );
      }

      const dbLogsAfterStop =
        child_process.spawnSync(
          'docker',
          ['compose', ...COMPOSE_ARGS, 'logs', '--no-color', 'db'],
          {
            cwd: rootDir,
            env: composeEnv,
            encoding: 'utf8',
          }
        ).stdout || '';
      if (/unexpected EOF on client connection|Connection reset by peer/i.test(dbLogsAfterStop)) {
        throw new Error(
          `PostgreSQL reported abrupt socket closure during SIGTERM drain:\n${dbLogsAfterStop}`
        );
      }

      console.log(
        '✅ In-flight request returned HTTP 200 after >4500 ms SIGTERM drain and container exited with code 143!'
      );
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
    console.error(err instanceof Error ? err.message : err);
    printLogs();
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up container resources...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      cwd: rootDir,
      env: buildCiComposeEnv(),
    });
    process.exit(passed ? 0 : 1);
  }
}

main();
