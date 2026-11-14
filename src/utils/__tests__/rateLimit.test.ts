import { NextRequest } from 'next/server';
import { rateLimit, resetRateLimitsForTesting } from '../rateLimit';

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimitsForTesting();
  });

  test('rateLimit exports a function', () => {
    expect(typeof rateLimit).toBe('function');
  });

  test('allows requests within rate limit and blocks when limit is exceeded', async () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '203.0.113.195' },
    });

    for (let i = 0; i < 5; i++) {
      const res = await rateLimit(req, 5, 60000);
      expect(res).toBeNull();
    }

    const blockedRes = await rateLimit(req, 5, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('uses rightmost IP from X-Forwarded-For header to prevent client header spoofing', async () => {
    // Client sends spoofed header: "1.1.1.1", proxy appends real IP: "203.0.113.195"
    const reqSpoofed = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.195' },
    });

    // Request with different spoofed prefix but same proxy IP "203.0.113.195"
    const reqSpoofed2 = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.195' },
    });

    // Send 2 requests from reqSpoofed (limit set to 2)
    expect(await rateLimit(reqSpoofed, 2, 60000)).toBeNull();
    expect(await rateLimit(reqSpoofed, 2, 60000)).toBeNull();

    // 3rd request with different spoofed header but same proxy IP should be blocked
    const blockedRes = await rateLimit(reqSpoofed2, 2, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('extracts client IP from x-real-ip when x-forwarded-for is missing', async () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { 'x-real-ip': '198.51.100.42' },
    });

    expect(await rateLimit(req, 1, 60000)).toBeNull();
    const blocked = await rateLimit(req, 1, 60000);
    expect(blocked?.status).toBe(429);
  });

  test('prevents forged x-real-ip headers from bypassing request limits when x-forwarded-for is present', async () => {
    // Both requests originate from the same proxy client IP (203.0.113.195),
    // but the attacker sends alternating forged x-real-ip headers.
    const reqSpoofed1 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.195',
        'x-real-ip': '198.51.100.1',
      },
    });

    const reqSpoofed2 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.195',
        'x-real-ip': '198.51.100.2',
      },
    });

    // With a limit of 1, the first request succeeds and the second must be blocked
    expect(await rateLimit(reqSpoofed1, 1, 60000)).toBeNull();
    const blockedRes = await rateLimit(reqSpoofed2, 1, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('prioritizes req.ip from Next.js runtime when available', async () => {
    const req1 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        'x-real-ip': '198.51.100.1',
      },
    });
    Object.defineProperty(req1, 'ip', { value: '192.0.2.1' });

    const req2 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.2',
        'x-real-ip': '198.51.100.2',
      },
    });
    Object.defineProperty(req2, 'ip', { value: '192.0.2.1' });

    // Both requests share req.ip '192.0.2.1', so the second request should exceed limit of 1
    expect(await rateLimit(req1, 1, 60000)).toBeNull();
    const blockedRes = await rateLimit(req2, 1, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('falls back to loopback IP 127.0.0.1 when no trusted address exists', async () => {
    const req1 = new NextRequest('http://localhost/api/test');
    const req2 = new NextRequest('http://localhost/api/test');

    expect(await rateLimit(req1, 1, 60000)).toBeNull();
    const blockedRes = await rateLimit(req2, 1, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });
});
