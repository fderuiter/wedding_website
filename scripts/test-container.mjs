import child_process from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.TEST_PORT || '3000';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const COMPOSE_ARGS = ['-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];
const CI_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

const DEFAULT_GHA_CACHE_SCOPE = process.arch === 'arm64' ? 'app-arm64' : 'app-amd64';

function buildCiComposeEnv(extra = {}) {
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

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, BASE_URL);
    const req = http.get(fullUrl, {
      headers: {
        'Host': `127.0.0.1:${PORT}`,
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
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

function printLogs() {
  const composeEnv = buildCiComposeEnv();
  console.error('\n=== Actionable Migration Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'migration'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
  console.error('\n=== Actionable App Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'app'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
  console.error('\n=== Actionable DB Container Logs ===');
  child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'logs', 'db'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
}

async function getAvailableDbPort() {
  if (process.env.DB_PORT) {
    return parseInt(process.env.DB_PORT, 10);
  }
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(5433);
    });
    server.once('listening', () => {
      server.close(() => resolve(5432));
    });
    server.listen(5432, '127.0.0.1');
  });
}

async function main() {
  console.log('=== OCI Container & Clean Database Smoke Test ===');

  let passed = false;

  try {
    // 1. Clean up any leftover containers and lingering port listeners before selecting ports
    console.log('Cleaning up any existing containers and listeners...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], { stdio: 'ignore', shell: true, cwd: rootDir, env: buildCiComposeEnv() });
    try {
      child_process.spawnSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', { shell: true, stdio: 'ignore' });
    } catch {
      // Ignore if lsof is not available
    }

    const dbPort = await getAvailableDbPort();
    process.env.DB_PORT = dbPort.toString();
    console.log(`Using host database port ${dbPort} for container smoke test...`);

    // 2. Start PostgreSQL from scratch
    console.log('Starting clean PostgreSQL database container...');
    runCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], {
      env: buildCiComposeEnv({ DB_PORT: dbPort.toString() })
    });

    // 3. Wait for PostgreSQL container health check & port opening
    console.log('Waiting for PostgreSQL container to become ready...');
    let dbReady = false;
    for (let i = 0; i < 30; i++) {
      const check = child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'pg_isready', '-U', 'wedding', '-d', 'wedding'], { stdio: 'ignore', shell: true, cwd: rootDir, env: buildCiComposeEnv({ DB_PORT: dbPort.toString() }) });
      if (check.status === 0) {
        dbReady = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
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
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!portReady) {
      throw new Error(`PostgreSQL port ${dbPort} not reachable on localhost within 30 seconds.`);
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
    const composeEnv = buildCiComposeEnv({ DB_PORT: dbPort.toString() });

    if (skipImageBuild) {
      runCommand('docker', ['image', 'inspect', 'wedding-website:latest'], {
        stdio: 'ignore',
        env: composeEnv
      });
    } else if (!useHostPrisma) {
      console.log('Building OCI image via Docker Compose ahead of container-based migration smoke test...');
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        env: composeEnv
      });
    }

    // 4. Test clean-database migration path
    console.log('Testing clean-database Prisma migration deploy path...');
    if (useHostPrisma) {
      const testDbUrl = `postgresql://wedding:wedding123@localhost:${dbPort}/wedding`;
      runCommand('npx', ['prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: testDbUrl, DB_PORT: dbPort.toString() }
      });
    } else {
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'run', '--rm', 'migration'], {
        env: composeEnv
      });
    }
    console.log('✅ Clean-database migrations applied successfully!');

    // 5. Build OCI image (unless pre-built) & start app container
    if (skipImageBuild) {
      console.log('Starting pre-built OCI app container via Docker Compose (SKIP_IMAGE_BUILD=true)...');
    } else if (useHostPrisma) {
      console.log('Building OCI image and starting app container via Docker Compose...');
      runCommand('docker', ['compose', ...COMPOSE_ARGS, 'build', 'app'], {
        env: composeEnv
      });
    } else {
      console.log('Starting newly built OCI app container via Docker Compose...');
    }
    runCommand('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', '--no-build', 'app'], {
      env: composeEnv
    });

    // 6. Poll app container health/readiness
    console.log('Waiting for application container to respond on http://127.0.0.1:3000...');
    let appReady = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await request('/api/health');
        if (res.statusCode === 200) {
          appReady = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!appReady) {
      throw new Error('App container failed to respond on /api/health within 120 seconds.');
    }

    console.log('✅ App container is responsive!');

    // 7. Verify Liveness Probe
    console.log('Testing GET /api/live against container...');
    const liveRes = await request('/api/live');
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
    const healthRes = await request('/api/health');
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
    const readyRes = await request('/api/ready');
    if (readyRes.statusCode !== 200) {
      throw new Error(`Container /api/ready returned status ${readyRes.statusCode}`);
    }
    const readyJson = JSON.parse(readyRes.body);
    if (readyJson.status !== 'ready') {
      throw new Error(`Container /api/ready body invalid: ${readyRes.body}`);
    }
    console.log('✅ Container /api/ready OK');

    // 9. Verify Representative Public Routes
    const routesToTest = [
      { path: '/guest/login', expectedStatus: 200, name: 'Guest Login page' },
      { path: '/', expectedStatus: 303, name: 'Home page (redirects when unauthenticated)' },
      { path: '/api/registry/items', expectedStatus: 401, name: 'Registry items API (requires auth)' },
    ];

    for (const route of routesToTest) {
      console.log(`Testing container route ${route.name} (${route.path})...`);
      const res = await request(route.path);
      if (res.statusCode !== route.expectedStatus) {
        throw new Error(`Container route ${route.path} returned status ${res.statusCode}, expected ${route.expectedStatus}`);
      }
      console.log(`✅ Container ${route.name} (${route.path}) returned ${res.statusCode}`);
    }

    console.log('=============================================');
    console.log('🎉 Container execution & migration smoke tests PASSED!');
    console.log('=============================================');
    passed = true;

  } catch (err) {
    console.error('\n❌ Container Smoke Test FAILED!');
    console.error(err.message || err);
    printLogs();
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up container resources...');
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], { stdio: 'ignore', shell: true, cwd: rootDir, env: buildCiComposeEnv() });
    process.exit(passed ? 0 : 1);
  }
}

main();
