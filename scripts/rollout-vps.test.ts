/**
 * @jest-environment node
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { isHostAllowed, isHostSyntaxValid } from '../src/utils/hostValidation';

const REPO_ROOT = process.cwd();
const ROLLOUT_SCRIPT_SRC = path.join(REPO_ROOT, 'scripts', 'rollout-vps.sh');

interface ContainerRecord {
  cid: string;
  imageId: string;
  status: string;
  health?: string;
}

interface DockerEventRecord {
  args: string[];
  images: Record<string, string>;
  containers: Record<string, ContainerRecord>;
}

interface MockDockerState {
  images: Record<string, string>;
  containers: Record<string, ContainerRecord>;
  builtImageId: string;
  failOn: {
    buildApp?: boolean;
    migration?: boolean;
    upStandby?: boolean;
    upAppImages?: string[];
    standbyStatus?: string;
    appStatusByImage?: Record<string, string>;
  };
  events: DockerEventRecord[];
}

interface RecordedHttpProbe {
  slot: 'primary' | 'standby';
  method: string;
  url: string;
  hostHeader: string | undefined;
  statusCode: number;
  imageId: string;
}

const MOCK_DOCKER_JS = [
  'const fs = require("fs");',
  'const statePath = process.env.MOCK_DOCKER_STATE_FILE;',
  'if (!statePath) { console.error("Missing MOCK_DOCKER_STATE_FILE"); process.exit(2); }',
  'const state = JSON.parse(fs.readFileSync(statePath, "utf8"));',
  'const args = process.argv.slice(2);',
  'function saveAndExit(code) {',
  '  state.events.push({',
  '    args,',
  '    images: JSON.parse(JSON.stringify(state.images)),',
  '    containers: JSON.parse(JSON.stringify(state.containers)),',
  '  });',
  '  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));',
  '  process.exit(code);',
  '}',
  'if (args[0] === "image" && args[1] === "inspect") {',
  '  const ref = args[2];',
  '  if (state.images[ref]) { console.log(state.images[ref]); saveAndExit(0); }',
  '  saveAndExit(1);',
  '}',
  'if (args[0] === "tag") {',
  '  const src = args[1];',
  '  const dest = args[2];',
  '  if (!state.images[src]) { console.error("No such image: " + src); saveAndExit(1); }',
  '  state.images[dest] = state.images[src];',
  '  saveAndExit(0);',
  '}',
  'if (args[0] === "inspect") {',
  '  const fmtIdx = args.indexOf("-f");',
  '  const fmt = fmtIdx !== -1 ? args[fmtIdx + 1] : "";',
  '  const targetCid = args[args.length - 1];',
  '  const found = Object.values(state.containers).find((c) => c.cid === targetCid);',
  '  if (!found) { saveAndExit(1); }',
  '  if (fmt.includes("Health")) {',
  '    console.log(found.health || found.status);',
  '  } else {',
  '    console.log(found.status);',
  '  }',
  '  saveAndExit(0);',
  '}',
  'if (args[0] === "compose") {',
  '  let i = 1;',
  '  while (i < args.length) {',
  '    if (args[i] === "-f" || args[i] === "--env-file" || args[i] === "-p") { i += 2; continue; }',
  '    break;',
  '  }',
  '  const sub = args[i];',
  '  const rest = args.slice(i + 1);',
  '  if (sub === "ps") {',
  '    const svc = rest[rest.length - 1];',
  '    const c = state.containers[svc];',
  '    if (c) { console.log(c.cid); }',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "build") {',
  '    if (state.failOn.buildApp) { console.error("Build failed"); saveAndExit(1); }',
  '    state.images["wedding-website:latest"] = state.builtImageId;',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "run") {',
  '    const svc = rest[rest.length - 1];',
  '    if (svc === "migration" && state.failOn.migration) { console.error("Migration failed"); saveAndExit(1); }',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "up") {',
  '    const svc = rest[rest.length - 1];',
  '    if (svc === "db") {',
  '      state.containers.db = { cid: "cid-db", imageId: "postgres:15-alpine", status: "running", health: "healthy" };',
  '      saveAndExit(0);',
  '    }',
  '    const latestImage = state.images["wedding-website:latest"] || "missing-image";',
  '    if (svc === "app-standby") {',
  '      if (state.failOn.upStandby) {',
  '        state.containers["app-standby"] = { cid: "cid-standby-failed", imageId: latestImage, status: "exited" };',
  '        console.error("Standby up failed");',
  '        saveAndExit(1);',
  '      }',
  '      state.containers["app-standby"] = {',
  '        cid: "cid-standby-" + latestImage,',
  '        imageId: latestImage,',
  '        status: state.failOn.standbyStatus || "running",',
  '      };',
  '      saveAndExit(0);',
  '    }',
  '    if (svc === "app") {',
  '      if (Array.isArray(state.failOn.upAppImages) && state.failOn.upAppImages.includes(latestImage)) {',
  '        state.containers.app = { cid: "cid-app-failed-" + latestImage, imageId: latestImage, status: "exited" };',
  '        console.error("Primary up failed for " + latestImage);',
  '        saveAndExit(1);',
  '      }',
  '      const customStatus = state.failOn.appStatusByImage && state.failOn.appStatusByImage[latestImage];',
  '      state.containers.app = {',
  '        cid: "cid-app-" + latestImage,',
  '        imageId: latestImage,',
  '        status: customStatus || "running",',
  '      };',
  '      saveAndExit(0);',
  '    }',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "stop") {',
  '    const svc = rest[rest.length - 1];',
  '    if (state.containers[svc]) { state.containers[svc].status = "exited"; }',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "rm") {',
  '    const svc = rest[rest.length - 1];',
  '    delete state.containers[svc];',
  '    saveAndExit(0);',
  '  }',
  '  if (sub === "logs") {',
  '    const svc = rest[rest.length - 1];',
  '    console.error("container logs for " + svc);',
  '    saveAndExit(0);',
  '  }',
  '}',
  'saveAndExit(0);',
  '',
].join('\n');

async function allocateLoopbackPort(exclude: number[] = []): Promise<number> {
  const excludedSet = new Set(exclude);
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const assigned = typeof addr === 'object' && addr ? addr.port : 0;
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(assigned);
        });
      });
    });
    if (port > 0 && !excludedSet.has(port)) {
      return port;
    }
  }
  throw new Error('Failed to allocate unique loopback port');
}

function resolveExecutableInPath(cmdName: string): string | null {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = path.join(dir, cmdName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

describe('scripts/rollout-vps.sh', () => {
  let tempDir: string;
  let statePath: string;
  let binDir: string;
  let primaryPort: number;
  let standbyPort: number;
  let primaryServer: http.Server;
  let standbyServer: http.Server;
  let probeLog: RecordedHttpProbe[];
  let allowedHosts: string[];
  let slotHealth: {
    primary: (imageId: string) => boolean;
    standby: (imageId: string) => boolean;
  };
  let slotReadiness: {
    primary: (imageId: string) => boolean;
    standby: (imageId: string) => boolean;
  };

  function readState(): MockDockerState {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as MockDockerState;
  }

  function writeState(patch: Partial<MockDockerState>): void {
    const current = readState();
    const updated: MockDockerState = {
      ...current,
      ...patch,
    };
    fs.writeFileSync(statePath, `${JSON.stringify(updated, null, 2)}\n`);
  }

  function createSlotServer(slot: 'primary' | 'standby', serviceName: 'app' | 'app-standby'): http.Server {
    return http.createServer((req, res) => {
      const state = readState();
      const container = state.containers[serviceName];
      if (!container || container.status !== 'running') {
        res.statusCode = 502;
        res.end('upstream container not running');
        return;
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const rawHost = req.headers.host;
      const isReadOnlyProbe =
        (method === 'GET' || method === 'HEAD') &&
        (pathname === '/api/live' || pathname === '/api/health' || pathname === '/api/ready');

      const hostValid = isReadOnlyProbe
        ? isHostSyntaxValid(rawHost)
        : isHostAllowed(rawHost, allowedHosts);

      if (!hostValid) {
        probeLog.push({
          slot,
          method,
          url: pathname,
          hostHeader: rawHost,
          statusCode: 400,
          imageId: container.imageId,
        });
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid Host header' }));
        return;
      }

      if (pathname === '/api/live') {
        probeLog.push({
          slot,
          method,
          url: pathname,
          hostHeader: rawHost,
          statusCode: 200,
          imageId: container.imageId,
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'alive' }));
        return;
      }

      if (pathname === '/api/health') {
        const isHealthy = slotHealth[slot](container.imageId);
        const statusCode = isHealthy ? 200 : 503;
        probeLog.push({
          slot,
          method,
          url: pathname,
          hostHeader: rawHost,
          statusCode,
          imageId: container.imageId,
        });
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            isHealthy
              ? { success: true, data: { status: 'ok', database: 'connected' } }
              : { success: false, status: 'degraded', database: 'disconnected' }
          )
        );
        return;
      }

      if (pathname === '/api/ready') {
        const isReady = slotReadiness[slot](container.imageId);
        const statusCode = isReady ? 200 : 503;
        probeLog.push({
          slot,
          method,
          url: pathname,
          hostHeader: rawHost,
          statusCode,
          imageId: container.imageId,
        });
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            isReady
              ? { status: 'ready', database: 'connected' }
              : { status: 'unhealthy', database: 'connected', error: 'Not ready' }
          )
        );
        return;
      }

      res.statusCode = 200;
      res.end('ok');
    });
  }

  function runRollout(
    envOverrides: Record<string, string> = {}
  ): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const scriptPath = path.join(tempDir, 'scripts', 'rollout-vps.sh');
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [scriptPath], {
        cwd: tempDir,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          MOCK_DOCKER_STATE_FILE: statePath,
          PORT: String(primaryPort),
          STANDBY_PORT: String(standbyPort),
          ROLLOUT_WAIT_SECONDS: '3',
          ROLLOUT_POLL_INTERVAL: '0.05',
          DB_WAIT_SECONDS: '3',
          STANDBY_DRAIN_SECONDS: '0',
          ...envOverrides,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', reject);
      child.once('close', (code) => {
        resolve({ status: code, stdout, stderr });
      });
    });
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-vps-test-'));
    fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });
    binDir = path.join(tempDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const destScript = path.join(tempDir, 'scripts', 'rollout-vps.sh');
    fs.copyFileSync(ROLLOUT_SCRIPT_SRC, destScript);
    fs.chmodSync(destScript, 0o755);
    fs.copyFileSync(
      path.join(REPO_ROOT, 'docker-compose.yml'),
      path.join(tempDir, 'docker-compose.yml')
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'docker-compose.rollout.yml'),
      path.join(tempDir, 'docker-compose.rollout.yml')
    );

    const mockDockerScriptPath = path.join(tempDir, 'mock-docker.cjs');
    fs.writeFileSync(mockDockerScriptPath, MOCK_DOCKER_JS);
    const dockerWrapperPath = path.join(binDir, 'docker');
    fs.writeFileSync(
      dockerWrapperPath,
      `#!/usr/bin/env bash\nexec "${process.execPath}" "${mockDockerScriptPath}" "$@"\n`
    );
    fs.chmodSync(dockerWrapperPath, 0o755);

    statePath = path.join(tempDir, 'mock-docker-state.json');
    const initialState: MockDockerState = {
      images: {
        'wedding-website:latest': 'sha256:v1-stable',
      },
      containers: {
        db: {
          cid: 'cid-db',
          imageId: 'postgres:15-alpine',
          status: 'running',
          health: 'healthy',
        },
        app: {
          cid: 'cid-app-initial',
          imageId: 'sha256:v1-stable',
          status: 'running',
        },
      },
      builtImageId: 'sha256:v2-release',
      failOn: {},
      events: [],
    };
    fs.writeFileSync(statePath, `${JSON.stringify(initialState, null, 2)}\n`);

    probeLog = [];
    allowedHosts = ['localhost', '127.0.0.1', '*.localhost'];
    slotHealth = {
      primary: () => true,
      standby: () => true,
    };
    slotReadiness = {
      primary: () => true,
      standby: () => true,
    };

    primaryPort = await allocateLoopbackPort();
    standbyPort = await allocateLoopbackPort([primaryPort]);

    primaryServer = createSlotServer('primary', 'app');
    standbyServer = createSlotServer('standby', 'app-standby');

    await Promise.all([
      new Promise<void>((resolve) => primaryServer.listen(primaryPort, '127.0.0.1', () => resolve())),
      new Promise<void>((resolve) => standbyServer.listen(standbyPort, '127.0.0.1', () => resolve())),
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      new Promise<void>((resolve) => primaryServer.close(() => resolve())),
      new Promise<void>((resolve) => standbyServer.close(() => resolve())),
    ]);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('snapshots wedding-website:previous before building app, warms standby, updates primary, and retires standby on healthy rollout', async () => {
    const res = await runRollout();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Zero-downtime rollout complete');

    const finalState = readState();
    expect(finalState.images['wedding-website:previous']).toBe('sha256:v1-stable');
    expect(finalState.images['wedding-website:latest']).toBe('sha256:v2-release');
    expect(finalState.containers.app).toMatchObject({
      imageId: 'sha256:v2-release',
      status: 'running',
    });
    expect(finalState.containers['app-standby']).toBeUndefined();

    const tagIdx = finalState.events.findIndex(
      (e) =>
        e.args[0] === 'tag' &&
        e.args[1] === 'wedding-website:latest' &&
        e.args[2] === 'wedding-website:previous'
    );
    const buildIdx = finalState.events.findIndex(
      (e) => e.args[0] === 'compose' && e.args.includes('build') && e.args.includes('app')
    );
    expect(tagIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(tagIdx);
  });

  it('completes initial rollout cleanly when no prior wedding-website:latest image exists', async () => {
    writeState({
      images: {},
      containers: {
        db: {
          cid: 'cid-db',
          imageId: 'postgres:15-alpine',
          status: 'running',
          health: 'healthy',
        },
      },
    });

    const res = await runRollout();
    expect(res.status).toBe(0);

    const finalState = readState();
    expect(finalState.images['wedding-website:previous']).toBeUndefined();
    expect(finalState.images['wedding-website:latest']).toBe('sha256:v2-release');
    expect(finalState.containers.app).toMatchObject({
      imageId: 'sha256:v2-release',
      status: 'running',
    });
    expect(finalState.containers['app-standby']).toBeUndefined();
  });

  it('probes loopback /api/live, /api/health, and /api/ready with HTTP 200 without Host overrides for leading-dot ALLOWED_HOSTS under both curl and Node fetch', async () => {
    allowedHosts = ['.wedding.example.com'];
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'ALLOWED_HOSTS=.wedding.example.com\n',
      'utf8'
    );

    // 1. Probe path with host `curl`
    const curlRes = await runRollout();
    expect(curlRes.status).toBe(0);
    expect(probeLog.length).toBeGreaterThanOrEqual(6);
    expect(probeLog.map((p) => p.url)).toEqual(
      expect.arrayContaining(['/api/live', '/api/health', '/api/ready'])
    );
    expect(probeLog.every((p) => p.statusCode === 200)).toBe(true);
    expect(
      probeLog.every(
        (p) => p.hostHeader === `127.0.0.1:${primaryPort}` || p.hostHeader === `127.0.0.1:${standbyPort}`
      )
    ).toBe(true);

    // 2. Probe path with Node `fetch` fallback when `curl` is absent from PATH
    probeLog = [];
    writeState({
      images: { 'wedding-website:latest': 'sha256:v1-stable' },
      containers: {
        db: { cid: 'cid-db', imageId: 'postgres:15-alpine', status: 'running', health: 'healthy' },
        app: { cid: 'cid-app-initial', imageId: 'sha256:v1-stable', status: 'running' },
      },
      events: [],
    });

    const noCurlBinDir = path.join(tempDir, 'bin-no-curl');
    fs.mkdirSync(noCurlBinDir, { recursive: true });
    fs.symlinkSync(path.join(binDir, 'docker'), path.join(noCurlBinDir, 'docker'));
    fs.symlinkSync(process.execPath, path.join(noCurlBinDir, 'node'));
    for (const cmd of ['bash', 'dirname', 'grep', 'tail', 'sleep', 'printf']) {
      const resolved = resolveExecutableInPath(cmd);
      if (resolved) {
        fs.symlinkSync(resolved, path.join(noCurlBinDir, cmd));
      }
    }

    const fetchRes = await runRollout({ PATH: noCurlBinDir });
    expect(fetchRes.status).toBe(0);
    expect(probeLog.length).toBeGreaterThanOrEqual(6);
    expect(probeLog.map((p) => p.url)).toEqual(
      expect.arrayContaining(['/api/live', '/api/health', '/api/ready'])
    );
    expect(probeLog.every((p) => p.statusCode === 200)).toBe(true);
    expect(
      probeLog.every(
        (p) => p.hostHeader === `127.0.0.1:${primaryPort}` || p.hostHeader === `127.0.0.1:${standbyPort}`
      )
    ).toBe(true);
  });

  it('retires app-standby, restores wedding-website:previous to latest, and leaves primary app running when Step 4 or Step 5 fails before cutover', async () => {
    // Step 4 failure: `docker compose up ... app-standby` fails
    writeState({
      failOn: { upStandby: true },
    });
    const step4Res = await runRollout({ ROLLOUT_WAIT_SECONDS: '1' });
    expect(step4Res.status).not.toBe(0);

    const afterStep4 = readState();
    expect(afterStep4.containers['app-standby']).toBeUndefined();
    expect(afterStep4.images['wedding-website:latest']).toBe('sha256:v1-stable');
    expect(afterStep4.containers.app).toMatchObject({
      cid: 'cid-app-initial',
      imageId: 'sha256:v1-stable',
      status: 'running',
    });

    // Step 5 failure: `app-standby` starts on broken v2 release and fails /api/ready probes
    writeState({
      images: { 'wedding-website:latest': 'sha256:v1-stable' },
      containers: {
        db: { cid: 'cid-db', imageId: 'postgres:15-alpine', status: 'running', health: 'healthy' },
        app: { cid: 'cid-app-initial', imageId: 'sha256:v1-stable', status: 'running' },
      },
      failOn: {},
      events: [],
    });
    slotReadiness.standby = (imageId) => imageId !== 'sha256:v2-release';

    const step5Res = await runRollout({ ROLLOUT_WAIT_SECONDS: '1' });
    expect(step5Res.status).not.toBe(0);
    expect(step5Res.stderr).toContain('Rollout aborted before primary cutover');

    const afterStep5 = readState();
    expect(afterStep5.containers['app-standby']).toBeUndefined();
    expect(afterStep5.images['wedding-website:latest']).toBe('sha256:v1-stable');
    expect(afterStep5.containers.app).toMatchObject({
      cid: 'cid-app-initial',
      imageId: 'sha256:v1-stable',
      status: 'running',
    });
  });

  it('keeps app-standby running during primary cutover failure, automatically rolls primary app back onto wedding-website:previous, and retires standby once recovered', async () => {
    // Primary `app` fails probes on v2-release during Step 7, but succeeds when rolled back to v1-stable
    slotReadiness.standby = () => true;
    slotReadiness.primary = (imageId) => imageId === 'sha256:v1-stable';

    const res = await runRollout({ ROLLOUT_WAIT_SECONDS: '1' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Attempting automatic primary rollback onto wedding-website:previous');
    expect(res.stderr).toContain('Automatic primary rollback to wedding-website:previous succeeded');

    const finalState = readState();
    expect(finalState.images['wedding-website:latest']).toBe('sha256:v1-stable');
    expect(finalState.containers.app).toMatchObject({
      imageId: 'sha256:v1-stable',
      status: 'running',
    });
    expect(finalState.containers['app-standby']).toBeUndefined();

    // Verify app-standby was still running while primary rollback `up ... app` executed
    const rollbackUpEvent = finalState.events.find(
      (e, idx) =>
        idx > 0 &&
        e.args[0] === 'compose' &&
        e.args.includes('up') &&
        e.args[e.args.length - 1] === 'app' &&
        e.images['wedding-website:latest'] === 'sha256:v1-stable'
    );
    expect(rollbackUpEvent).toBeDefined();
    expect(rollbackUpEvent?.containers['app-standby']?.status).toBe('running');
  });

  it('keeps healthy app-standby serving failover traffic and prints manual recovery commands when Step 6 fails and primary rollback also fails', async () => {
    // Both v2-release and rolled-back v1-stable fail on primary `up ... app`
    writeState({
      failOn: {
        upAppImages: ['sha256:v2-release', 'sha256:v1-stable'],
      },
    });

    const res = await runRollout({ ROLLOUT_WAIT_SECONDS: '1' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Automatic primary rollback onto wedding-website:previous failed');
    expect(res.stderr).toContain('Keeping healthy standby container (app-standby) running');
    expect(res.stderr).toContain('Manual recovery commands:');

    const finalState = readState();
    expect(finalState.containers['app-standby']).toMatchObject({
      imageId: 'sha256:v2-release',
      status: 'running',
    });

    // Confirm warm standby container continues serving HTTP 200 failover traffic
    const failoverRes = await fetch(`http://127.0.0.1:${standbyPort}/api/ready`);
    expect(failoverRes.status).toBe(200);
  });

  it('keeps healthy app-standby running and prints recovery commands when primary cutover fails and wedding-website:previous is unavailable', async () => {
    writeState({
      images: {},
      containers: {
        db: { cid: 'cid-db', imageId: 'postgres:15-alpine', status: 'running', health: 'healthy' },
      },
    });
    slotReadiness.standby = () => true;
    slotReadiness.primary = () => false;

    const res = await runRollout({ ROLLOUT_WAIT_SECONDS: '1' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Rollback tag wedding-website:previous is unavailable');
    expect(res.stderr).toContain('Keeping healthy standby container (app-standby) running');
    expect(res.stderr).toContain('Manual recovery commands:');

    const finalState = readState();
    expect(finalState.containers['app-standby']).toMatchObject({
      imageId: 'sha256:v2-release',
      status: 'running',
    });

    const failoverRes = await fetch(`http://127.0.0.1:${standbyPort}/api/ready`);
    expect(failoverRes.status).toBe(200);
  });

  it('retires app-standby without rolling back healthy primary app if interrupted during post-cutover drain (completed phase)', async () => {
    const scriptPath = path.join(tempDir, 'scripts', 'rollout-vps.sh');
    const child = spawn('bash', [scriptPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        MOCK_DOCKER_STATE_FILE: statePath,
        PORT: String(primaryPort),
        STANDBY_PORT: String(standbyPort),
        ROLLOUT_WAIT_SECONDS: '2',
        ROLLOUT_POLL_INTERVAL: '0.05',
        DB_WAIT_SECONDS: '2',
        STANDBY_DRAIN_SECONDS: '10',
      },
    });

    let stdoutBuf = '';
    let sentSigterm = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for drain phase. stdout=${stdoutBuf}`));
      }, 8000);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
        if (!sentSigterm && stdoutBuf.includes('Waiting 10s for reverse proxy failback')) {
          sentSigterm = true;
          clearTimeout(timeout);
          child.kill('SIGTERM');
        }
      });

      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const finalState = readState();
    expect(finalState.images['wedding-website:latest']).toBe('sha256:v2-release');
    expect(finalState.containers.app).toMatchObject({
      imageId: 'sha256:v2-release',
      status: 'running',
    });
    expect(finalState.containers['app-standby']).toBeUndefined();
  });
});
