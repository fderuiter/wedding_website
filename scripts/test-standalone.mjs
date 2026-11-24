import child_process from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createComposePsqlDriver,
  httpRequest as smokeHttpRequest,
  runCheckedCommand,
  runSigtermDrainProbe,
  runSmokeRouteProbes,
  waitForChildProcessExit,
  waitForPostgresReady,
  waitForServerReady,
} from './smoke-runner.mjs';

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

async function createDirectPgDriver(databaseUrl, dbName) {
  const pgModule = await import('pg');
  const PgClient = pgModule.default?.Client || pgModule.Client;
  return {
    dbName,
    async queryDb(sql) {
      const client = new PgClient({ connectionString: databaseUrl });
      await client.connect();
      try {
        const res = await client.query(sql);
        const firstRow = res.rows?.[0];
        if (!firstRow) return '';
        const firstKey = Object.keys(firstRow)[0];
        return firstKey !== undefined ? String(firstRow[firstKey] ?? '') : '';
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    async acquireExclusiveLock(tableName = 'AppConfig') {
      const safeTable = String(tableName).replace(/"/g, '""');
      const lockClient = new PgClient({ connectionString: databaseUrl });
      await lockClient.connect();
      await lockClient.query('BEGIN');
      await lockClient.query(`LOCK TABLE "${safeTable}" IN ACCESS EXCLUSIVE MODE`);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            await lockClient.query('COMMIT');
          } finally {
            await lockClient.end().catch(() => undefined);
          }
        },
        async cleanup() {
          if (released) return;
          released = true;
          try {
            await lockClient.query('ROLLBACK');
          } catch {
            // Ignore rollback cleanup errors
          } finally {
            await lockClient.end().catch(() => undefined);
          }
        },
      };
    },
  };
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

  const portNum = await getAvailableLoopbackPort(process.env.TEST_PORT);
  const PORT = String(portNum);
  const HOST_HEADER = `127.0.0.1:${PORT}`;
  const BASE_URL = `http://${HOST_HEADER}`;
  const httpRequest = (urlPath, options = {}) =>
    smokeHttpRequest(BASE_URL, urlPath, {
      hostHeader: HOST_HEADER,
      ...options,
    });

  const dbTarget = await resolveStandaloneDatabaseTarget(process.env, [portNum]);
  const standaloneUploadsDir = path.join(standalonePublicDir, 'uploads');
  const uploadedStandaloneFiles = [];

  // 3. Prepare environment for standalone server execution
  const ephemeralAdminPassword = process.env.ADMIN_PASSWORD || createEphemeralScryptHash();
  const ephemeralGuestPasscode =
    process.env.GUEST_PASSCODE || `standalone-passcode-${crypto.randomBytes(8).toString('hex')}`;
  const ephemeralGuestSessionSecret =
    process.env.GUEST_SESSION_SECRET ||
    `standalone-session-secret-${crypto.randomBytes(24).toString('hex')}`;

  const configuredDbUrl = dbTarget.databaseUrl;
  let targetDbHost = '127.0.0.1';
  let targetDbPort = dbTarget.dbPort ?? 5432;
  let dbUser = process.env.DB_USER || 'wedding';
  let dbName = process.env.DB_NAME || 'wedding';

  try {
    const parsedDb = new URL(configuredDbUrl);
    if (parsedDb.hostname) {
      targetDbHost = parsedDb.hostname === 'localhost' ? '127.0.0.1' : parsedDb.hostname;
    }
    if (parsedDb.port) {
      targetDbPort = Number.parseInt(parsedDb.port, 10);
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
    PORT,
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

  let managedComposeDb = false;
  let serverProcess = null;
  let serverExitPromise = null;
  let serverLogs = '';
  let killed = false;
  let passed = false;

  const cleanup = () => {
    if (
      !killed &&
      serverProcess &&
      serverProcess.exitCode === null &&
      serverProcess.signalCode === null
    ) {
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
    if (dbTarget.useComposeDb) {
      console.log(
        `Resetting and starting isolated PostgreSQL container on 127.0.0.1:${targetDbPort} for standalone smoke test...`
      );
      child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
        cwd: rootDir,
        env: composeEnv,
      });
      managedComposeDb = true;

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
    } else {
      console.log('Using caller-supplied DATABASE_URL; skipping isolated database container startup.');
    }

    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
      console.log('Applying Prisma migrations against PostgreSQL database...');
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
    serverExitPromise = waitForChildProcessExit(serverProcess, 15000);
    serverExitPromise.catch(() => undefined);

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
          Cookie: guestCookie,
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
    const uploadedItem = uploadJson?.data?.[0];
    if (
      uploadJson.success !== true ||
      !uploadedItem ||
      typeof uploadedItem.id !== 'string' ||
      typeof uploadedItem.nodeId !== 'string' ||
      uploadedItem.status !== 'PENDING' ||
      uploadedItem.isVisible !== false ||
      'url' in uploadedItem
    ) {
      throw new Error(`Unexpected HEIC upload response payload: ${uploadRes.body}`);
    }

    const unauthPhotoProbe = await httpRequest('/uploads/photos/nonexistent-probe.jpg', {
      timeoutMs: 3000,
    });
    if (unauthPhotoProbe.statusCode !== 401) {
      throw new Error(
        `Expected unauthenticated /uploads/photos/* probe to return 401, got ${unauthPhotoProbe.statusCode}`
      );
    }

    if (duringUploadLiveRes.statusCode !== 200) {
      throw new Error(
        `Concurrent /api/live during HEIC upload returned status ${duringUploadLiveRes.statusCode}`
      );
    }
    const postUploadLiveRes = await httpRequest('/api/live', { timeoutMs: 1000 });
    if (postUploadLiveRes.statusCode !== 200 || JSON.parse(postUploadLiveRes.body).status !== 'alive') {
      throw new Error(
        `Post-upload /api/live check failed (${postUploadLiveRes.statusCode}): ${postUploadLiveRes.body}`
      );
    }

    // Allow stdout/stderr pipe flush before inspecting logs
    await new Promise((r) => setTimeout(r, 100));
    if (WORKER_ERROR_LOG_PATTERN.test(serverLogs)) {
      throw new Error(
        `Standalone server logged worker or sanitization errors during HEIC upload:\n${serverLogs}`
      );
    }
    if (!serverLogs.includes('Successfully transcoded and sanitized HEIC/HEIF image to image/jpeg')) {
      throw new Error(
        `Expected standalone worker HEIC transcoding confirmation in logs, observed:\n${serverLogs}`
      );
    }
    console.log(
      `✅ Standalone HEIC upload transcoded via worker (nodeId=${uploadedItem.nodeId}, url withheld while PENDING), /uploads/photos/* gated 401, /api/live responsive, 0 worker errors`
    );

    // Test 5: Verify unauthenticated /guest/login redaction and authenticated SIGTERM lock draining before stopping PostgreSQL
    const standaloneDbDriver = dbTarget.useComposeDb
      ? createComposePsqlDriver({
        composeArgs: COMPOSE_ARGS,
        composeEnv,
        rootDir,
      })
      : await createDirectPgDriver(configuredDbUrl, dbName);

    await runSigtermDrainProbe({
      baseUrl: BASE_URL,
      hostHeader: HOST_HEADER,
      guestCookie,
      guestPasscode: ephemeralGuestPasscode,
      drainTitleMarker: 'Standalone SIGTERM Drain Verified',
      holdMs: 5000,
      dbDriver: standaloneDbDriver,
      label: 'standalone',
      async triggerStop() {
        cleanup();
      },
      async isRunningDuringDrain() {
        return (
          serverProcess !== null &&
          serverProcess.exitCode === null &&
          serverProcess.signalCode === null
        );
      },
      async waitForExitCode() {
        const { exitCode } = await serverExitPromise;
        return exitCode;
      },
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
    if (serverProcess && serverExitPromise) {
      try {
        const { exitCode, signal } = await serverExitPromise;
        if (passed && exitCode !== 143) {
          console.error(
            `❌ Standalone server exited with code ${exitCode} (signal=${signal}), expected 143.`
          );
          passed = false;
          process.exitCode = 1;
        }
      } catch (drainErr) {
        try {
          serverProcess.kill('SIGKILL');
        } catch {
          // Ignore SIGKILL cleanup errors
        }
        if (passed) {
          console.error(drainErr instanceof Error ? drainErr.message : drainErr);
          passed = false;
          process.exitCode = 1;
        }
      }
    }
    process.off('exit', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
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
    if (managedComposeDb) {
      child_process.spawnSync('docker', ['compose', ...COMPOSE_ARGS, 'down', '-v'], {
        stdio: 'ignore',
        shell: process.platform === 'win32',
        cwd: rootDir,
        env: composeEnv,
      });
    }
    process.exit(passed ? 0 : 1);
  }
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('test-standalone.mjs');

if (isDirectCall) {
  main();
}
