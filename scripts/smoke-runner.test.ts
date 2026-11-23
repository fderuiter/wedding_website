/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  httpRequest,
  runCheckedCommand,
  runSmokeRouteProbes,
  waitForServerReady,
} from './smoke-runner.mjs';

describe('scripts/smoke-runner.mjs', () => {
  it('runCheckedCommand succeeds on exit code 0 and throws on non-zero exit code', () => {
    expect(() =>
      runCheckedCommand(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    ).not.toThrow();

    expect(() =>
      runCheckedCommand(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'ignore' })
    ).toThrow(/status 2/);
  });

  describe('HTTP readiness and shared smoke route probes', () => {
    let server: http.Server;
    let baseUrl: string;
    let hostHeader: string;
    let readyStatus = 200;
    let faviconStatus = 200;
    let validateCodeStatus = 404;

    beforeEach(async () => {
      readyStatus = 200;
      faviconStatus = 200;
      validateCodeStatus = 404;

      server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (url.pathname === '/api/live') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'alive', timestamp: new Date().toISOString() }));
          return;
        }
        if (url.pathname === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'ok', database: 'connected', timestamp: new Date().toISOString() },
            })
          );
          return;
        }
        if (url.pathname === '/api/ready') {
          res.writeHead(readyStatus, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify(
              readyStatus === 200
                ? { status: 'ready', database: 'connected', timestamp: new Date().toISOString() }
                : {
                  status: 'unhealthy',
                  database: 'connected',
                  error: 'Database schema is not ready',
                }
            )
          );
          return;
        }
        if (url.pathname === '/assets/favicon.png') {
          res.writeHead(faviconStatus, { 'Content-Type': 'image/png' });
          res.end(faviconStatus === 200 ? Buffer.from([137, 80, 78, 71]) : '');
          return;
        }
        if (url.pathname === '/guest/login') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html>login</html>');
          return;
        }
        if (url.pathname === '/') {
          res.writeHead(303, { Location: '/guest/login' });
          res.end();
          return;
        }
        if (url.pathname === '/api/registry/validate-code') {
          res.writeHead(validateCodeStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid invitation code.' }));
          return;
        }
        if (url.pathname === '/api/guest/login' && req.method === 'POST') {
          let raw = '';
          req.on('data', (chunk) => {
            raw += chunk.toString();
          });
          req.on('end', () => {
            const parsed = JSON.parse(raw || '{}');
            if (parsed.passcode === 'smoke-secret-passcode') {
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': 'guest_auth=signed-smoke-token; Path=/; HttpOnly; SameSite=Lax',
              });
              res.end(JSON.stringify({ success: true, data: { sessionType: 'guest' } }));
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            }
          });
          return;
        }
        if (url.pathname === '/api/registry/items') {
          const cookie = req.headers.cookie || '';
          if (!cookie.includes('guest_auth=signed-smoke-token')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { items: [], total: 0 } }));
          return;
        }

        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as AddressInfo;
      hostHeader = `127.0.0.1:${address.port}`;
      baseUrl = `http://${hostHeader}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('passes all shared smoke route probes when static assets, readiness, and data routes succeed', async () => {
      await waitForServerReady({
        baseUrl,
        hostHeader,
        maxAttempts: 3,
        intervalMs: 50,
        label: 'Test server',
      });

      const rawRes = await httpRequest(baseUrl, '/api/live', { hostHeader });
      expect(rawRes.statusCode).toBe(200);

      await expect(
        runSmokeRouteProbes({
          baseUrl,
          hostHeader,
          guestPasscode: 'smoke-secret-passcode',
          label: 'unit-smoke',
        })
      ).resolves.toBeUndefined();
    });

    it('rejects readiness wait when GET /api/ready returns HTTP 503', async () => {
      readyStatus = 503;

      await expect(
        waitForServerReady({
          baseUrl,
          hostHeader,
          maxAttempts: 2,
          intervalMs: 50,
          label: 'Zero-table server',
        })
      ).rejects.toThrow(/status=503/);
    });

    it('fails smoke route probes when /assets/favicon.png is missing or validate-code returns 500', async () => {
      faviconStatus = 404;
      await expect(
        runSmokeRouteProbes({
          baseUrl,
          hostHeader,
          guestPasscode: 'smoke-secret-passcode',
          label: 'missing-favicon',
        })
      ).rejects.toThrow(/\/assets\/favicon\.png returned 404/);

      faviconStatus = 200;
      validateCodeStatus = 500;
      await expect(
        runSmokeRouteProbes({
          baseUrl,
          hostHeader,
          guestPasscode: 'smoke-secret-passcode',
          label: 'zero-table-validate',
        })
      ).rejects.toThrow(/validate-code.*returned 500/);
    });
  });
});
