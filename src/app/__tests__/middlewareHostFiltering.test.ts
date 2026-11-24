/** @jest-environment node */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('Perimeter Host Header Filtering Middleware', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  afterEach(() => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
  });

  it('allows requests with whitelisted Host headers to proceed', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/me', {
      headers: {
        host: 'localhost:3000',
      },
    });

    const res = await middleware(req);
    expect(res.status).not.toBe(400);
  });

  it('allows whitelisted tenant subdomains to proceed', async () => {
    const req = new NextRequest('http://tenant1.wedding.example/guest/login', {
      headers: {
        host: 'tenant1.wedding.example',
      },
    });

    const res = await middleware(req);
    expect(res.status).not.toBe(400);
  });

  it('blocks requests with non-whitelisted Host headers at the perimeter', async () => {
    const req = new NextRequest('http://evil.com/api/admin/me', {
      headers: {
        host: 'evil.com',
      },
    });

    const res = await middleware(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid Host header' });
  });

  it('ignores spoofed X-Forwarded-Host headers when TRUST_PROXY is false', async () => {
    process.env.TRUST_PROXY = 'false';

    const req = new NextRequest('http://localhost:3000/guest/login', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'malicious-domain.org',
      },
    });

    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('blocks requests with spoofed X-Forwarded-Host headers when TRUST_PROXY is enabled', async () => {
    process.env.TRUST_PROXY = '1';

    const req = new NextRequest('http://localhost:3000/guest/login', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'malicious-domain.org',
      },
    });

    const res = await middleware(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid Host header' });
  });

  it('selects the configured right-to-left hop in X-Forwarded-Host based on TRUST_PROXY', async () => {
    process.env.TRUST_PROXY = '1';
    const singleHopAllowed = await middleware(
      new NextRequest('http://localhost:3000/guest/login', {
        headers: {
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'spoofed.evil.org, tenant1.wedding.example',
        },
      })
    );
    expect(singleHopAllowed.status).toBe(200);

    process.env.TRUST_PROXY = '2';
    const twoHopAllowed = await middleware(
      new NextRequest('http://localhost:3000/guest/login', {
        headers: {
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'spoofed.evil.org, tenant1.wedding.example, lb.internal',
        },
      })
    );
    expect(twoHopAllowed.status).toBe(200);
  });

  it('blocks requests with CRLF or header injection in Host header', async () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: {
        host: 'localhost:3000\r\nX-Injected: true',
      },
    });

    const res = await middleware(req);
    expect(res.status).toBe(400);
  });

  it('enforces ALLOWED_HOSTS checks on /api/registry/webhook/stripe, /api/cron/broadcasts, and /uploads/* before exclusions when TRUST_PROXY is enabled', async () => {
    process.env.TRUST_PROXY = 'true';

    for (const targetPath of [
      '/api/registry/webhook/stripe',
      '/api/cron/broadcasts',
      '/uploads/photo.png',
    ]) {
      const req = new NextRequest(`http://localhost:3000${targetPath}`, {
        method: targetPath.includes('webhook') ? 'POST' : 'GET',
        headers: {
          host: 'localhost:3000',
          'x-forwarded-host': 'spoofed-host.invalid',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid Host header' });
    }
  });
});
