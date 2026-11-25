import child_process from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function runCheckedCommand(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = child_process.spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) {
    throw new Error(
      `Command failed to spawn (${command} ${args.join(' ')}): ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Command exited with status ${result.status ?? 'signal'}: ${command} ${args.join(' ')}`
    );
  }
  return result;
}

export async function getAvailableDbPort(preferredPort = 5432, fallbackPort = 5433) {
  if (process.env.DB_PORT) {
    return parseInt(process.env.DB_PORT, 10);
  }
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(fallbackPort);
    });
    server.once('listening', () => {
      server.close(() => resolve(preferredPort));
    });
    server.listen(preferredPort, '127.0.0.1');
  });
}

function checkTcpSocket(host, port, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TCP connection timeout to ${host}:${port}`));
    });
  });
}

export async function waitForPostgresReady({
  composeArgs,
  composeEnv,
  rootDir,
  host = '127.0.0.1',
  port = 5432,
  dbUser = 'wedding',
  dbName = 'wedding',
  maxAttempts = 30,
}) {
  let dbReady = false;
  for (let i = 0; i < maxAttempts; i++) {
    const check = child_process.spawnSync(
      'docker',
      [
        'compose',
        ...composeArgs,
        'exec',
        '-T',
        'db',
        'pg_isready',
        '-h',
        'localhost',
        '-U',
        dbUser,
        '-d',
        dbName,
      ],
      {
        stdio: 'ignore',
        shell: process.platform === 'win32',
        cwd: rootDir,
        env: composeEnv,
      }
    );
    if (!check.error && check.status === 0) {
      dbReady = true;
      break;
    }
    await sleep(1000);
  }

  if (!dbReady) {
    throw new Error(
      `PostgreSQL container failed pg_isready -h localhost within ${maxAttempts} seconds.`
    );
  }

  let portReady = false;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await checkTcpSocket(host, port, 1000);
      portReady = true;
      break;
    } catch {
      await sleep(1000);
    }
  }

  if (!portReady) {
    throw new Error(
      `PostgreSQL TCP port ${port} was not reachable on ${host} within ${maxAttempts} seconds.`
    );
  }
}

export function httpRequest(baseUrl, urlPath, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = undefined,
    timeoutMs = 5000,
    hostHeader,
  } = options;

  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, baseUrl);
    const bodyBuffer =
      body === undefined
        ? null
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(String(body), 'utf8');

    const requestHeaders = {
      Host: hostHeader || fullUrl.host,
      ...headers,
    };
    if (bodyBuffer && requestHeaders['Content-Length'] === undefined) {
      requestHeaders['Content-Length'] = String(bodyBuffer.length);
    }

    const req = http.request(
      fullUrl,
      {
        method,
        headers: requestHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            rawBody,
            body: rawBody.toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms requesting ${method} ${urlPath}`));
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

export async function waitForServerReady({
  baseUrl,
  hostHeader,
  maxAttempts = 30,
  intervalMs = 1000,
  label = 'Server',
}) {
  let lastStatus = 'unreachable';
  let lastBody = '';

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await httpRequest(baseUrl, '/api/ready', { hostHeader, timeoutMs: 5000 });
      lastStatus = String(res.statusCode);
      lastBody = res.body;
      if (res.statusCode === 200) {
        const parsed = JSON.parse(res.body);
        if (parsed.status === 'ready') {
          return;
        }
      }
    } catch (err) {
      lastStatus = 'error';
      lastBody = err instanceof Error ? err.message : String(err);
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `${label} failed to report ready on GET /api/ready within ${Math.round((maxAttempts * intervalMs) / 1000)}s (last status=${lastStatus}, body=${lastBody})`
  );
}

function extractCookiePair(setCookieHeader, cookieName) {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : typeof setCookieHeader === 'string'
      ? [setCookieHeader]
      : [];
  const prefix = `${cookieName}=`;
  for (const rawCookie of cookies) {
    const firstPair = rawCookie.split(';')[0]?.trim() || '';
    if (firstPair.startsWith(prefix) && firstPair.length > prefix.length) {
      return firstPair;
    }
  }
  return null;
}

export async function runSmokeRouteProbes({
  baseUrl,
  hostHeader,
  guestPasscode,
  label = 'Server',
}) {
  // 1. Liveness (/api/live)
  console.log(`[${label}] Testing GET /api/live...`);
  const liveRes = await httpRequest(baseUrl, '/api/live', { hostHeader });
  if (liveRes.statusCode !== 200) {
    throw new Error(`[${label}] GET /api/live returned ${liveRes.statusCode}: ${liveRes.body}`);
  }
  const liveJson = JSON.parse(liveRes.body);
  if (liveJson.status !== 'alive' || typeof liveJson.timestamp !== 'string') {
    throw new Error(`[${label}] GET /api/live returned invalid payload: ${liveRes.body}`);
  }
  console.log(`✅ [${label}] /api/live OK`);

  // 2. Startup / Rollout Health (/api/health)
  console.log(`[${label}] Testing GET /api/health...`);
  const healthRes = await httpRequest(baseUrl, '/api/health', { hostHeader });
  if (healthRes.statusCode !== 200) {
    throw new Error(`[${label}] GET /api/health returned ${healthRes.statusCode}: ${healthRes.body}`);
  }
  const healthJson = JSON.parse(healthRes.body);
  const healthStatus = healthJson.status || healthJson.data?.status;
  if (healthStatus !== 'ok') {
    throw new Error(`[${label}] GET /api/health returned invalid payload: ${healthRes.body}`);
  }
  console.log(`✅ [${label}] /api/health OK`);

  // 3. Schema-Aware Readiness (/api/ready)
  console.log(`[${label}] Testing GET /api/ready...`);
  const readyRes = await httpRequest(baseUrl, '/api/ready', { hostHeader });
  if (readyRes.statusCode !== 200) {
    throw new Error(`[${label}] GET /api/ready returned ${readyRes.statusCode}: ${readyRes.body}`);
  }
  const readyJson = JSON.parse(readyRes.body);
  if (readyJson.status !== 'ready' || readyJson.database !== 'connected') {
    throw new Error(`[${label}] GET /api/ready returned invalid payload: ${readyRes.body}`);
  }
  console.log(`✅ [${label}] /api/ready OK`);

  // 4. Static Public Asset (/assets/favicon.png)
  console.log(`[${label}] Testing static asset GET /assets/favicon.png...`);
  const faviconRes = await httpRequest(baseUrl, '/assets/favicon.png', { hostHeader });
  if (faviconRes.statusCode !== 200) {
    throw new Error(
      `[${label}] Static asset GET /assets/favicon.png returned ${faviconRes.statusCode} (expected 200)`
    );
  }
  const contentType = String(faviconRes.headers['content-type'] || '');
  if (!contentType.includes('image/png') || faviconRes.rawBody.length === 0) {
    throw new Error(
      `[${label}] Static asset GET /assets/favicon.png returned unexpected content-type="${contentType}" length=${faviconRes.rawBody.length}`
    );
  }
  console.log(`✅ [${label}] /assets/favicon.png OK (${faviconRes.rawBody.length} bytes)`);

  // 5. Public & Auth-Gated Perimeter Routes
  const perimeterRoutes = [
    { path: '/guest/login', expectedStatus: 200, name: 'Guest Login page' },
    { path: '/', expectedStatus: 303, name: 'Home page (unauthenticated redirect)' },
    { path: '/api/registry/items', expectedStatus: 401, name: 'Registry items API (unauthenticated)' },
    { path: '/api/registry/validate-code', expectedStatus: 401, name: 'Registry validate-code API (unauthenticated)' },
  ];
  for (const route of perimeterRoutes) {
    console.log(`[${label}] Testing ${route.name} (${route.path})...`);
    const res = await httpRequest(baseUrl, route.path, { hostHeader });
    if (res.statusCode !== route.expectedStatus) {
      throw new Error(
        `[${label}] Route ${route.path} returned ${res.statusCode}, expected ${route.expectedStatus}`
      );
    }
    if (
      route.path === '/guest/login' &&
      /<title>/i.test(res.body) &&
      !res.body.includes('Guest Sign-In | Wedding Website')
    ) {
      throw new Error(
        `[${label}] Unauthenticated GET /guest/login did not render expected redacted title 'Guest Sign-In | Wedding Website'`
      );
    }
    console.log(`✅ [${label}] ${route.name} (${route.path}) returned ${res.statusCode}`);
  }

  // 6. Authenticated Guest Session + Data-Backed Schema & Registry Items Probes
  console.log(`[${label}] Authenticating guest session via POST /api/guest/login...`);
  const loginRes = await httpRequest(baseUrl, '/api/guest/login', {
    method: 'POST',
    hostHeader,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ passcode: guestPasscode }),
  });
  if (loginRes.statusCode !== 200) {
    throw new Error(
      `[${label}] POST /api/guest/login returned ${loginRes.statusCode} (expected 200): ${loginRes.body}`
    );
  }
  const guestCookie = extractCookiePair(loginRes.headers['set-cookie'], 'guest_auth');
  if (!guestCookie) {
    throw new Error(`[${label}] POST /api/guest/login did not issue a guest_auth Set-Cookie header.`);
  }
  console.log(`✅ [${label}] POST /api/guest/login issued guest_auth session cookie`);

  const validatePath = '/api/registry/validate-code';
  console.log(`[${label}] Testing authenticated data-backed POST ${validatePath}...`);
  const validateRes = await httpRequest(baseUrl, validatePath, {
    method: 'POST',
    hostHeader,
    headers: {
      'Content-Type': 'application/json',
      Cookie: guestCookie,
    },
    body: JSON.stringify({ code: 'SMOKE-NONEXISTENT-CODE' }),
  });
  if (validateRes.statusCode !== 404) {
    throw new Error(
      `[${label}] POST ${validatePath} returned ${validateRes.statusCode} (expected 404): ${validateRes.body}`
    );
  }
  console.log(`✅ [${label}] POST ${validatePath} returned 404 (InvitationCode table verified)`);

  console.log(`[${label}] Testing authenticated GET /api/registry/items...`);
  const itemsRes = await httpRequest(baseUrl, '/api/registry/items', {
    hostHeader,
    headers: {
      Cookie: guestCookie,
    },
  });
  if (itemsRes.statusCode !== 200) {
    throw new Error(
      `[${label}] Authenticated GET /api/registry/items returned ${itemsRes.statusCode} (expected 200): ${itemsRes.body}`
    );
  }
  const itemsJson = JSON.parse(itemsRes.body);
  const itemsPayload = itemsJson.data ?? itemsJson;
  if (!Array.isArray(itemsPayload.items)) {
    throw new Error(
      `[${label}] Authenticated GET /api/registry/items returned unexpected payload: ${itemsRes.body}`
    );
  }
  console.log(
    `✅ [${label}] Authenticated GET /api/registry/items returned 200 (${itemsPayload.items.length} items)`
  );
}

export function waitForChildProcessExit(childProc, timeoutMs = 15000) {
  if (!childProc) {
    return Promise.resolve({ exitCode: null, signal: null });
  }
  if (childProc.exitCode !== null || childProc.signalCode !== null) {
    return Promise.resolve({
      exitCode: childProc.exitCode,
      signal: childProc.signalCode,
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      childProc.removeListener('exit', onExit);
      childProc.removeListener('close', onExit);
      childProc.removeListener('error', onError);
      if (err) {
        reject(err);
      } else {
        resolve(payload);
      }
    };

    const onExit = (code, signal) => {
      finish(null, {
        exitCode: code ?? childProc.exitCode,
        signal: signal ?? childProc.signalCode,
      });
    };
    const onError = (err) => {
      finish(err, null);
    };

    const timer = setTimeout(() => {
      finish(
        new Error(`Timed out after ${timeoutMs}ms waiting for server process to exit after SIGTERM`),
        null
      );
    }, timeoutMs);

    childProc.once('exit', onExit);
    childProc.once('close', onExit);
    childProc.once('error', onError);
  });
}

export function createComposePsqlDriver({ composeArgs, composeEnv, rootDir }) {
  const dbUser = composeEnv.DB_USER || 'wedding';
  const dbName = composeEnv.DB_NAME || 'wedding';

  return {
    dbName,
    queryDb(sql) {
      const res = child_process.spawnSync(
        'docker',
        [
          'compose',
          ...composeArgs,
          'exec',
          '-T',
          'db',
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          '-U',
          dbUser,
          '-d',
          dbName,
          '-c',
          sql,
        ],
        {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        }
      );
      if (res.status !== 0) {
        throw new Error(`psql query failed (${res.status}): ${res.stderr || res.stdout}`);
      }
      return (res.stdout || '').trim();
    },

    async acquireExclusiveLock(tableName = 'AppConfig') {
      const safeTable = String(tableName).replace(/"/g, '""');
      const lockProc = child_process.spawn(
        'docker',
        [
          'compose',
          ...composeArgs,
          'exec',
          '-T',
          'db',
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          '-U',
          dbUser,
          '-d',
          dbName,
        ],
        {
          cwd: rootDir,
          env: composeEnv,
          shell: process.platform === 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      let lockStdout = '';
      let lockStderr = '';
      let released = false;

      const lockReadyPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out acquiring ${tableName} table lock. stdout=${lockStdout} stderr=${lockStderr}`
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
        `BEGIN;\nLOCK TABLE "${safeTable}" IN ACCESS EXCLUSIVE MODE;\nSELECT 'LOCK_ACQUIRED';\n`
      );
      await lockReadyPromise;

      return {
        async release() {
          if (released) return;
          released = true;
          const closePromise = new Promise((resolve) => lockProc.once('close', resolve));
          lockProc.stdin.end('COMMIT;\n\\q\n');
          await closePromise;
        },
        async cleanup() {
          if (released) return;
          released = true;
          try {
            lockProc.stdin.end('ROLLBACK;\n\\q\n');
          } catch {
            // Ignore stdin cleanup errors
          }
          try {
            lockProc.kill();
          } catch {
            // Ignore kill cleanup errors
          }
        },
      };
    },

    getDbLogs() {
      const res = child_process.spawnSync(
        'docker',
        ['compose', ...composeArgs, 'logs', '--no-color', 'db'],
        {
          cwd: rootDir,
          env: composeEnv,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        }
      );
      return res.stdout || '';
    },
  };
}

export async function runSigtermDrainProbe({
  baseUrl,
  hostHeader,
  guestCookie = '',
  guestPasscode = '',
  drainTitleMarker = 'SIGTERM Drain Verified',
  holdMs = 5000,
  lockPollAttempts = 50,
  lockPollIntervalMs = 100,
  dbDriver,
  triggerStop,
  isRunningDuringDrain,
  waitForExitCode,
  label = 'Server',
}) {
  if (!dbDriver || typeof dbDriver.queryDb !== 'function' || typeof dbDriver.acquireExclusiveLock !== 'function') {
    throw new Error(`[${label}] runSigtermDrainProbe requires a dbDriver with queryDb and acquireExclusiveLock.`);
  }

  let activeGuestCookie = guestCookie || '';
  if (!activeGuestCookie) {
    if (!guestPasscode) {
      throw new Error(`[${label}] runSigtermDrainProbe requires guestCookie or guestPasscode.`);
    }
    const loginRes = await httpRequest(baseUrl, '/api/guest/login', {
      method: 'POST',
      hostHeader,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ passcode: guestPasscode }),
    });
    if (loginRes.statusCode !== 200) {
      throw new Error(
        `[${label}] POST /api/guest/login before SIGTERM probe returned ${loginRes.statusCode}: ${loginRes.body}`
      );
    }
    activeGuestCookie = extractCookiePair(loginRes.headers['set-cookie'], 'guest_auth') || '';
  }
  if (!activeGuestCookie.startsWith('guest_auth=')) {
    throw new Error(`[${label}] Missing valid guest_auth cookie for authenticated SIGTERM drain probe.`);
  }

  const safeBaseUrl = String(baseUrl).replace(/'/g, "''");
  const safeMarker = String(drainTitleMarker).replace(/'/g, "''");
  const safeDbName = String(dbDriver.dbName || 'wedding').replace(/'/g, "''");

  await dbDriver.queryDb(
    `INSERT INTO "AppConfig" ("id", "partner1Name", "partner2Name", "brideName", "groomName", "baseUrl", "seoTitle", "updatedAt")
     VALUES ('global', 'Alex', 'Taylor', 'Alex', 'Taylor', '${safeBaseUrl}', '${safeMarker}', NOW())
     ON CONFLICT ("id") DO UPDATE SET
       "partner1Name" = 'Alex',
       "partner2Name" = 'Taylor',
       "brideName" = 'Alex',
       "groomName" = 'Taylor',
       "seoTitle" = '${safeMarker}',
       "updatedAt" = NOW();`
  );

  console.log(`[${label}] Verifying unauthenticated GET /guest/login redacts seoTitle...`);
  const unauthLoginRes = await httpRequest(baseUrl, '/guest/login', {
    hostHeader,
    timeoutMs: 10000,
  });
  if (unauthLoginRes.statusCode !== 200) {
    throw new Error(
      `[${label}] Unauthenticated GET /guest/login returned ${unauthLoginRes.statusCode}, expected 200`
    );
  }
  if (!unauthLoginRes.body.includes('Guest Sign-In | Wedding Website')) {
    throw new Error(
      `[${label}] Unauthenticated GET /guest/login did not render 'Guest Sign-In | Wedding Website'.`
    );
  }
  if (unauthLoginRes.body.includes(drainTitleMarker)) {
    throw new Error(
      `[${label}] Unauthenticated GET /guest/login leaked unredacted seoTitle marker '${drainTitleMarker}'.`
    );
  }
  console.log(
    `✅ [${label}] Unauthenticated GET /guest/login rendered 'Guest Sign-In | Wedding Website' with seoTitle redacted`
  );

  console.log(
    `[${label}] Testing authenticated in-flight SSR request completion during SIGTERM graceful shutdown...`
  );
  const lockHandle = await dbDriver.acquireExclusiveLock('AppConfig');
  try {
    const inflightPromise = httpRequest(baseUrl, '/guest/login', {
      hostHeader,
      headers: {
        Cookie: activeGuestCookie,
      },
      timeoutMs: 15000,
    });

    let queryBlockedInDb = false;
    for (let i = 0; i < lockPollAttempts; i++) {
      const rawWaiting = await dbDriver.queryDb(
        `SELECT count(*) FROM pg_stat_activity WHERE datname = '${safeDbName}' AND wait_event_type = 'Lock' AND state = 'active';`
      );
      const waitingCount = Number.parseInt(String(rawWaiting).trim(), 10);
      if (waitingCount >= 1) {
        queryBlockedInDb = true;
        break;
      }
      await sleep(lockPollIntervalMs);
    }

    if (!queryBlockedInDb) {
      throw new Error(
        `[${label}] In-flight authenticated /guest/login request did not reach PostgreSQL lock wait state before SIGTERM.`
      );
    }

    await triggerStop();
    await sleep(holdMs);

    const stillRunning = await isRunningDuringDrain();
    if (!stillRunning) {
      throw new Error(
        `[${label}] Server exited prematurely before in-flight request finished draining.`
      );
    }

    await lockHandle.release();

    const inflightRes = await inflightPromise;
    if (inflightRes.statusCode !== 200) {
      throw new Error(
        `[${label}] In-flight authenticated /guest/login during SIGTERM returned status ${inflightRes.statusCode}, expected 200`
      );
    }
    if (!inflightRes.body.includes(drainTitleMarker)) {
      throw new Error(
        `[${label}] In-flight authenticated /guest/login response did not include database-backed AppConfig title marker.`
      );
    }

    const exitCode = await waitForExitCode();
    if (String(exitCode) !== '143') {
      throw new Error(
        `[${label}] Expected exit code 143 after SIGTERM drain, got ${exitCode}`
      );
    }

    if (typeof dbDriver.getDbLogs === 'function') {
      const dbLogsAfterStop = await dbDriver.getDbLogs();
      if (/unexpected EOF on client connection|Connection reset by peer/i.test(dbLogsAfterStop)) {
        throw new Error(
          `[${label}] PostgreSQL reported abrupt socket closure during SIGTERM drain:\n${dbLogsAfterStop}`
        );
      }
    }

    console.log(
      `✅ [${label}] Authenticated in-flight request returned HTTP 200 after >4500 ms SIGTERM drain and exited with code 143!`
    );
  } finally {
    await lockHandle.cleanup();
  }
}
