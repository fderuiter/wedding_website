/** @jest-environment node */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('Perimeter Host Header Filtering Middleware', () => {
  it('allows requests with whitelisted Host headers to proceed', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/me', {
      headers: {
        host: 'localhost:3000',
      },
    });

    const res = await middleware(req);
    // Should NOT be 400 Bad Request from host filtering
    expect(res.status).not.toBe(400);
  });

  it('allows whitelisted tenant subdomains to proceed', async () => {
    const req = new NextRequest('http://tenant1.abbifred.com/guest/login', {
      headers: {
        host: 'tenant1.abbifred.com',
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

  it('blocks requests with spoofed X-Forwarded-Host headers', async () => {
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

  it('blocks requests with CRLF or header injection in Host header', async () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: {
        host: 'localhost:3000\r\nX-Injected: true',
      },
    });

    const res = await middleware(req);
    expect(res.status).toBe(400);
  });
});
