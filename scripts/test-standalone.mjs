import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.TEST_PORT || '3001';
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

  // Prepare environment for standalone server execution
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: PORT,
    HOSTNAME: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,127.0.0.1:${PORT}`,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==',
    GUEST_PASSCODE: process.env.GUEST_PASSCODE || 'wedding2026',
  };

  // Remove any remaining provider flags from env
  for (const v of providerVars) {
    delete env[v];
  }

  // Ensure PostgreSQL container is running and migrations applied if targeting postgres
  const dbUrl = env.DATABASE_URL || '';
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    console.log('Ensuring database is ready for standalone execution...');
    try {
      child_process.spawnSync('docker', ['compose', 'up', '-d', 'db'], { stdio: 'inherit', shell: true, cwd: rootDir });
      let dbReady = false;
      for (let i = 0; i < 30; i++) {
        const check = child_process.spawnSync('docker', ['compose', 'exec', 'db', 'pg_isready', '-U', 'wedding', '-d', 'wedding'], { stdio: 'ignore', shell: true, cwd: rootDir });
        if (check.status === 0) {
          dbReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (dbReady) {
        child_process.spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: true, cwd: rootDir, env: { ...process.env, DATABASE_URL: env.DATABASE_URL } });
      }
    } catch (dbErr) {
      console.warn('⚠️ Database setup check warning:', dbErr.message);
    }
  }

  console.log(`Starting standalone server on port ${PORT}...`);
  const serverProcess = child_process.spawn('node', [standaloneServerPath], {
    cwd: path.join(rootDir, '.next', 'standalone'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProcess.stdout.on('data', chunk => {
    const text = chunk.toString();
    serverLogs += text;
    process.stdout.write(`[standalone] ${text}`);
  });
  serverProcess.stderr.on('data', chunk => {
    const text = chunk.toString();
    serverLogs += text;
    process.stderr.write(`[standalone err] ${text}`);
  });

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
    // Wait for server readiness
    console.log('Waiting for standalone server to accept requests...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await request('/api/health');
        if (res.statusCode === 200) {
          ready = true;
          break;
        }
      } catch {
        // Retry
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!ready) {
      throw new Error('Standalone server failed to respond on /api/health within 30 seconds.');
    }

    console.log('✅ Standalone server is listening!');

    // Test 1: Verify Health (Liveness)
    console.log('Testing GET /api/health...');
    const healthRes = await request('/api/health');
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
    const readyRes = await request('/api/ready');
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
      const res = await request(route.path);
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
    // Allow process exit
    setTimeout(() => {
      process.exit(process.exitCode || 0);
    }, 500);
  }
}

main();
