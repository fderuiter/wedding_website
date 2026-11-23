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
  ];
  for (const route of perimeterRoutes) {
    console.log(`[${label}] Testing ${route.name} (${route.path})...`);
    const res = await httpRequest(baseUrl, route.path, { hostHeader });
    if (res.statusCode !== route.expectedStatus) {
      throw new Error(
        `[${label}] Route ${route.path} returned ${res.statusCode}, expected ${route.expectedStatus}`
      );
    }
    console.log(`✅ [${label}] ${route.name} (${route.path}) returned ${res.statusCode}`);
  }

  // 6. Unauthenticated Data-Backed Schema Probe (/api/registry/validate-code)
  const validatePath = '/api/registry/validate-code?code=SMOKE-NONEXISTENT-CODE';
  console.log(`[${label}] Testing data-backed GET ${validatePath}...`);
  const validateRes = await httpRequest(baseUrl, validatePath, { hostHeader });
  if (validateRes.statusCode !== 404) {
    throw new Error(
      `[${label}] GET ${validatePath} returned ${validateRes.statusCode} (expected 404): ${validateRes.body}`
    );
  }
  console.log(`✅ [${label}] ${validatePath} returned 404 (InvitationCode table verified)`);

  // 7. Authenticated Guest Session + Data-Backed Registry Items Probe
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
