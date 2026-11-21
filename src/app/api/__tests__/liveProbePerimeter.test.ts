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

  it('allows unauthenticated GET /api/live through Edge and Node middleware when Host is allowed while gating non-exempt routes', async () => {
    const liveReq = new NextRequest('http://localhost:3000/api/live', {
      headers: { host: 'localhost:3000' },
    });
    const liveRes = await middleware(liveReq);
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get('location')).toBeNull();
    const liveNextOpts = (NextResponse.next as jest.Mock).mock.lastCall?.[0];
    expect(liveNextOpts?.request?.headers?.get('x-guest-gated-api')).toBe('0');

    const adminGatedReq = new NextRequest('http://localhost:3000/api/admin/settings', {
      headers: { host: 'localhost:3000' },
    });
    const adminGatedRes = await middleware(adminGatedReq);
    expect(adminGatedRes.status).toBe(401);

    const guestGatedReq = new NextRequest('http://localhost:3000/api/photos', {
      headers: { host: 'localhost:3000' },
    });
    await middleware(guestGatedReq);
    const guestNextOpts = (NextResponse.next as jest.Mock).mock.lastCall?.[0];
    expect(guestNextOpts?.request?.headers?.get('x-guest-gated-api')).toBe('1');

    const nodeWrapped = withApiMiddleware(async () =>
      NextResponse.json({ ok: true }, { status: 200 })
    );
    const liveNodeRes = await nodeWrapped(
      new NextRequest('http://localhost:3000/api/live', {
        headers: { host: 'localhost:3000', 'x-guest-gated-api': '0' },
      })
    );
    expect(liveNodeRes.status).toBe(200);

    const gatedNodeRes = await nodeWrapped(
      new NextRequest('http://localhost:3000/api/photos', {
        headers: { host: 'localhost:3000', 'x-guest-gated-api': '1' },
      })
    );
    expect(gatedNodeRes.status).toBe(401);
  });

  it('rejects GET /api/live with HTTP 400 when Host header is not in ALLOWED_HOSTS', async () => {
    const req = new NextRequest('http://evil.attacker.invalid/api/live', {
      headers: { host: 'evil.attacker.invalid' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid Host header' });
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
