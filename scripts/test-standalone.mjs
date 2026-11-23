import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.TEST_PORT || '3001';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const COMPOSE_ARGS = ['-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];

// Real 16x16 HEIC fixture (ISOBMFF ftyp=heic, HEVC primary frame)
const VALID_HEIC_BUFFER = Buffer.from(
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADUAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAPW1kYXQAAAAxKAGvBPIWZzRxZNLf+Cv///V4+y/SYUEm1Qjs/VLEYCa/deugZMTNE6ls0CgrqKdepg==',
  'base64'
);
const WORKER_ERROR_LOG_PATTERN =
  /Image processor worker|Failed to sanitize image|Failed to initialize image processor worker|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_WORKER|Unhandled API Error/i;

function createEphemeralScryptHash() {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(crypto.randomBytes(24).toString('hex'), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

function httpRequest(urlPath, options = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 5000 } = options;
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, BASE_URL);
    const req = http.request(fullUrl, {
      method,
      headers: {
        'Host': `127.0.0.1:${PORT}`,
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlPath}`));
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function request(urlPath) {
  return httpRequest(urlPath);
}

function buildHeicMultipartPayload(boundary) {
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="smoke-test.HEIC"\r\n' +
    'Content-Type: image/heic\r\n\r\n',
    'utf8'
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([preamble, VALID_HEIC_BUFFER, epilogue]);
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

  const standaloneUploadsDir = path.join(standalonePublicDir, 'uploads');
  const uploadedStandaloneFiles = [];

  // Prepare environment for standalone server execution
  const ephemeralAdminPassword = process.env.ADMIN_PASSWORD || createEphemeralScryptHash();
  const ephemeralGuestPasscode =
    process.env.GUEST_PASSCODE || `standalone-passcode-${crypto.randomBytes(8).toString('hex')}`;
  const ephemeralGuestSessionSecret =
    process.env.GUEST_SESSION_SECRET ||
    `standalone-session-secret-${crypto.randomBytes(24).toString('hex')}`;
  const composeEnv = {
    ...process.env,
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
    PORT: PORT,
    HOSTNAME: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,127.0.0.1:${PORT}`,
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding',
    ADMIN_PASSWORD: ephemeralAdminPassword,
    GUEST_PASSCODE: ephemeralGuestPasscode,
    GUEST_SESSION_SECRET: ephemeralGuestSessionSecret,
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
      child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'up', '-d', 'db'], { stdio: 'inherit', shell: true, cwd: rootDir, env: composeEnv });
      let dbReady = false;
      for (let i = 0; i < 30; i++) {
        const check = child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'exec', '-T', 'db', 'pg_isready', '-U', 'wedding', '-d', 'wedding'], { stdio: 'ignore', shell: true, cwd: rootDir, env: composeEnv });
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

    // Test 0: Verify Liveness (/api/live)
    console.log('Testing GET /api/live...');
    const liveRes = await request('/api/live');
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

    // Test 4: Verify Guest Login, Standalone Worker HEIC Upload, /api/live Responsiveness, and Zero Worker Errors
    console.log('Testing POST /api/guest/login and HEIC worker upload to /api/guest/photos/upload...');
    const loginPayload = JSON.stringify({ passcode: ephemeralGuestPasscode });
    const loginRes = await httpRequest('/api/guest/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(loginPayload)),
      },
      body: loginPayload,
    });
    if (loginRes.statusCode !== 200) {
      throw new Error(`Guest login failed with status ${loginRes.statusCode}: ${loginRes.body}`);
    }
    const rawSetCookie = loginRes.headers['set-cookie'];
    const setCookies = Array.isArray(rawSetCookie) ? rawSetCookie : (rawSetCookie ? [rawSetCookie] : []);
    const guestCookie = setCookies
      .map((header) => header.split(';')[0].trim())
      .find((pair) => pair.startsWith('guest_auth='));
    if (!guestCookie) {
      throw new Error('Guest login response did not set guest_auth cookie.');
    }

    const boundary = `----StandaloneHeicSmokeBoundary${crypto.randomBytes(8).toString('hex')}`;
    const multipartBody = buildHeicMultipartPayload(boundary);
    const [uploadRes, duringUploadLiveRes] = await Promise.all([
      httpRequest('/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          'Cookie': guestCookie,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
        timeoutMs: 15000,
      }),
      httpRequest('/api/live', { timeoutMs: 1000 }),
    ]);

    if (uploadRes.statusCode !== 201) {
      throw new Error(`HEIC photo upload returned status ${uploadRes.statusCode}: ${uploadRes.body}`);
    }
    const uploadJson = JSON.parse(uploadRes.body);
    const uploadedUrl = uploadJson?.data?.[0]?.url;
    if (uploadJson.success !== true || typeof uploadedUrl !== 'string' || !/^\/uploads\/photos\/[a-f0-9]+\.jpg$/.test(uploadedUrl)) {
      throw new Error(`Unexpected HEIC upload response payload: ${uploadRes.body}`);
    }
    uploadedStandaloneFiles.push(path.join(standalonePublicDir, uploadedUrl.replace(/^\/+/, '')));

    if (duringUploadLiveRes.statusCode !== 200) {
      throw new Error(`Concurrent /api/live during HEIC upload returned status ${duringUploadLiveRes.statusCode}`);
    }
    const postUploadLiveRes = await httpRequest('/api/live', { timeoutMs: 1000 });
    if (postUploadLiveRes.statusCode !== 200 || JSON.parse(postUploadLiveRes.body).status !== 'alive') {
      throw new Error(`Post-upload /api/live check failed (${postUploadLiveRes.statusCode}): ${postUploadLiveRes.body}`);
    }

    // Allow stdout/stderr pipe flush before inspecting logs
    await new Promise((r) => setTimeout(r, 100));
    if (WORKER_ERROR_LOG_PATTERN.test(serverLogs)) {
      throw new Error(`Standalone server logged worker or sanitization errors during HEIC upload:\n${serverLogs}`);
    }
    if (!serverLogs.includes('Successfully transcoded and sanitized HEIC/HEIF image to image/jpeg')) {
      throw new Error(`Expected standalone worker HEIC transcoding confirmation in logs, observed:\n${serverLogs}`);
    }
    console.log(`✅ Standalone HEIC upload transcoded via worker (${uploadedUrl}), /api/live responsive, 0 worker errors`);

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
    // Clean up uploaded smoke-test files in .next/standalone/public/uploads
    for (const uploadedFilePath of uploadedStandaloneFiles) {
      try {
        fs.rmSync(uploadedFilePath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      fs.rmSync(standaloneUploadsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], { stdio: 'ignore', shell: true, cwd: rootDir, env: composeEnv });
    // Allow process exit
    setTimeout(() => {
      process.exit(process.exitCode || 0);
    }, 500);
  }
}

main();
