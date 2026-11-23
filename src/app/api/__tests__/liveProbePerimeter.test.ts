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

  it('allows GET and HEAD probes on /api/live, /api/health, and /api/ready with healthcheck.railway.app or internal kubelet IPs while rejecting non-probe routes and POST /api/live', async () => {
    for (const probePath of ['/api/live', '/api/health', '/api/ready']) {
      for (const method of ['GET', 'HEAD']) {
        for (const probeHost of ['healthcheck.railway.app', '169.254.169.126:3000']) {
          const probeReq = new NextRequest(`http://localhost:3000${probePath}`, {
            method,
            headers: { host: probeHost },
          });
          const probeRes = await middleware(probeReq);
          expect(probeRes.status).toBe(200);
        }
      }
    }

    const photosReq = new NextRequest('http://evil.attacker.invalid/api/photos', {
      method: 'GET',
      headers: { host: 'evil.attacker.invalid' },
    });
    const photosRes = await middleware(photosReq);
    expect(photosRes.status).toBe(400);
    expect(await photosRes.json()).toEqual({ error: 'Invalid Host header' });

    const postLiveReq = new NextRequest('http://evil.attacker.invalid/api/live', {
      method: 'POST',
      headers: { host: 'healthcheck.railway.app' },
    });
    const postLiveRes = await middleware(postLiveReq);
    expect(postLiveRes.status).toBe(400);
    expect(await postLiveRes.json()).toEqual({ error: 'Invalid Host header' });
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
