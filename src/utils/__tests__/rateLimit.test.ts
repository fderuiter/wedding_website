import { NextRequest } from 'next/server';
import {
  rateLimit,
  resetRateLimitsForTesting,
  getRateLimitsCountForTesting,
  getRateLimitsForTesting,
  MAX_RATE_LIMIT_KEYS,
} from '../rateLimit';
import { signAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';

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

  test('rejects unverified admin cookies and falls back to client IP throttling', async () => {
    // Attacker rotates unverified admin cookies to attempt rate limit bypass
    const req1 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.195',
        cookie: `${ADMIN_COOKIE}=attacker-fake-token-1`,
      },
    });
    const req2 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.195',
        cookie: `${ADMIN_COOKIE}=attacker-fake-token-2`,
      },
    });

    // Both requests must share the client IP bucket since cookies are unverified
    expect(await rateLimit(req1, 1, 60000)).toBeNull();
    const blockedRes = await rateLimit(req2, 1, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('falls back to client IP without error when cookie is malformed or signature is invalid', async () => {
    const malformedReq = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.100',
        cookie: `${ADMIN_COOKIE}=not-a-valid-token-at-all`,
      },
    });

    expect(await rateLimit(malformedReq, 1, 60000)).toBeNull();

    // Second request with tampered token on same IP is throttled
    const tamperedReq = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.100',
        cookie: `${ADMIN_COOKIE}=eyJhbGciOiJIUzI1NiJ9.invalidSignature`,
      },
    });
    const blockedRes = await rateLimit(tamperedReq, 1, 60000);
    expect(blockedRes?.status).toBe(429);
  });

  test('falls back to client IP when admin cookie is expired', async () => {
    const expiredToken = await signAdminToken({
      isAdmin: true,
      exp: Date.now() - 5000, // expired 5 seconds ago
    });

    const reqExpired1 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.20',
        cookie: `${ADMIN_COOKIE}=${expiredToken}`,
      },
    });
    const reqExpired2 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.20',
        cookie: `${ADMIN_COOKIE}=${expiredToken}`,
      },
    });

    // Expired cookie falls back to IP rate limiting
    expect(await rateLimit(reqExpired1, 1, 60000)).toBeNull();
    const blockedRes = await rateLimit(reqExpired2, 1, 60000);
    expect(blockedRes).not.toBeNull();
    expect(blockedRes?.status).toBe(429);
  });

  test('assigns session identifier for valid admin token and isolates from unauthenticated IP limit', async () => {
    const validToken = await signAdminToken({
      isAdmin: true,
      iat: Date.now(),
      exp: Date.now() + 3600000,
    });

    const adminReq1 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.50',
        cookie: `${ADMIN_COOKIE}=${validToken}`,
      },
    });
    const adminReq2 = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.50',
        cookie: `${ADMIN_COOKIE}=${validToken}`,
      },
    });

    // Valid admin requests track against session bucket (limit = 1)
    expect(await rateLimit(adminReq1, 1, 60000)).toBeNull();
    const blockedAdmin = await rateLimit(adminReq2, 1, 60000);
    expect(blockedAdmin?.status).toBe(429);

    // Unauthenticated request from the same IP has its own separate bucket
    const guestReq = new NextRequest('http://localhost/api/test', {
      headers: {
        'x-forwarded-for': '198.51.100.50',
      },
    });
    expect(await rateLimit(guestReq, 1, 60000)).toBeNull();
  });

  test('prunes expired cache entries before inserting new entries', async () => {
    const shortWindowMs = 50;
    const req1 = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(await rateLimit(req1, 5, shortWindowMs)).toBeNull();
    expect(getRateLimitsCountForTesting()).toBe(1);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Request with new key should trigger pruning of expired entries before inserting
    const req2 = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(await rateLimit(req2, 5, 60000)).toBeNull();

    // Map should only contain req2's entry, as req1's expired entry was pruned
    expect(getRateLimitsCountForTesting()).toBe(1);
    const map = getRateLimitsForTesting();
    expect(map.has('/api/test:10.0.0.1')).toBe(false);
    expect(map.has('/api/test:10.0.0.2')).toBe(true);
  });

  test('bounds cache capacity to MAX_RATE_LIMIT_KEYS and evicts oldest entry when full', async () => {
    expect(MAX_RATE_LIMIT_KEYS).toBe(10000);

    // Fill the cache up to capacity (10,000 entries)
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
      const req = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': `172.16.${Math.floor(i / 256)}.${i % 256}` },
      });
      await rateLimit(req, 10, 60000);
    }
    expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);

    const oldestKey = '/api/test:172.16.0.0';
    expect(getRateLimitsForTesting().has(oldestKey)).toBe(true);

    // Insert 10,001th entry
    const overflowReq = new NextRequest('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '192.168.99.99' },
    });
    await rateLimit(overflowReq, 10, 60000);

    // Size must remain bounded at MAX_RATE_LIMIT_KEYS
    expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);

    // Oldest entry should have been evicted
    expect(getRateLimitsForTesting().has(oldestKey)).toBe(false);
    // New entry must be present
    expect(getRateLimitsForTesting().has('/api/test:192.168.99.99')).toBe(true);
  });
});
