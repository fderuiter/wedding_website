/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';
import { middleware } from '@/middleware';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { rateLimit } from '@/utils/rateLimit';

describe('/api/live perimeter and middleware exemptions', () => {
  const originalAllowedHosts = process.env.ALLOWED_HOSTS;

  beforeEach(() => {
    process.env.ALLOWED_HOSTS = 'localhost,wedding.example.com';
  });

  afterEach(() => {
    process.env.ALLOWED_HOSTS = originalAllowedHosts;
    jest.restoreAllMocks();
  });

  it('allows unauthenticated GET /api/live through Edge middleware when Host is allowed while gating non-exempt routes', async () => {
    const liveReq = new NextRequest('http://localhost:3000/api/live', {
      headers: { host: 'localhost:3000' },
    });
    const liveRes = await middleware(liveReq);
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get('location')).toBeNull();

    const gatedReq = new NextRequest('http://localhost:3000/api/photos', {
      headers: { host: 'localhost:3000' },
    });
    const gatedRes = await middleware(gatedReq);
    expect(gatedRes.status).toBe(401);
  });

  it('allows GET and HEAD requests to /api/live, /api/health, and /api/ready with unlisted orchestrator or loopback Host headers', async () => {
    process.env.ALLOWED_HOSTS = 'wedding.example.com';

    const probePaths = ['/api/live', '/api/health', '/api/ready'];
    const probeMethods = ['GET', 'HEAD'] as const;
    const probeHosts = ['healthcheck.railway.app', '169.254.1.1:3000', '127.0.0.1:3000'];

    for (const probePath of probePaths) {
      for (const method of probeMethods) {
        for (const host of probeHosts) {
          const req = new NextRequest(`http://127.0.0.1:3000${probePath}`, {
            method,
            headers: { host },
          });
          const res = await middleware(req);
          expect(res.status).toBe(200);
          expect(res.headers.get('location')).toBeNull();
        }
      }
    }
  });

  it('rejects GET /api/live with HTTP 400 when Host or X-Forwarded-Host header is CRLF-injected or syntactically malformed', async () => {
    const malformedHosts = [
      '',
      '   ',
      'healthcheck.railway.app\r\nX-Injected: evil',
      '127.0.0.1:3000\nHost: evil.com',
      'healthcheck.railway.app, evil.com',
      'healthcheck .railway.app',
      '127.0.0.1:0',
      '127.0.0.1:65536',
      '127.0.0.1:abc',
      ':3000',
    ];

    for (const badHost of malformedHosts) {
      const req = new NextRequest('http://localhost:3000/api/live', {
        method: 'GET',
        headers: { host: badHost },
      });
      const res = await middleware(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid Host header' });
    }

    const badForwardedReq = new NextRequest('http://localhost:3000/api/live', {
      method: 'GET',
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'healthcheck.railway.app\r\nX-Injected: 1',
      },
    });
    const badForwardedRes = await middleware(badForwardedReq);
    expect(badForwardedRes.status).toBe(400);
    expect(await badForwardedRes.json()).toEqual({ error: 'Invalid Host header' });
  });

  it('enforces ALLOWED_HOSTS on non-read-only methods (e.g. POST) targeting probe paths', async () => {
    process.env.ALLOWED_HOSTS = 'wedding.example.com';

    for (const probePath of ['/api/live', '/api/health', '/api/ready']) {
      const req = new NextRequest(`http://127.0.0.1:3000${probePath}`, {
        method: 'POST',
        headers: { host: 'healthcheck.railway.app' },
      });
      const res = await middleware(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid Host header' });
    }
  });

  it('enforces ALLOWED_HOSTS on non-probe routes (/api/photos, /api/registry/webhook/stripe, /api/cron/broadcasts, /uploads/photo.png)', async () => {
    process.env.ALLOWED_HOSTS = 'wedding.example.com';

    const nonProbeRequests: Array<{ path: string; method: string }> = [
      { path: '/api/photos', method: 'GET' },
      { path: '/api/registry/webhook/stripe', method: 'POST' },
      { path: '/api/cron/broadcasts', method: 'GET' },
      { path: '/uploads/photo.png', method: 'GET' },
    ];

    for (const { path: targetPath, method } of nonProbeRequests) {
      const req = new NextRequest(`http://127.0.0.1:3000${targetPath}`, {
        method,
        headers: { host: 'healthcheck.railway.app' },
      });
      const res = await middleware(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid Host header' });
    }
  });

  it('exempts /api/live from rate limiting inside withApiMiddleware even with limit=1', async () => {
    const wrapped = withApiMiddleware(
      async () => NextResponse.json({ status: 'alive' }, { status: 200 }),
      { limit: 1, windowMs: 60_000 }
    );

    for (let i = 0; i < 4; i++) {
      const req = new NextRequest('http://localhost:3000/api/live', {
        headers: { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.42' },
      });
      const res = await wrapped(req);
      expect(res.status).toBe(200);
    }

    // Verify /api/live is registered as a known static API path in rateLimit bucket normalization
    const directRes = await rateLimit(
      new NextRequest('http://localhost:3000/api/live', {
        headers: { host: 'localhost:3000' },
      }),
      5,
      60_000
    );
    expect(directRes).toBeNull();
  });
});
