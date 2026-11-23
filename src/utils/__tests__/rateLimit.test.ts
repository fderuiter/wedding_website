import { NextRequest } from 'next/server';
import {
  rateLimit,
  normalizeApiPathname,
  resetRateLimitsForTesting,
  getRateLimitsCountForTesting,
  getRateLimitsForTesting,
  getAuthRateLimitsCountForTesting,
  getAuthRateLimitsForTesting,
  MAX_RATE_LIMIT_KEYS,
} from '../rateLimit';
import { signAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';

describe('rateLimit', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    resetRateLimitsForTesting();
    delete process.env.TRUST_PROXY;
  });

  afterAll(() => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
  });

  test('rateLimit exports a function', () => {
    expect(typeof rateLimit).toBe('function');
  });

  describe('Default TRUST_PROXY=false (proxy headers ignored)', () => {
    test('ignores rotating X-Forwarded-For and X-Real-IP headers when TRUST_PROXY is disabled', async () => {
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: {
            'x-forwarded-for': `198.51.100.${i + 1}`,
            'x-real-ip': `203.0.113.${i + 1}`,
          },
        });
        expect(await rateLimit(req, 5, 15 * 60 * 1000)).toBeNull();
      }

      const spoofReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '198.51.100.250',
          'x-real-ip': '203.0.113.250',
        },
      });
      const blockedRes = await rateLimit(spoofReq, 5, 15 * 60 * 1000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
      expect(getAuthRateLimitsForTesting().has('/api/admin/login:127.0.0.1')).toBe(true);
    });

    test('falls back to loopback IP 127.0.0.1 when no trusted address exists', async () => {
      const req1 = new NextRequest('http://localhost/api/test');
      const req2 = new NextRequest('http://localhost/api/test');

      expect(await rateLimit(req1, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(req2, 1, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
    });

    test('prioritizes req.ip from Next.js runtime even when TRUST_PROXY is false', async () => {
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

      expect(await rateLimit(req1, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(req2, 1, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
    });
  });

  describe('Opt-in TRUST_PROXY enabled', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = 'true';
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
      const reqSpoofed = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.195' },
      });

      const reqSpoofed2 = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.195' },
      });

      expect(await rateLimit(reqSpoofed, 2, 60000)).toBeNull();
      expect(await rateLimit(reqSpoofed, 2, 60000)).toBeNull();

      const blockedRes = await rateLimit(reqSpoofed2, 2, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
    });

    test('supports positive integer hop counts in TRUST_PROXY', async () => {
      process.env.TRUST_PROXY = '2';

      // Client sends spoofed 1.1.1.1, CDN appends real client 203.0.113.77, LB appends CDN 10.0.0.5
      const req1 = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.77, 10.0.0.5' },
      });
      const req2 = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.77, 10.0.0.6' },
      });
      const differentClientReq = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '203.0.113.88, 10.0.0.5' },
      });

      expect(await rateLimit(req1, 1, 60000)).toBeNull();
      expect((await rateLimit(req2, 1, 60000))?.status).toBe(429);
      expect(await rateLimit(differentClientReq, 1, 60000)).toBeNull();
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

      expect(await rateLimit(reqSpoofed1, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(reqSpoofed2, 1, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
    });

    test('rejects unverified admin cookies and falls back to client IP throttling', async () => {
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
        exp: Date.now() - 5000,
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

      expect(await rateLimit(adminReq1, 1, 60000)).toBeNull();
      const blockedAdmin = await rateLimit(adminReq2, 1, 60000);
      expect(blockedAdmin?.status).toBe(429);

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

      await new Promise((resolve) => setTimeout(resolve, 60));

      const req2 = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '10.0.0.2' },
      });
      expect(await rateLimit(req2, 5, 60000)).toBeNull();

      expect(getRateLimitsCountForTesting()).toBe(1);
      const map = getRateLimitsForTesting();
      expect(map.has('/api/test:10.0.0.1')).toBe(false);
      expect(map.has('/api/test:10.0.0.2')).toBe(true);
    });

    test('bounds cache capacity to MAX_RATE_LIMIT_KEYS and evicts oldest entry when full', async () => {
      expect(MAX_RATE_LIMIT_KEYS).toBe(10000);

      for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
        const req = new NextRequest('http://localhost/api/test', {
          headers: { 'x-forwarded-for': `172.16.${Math.floor(i / 256)}.${i % 256}` },
        });
        await rateLimit(req, 10, 60000);
      }
      expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);

      const oldestKey = '/api/test:172.16.0.0';
      expect(getRateLimitsForTesting().has(oldestKey)).toBe(true);

      const overflowReq = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '192.168.99.99' },
      });
      await rateLimit(overflowReq, 10, 60000);

      expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);
      expect(getRateLimitsForTesting().has(oldestKey)).toBe(false);
      expect(getRateLimitsForTesting().has('/api/test:192.168.99.99')).toBe(true);
    });

    test('isolates auth lockouts from general API eviction and normalizes dynamic API paths', async () => {
      // Trigger 5-attempt lockout on POST /api/guest/login from fixed IP
      for (let i = 0; i < 5; i++) {
        const loginReq = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.77' },
        });
        expect(await rateLimit(loginReq, 5, 15 * 60 * 1000)).toBeNull();
      }
      expect(getAuthRateLimitsCountForTesting()).toBe(1);

      // Flood 10,000 dynamic API URLs from the same fixed IP
      for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 100; i++) {
        const dynReq = new NextRequest(`http://localhost/api/admin/evict/key-${i}.png`, {
          headers: { 'x-forwarded-for': '203.0.113.77' },
        });
        await rateLimit(dynReq, 100, 60000);
      }

      // Dynamic paths collapse to a single normalized bucket entry
      expect(getRateLimitsCountForTesting()).toBe(1);
      expect(getRateLimitsForTesting().has('/api/admin/:entity/:id:203.0.113.77')).toBe(true);

      // Even if general store is filled across 10,000 distinct client IPs, auth lockout remains active
      for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 50; i++) {
        const ipReq = new NextRequest('http://localhost/api/weather', {
          headers: { 'x-forwarded-for': `10.1.${Math.floor(i / 256)}.${i % 256}` },
        });
        await rateLimit(ipReq, 100, 60000);
      }
      expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);

      const postFloodLoginReq = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.77' },
      });
      const afterEvict = await rateLimit(postFloodLoginReq, 5, 15 * 60 * 1000);
      expect(afterEvict?.status).toBe(429);
    });
  });

  describe('normalizeApiPathname', () => {
    test('preserves static API endpoints while collapsing dynamic parameters', () => {
      expect(normalizeApiPathname('/api/admin/login')).toBe('/api/admin/login');
      expect(normalizeApiPathname('/api/admin/setup/')).toBe('/api/admin/setup');
      expect(normalizeApiPathname('/api/guest/session')).toBe('/api/guest/session');
      expect(normalizeApiPathname('/api/registry/validate-code')).toBe('/api/registry/validate-code');
      expect(normalizeApiPathname('/api/registry/items/batch')).toBe('/api/registry/items/batch');
      expect(normalizeApiPathname('/api/registry/items/item-123')).toBe('/api/registry/items/:id');
      expect(normalizeApiPathname('/api/media/export')).toBe('/api/media/export');
      expect(normalizeApiPathname('/api/media/photo-abc')).toBe('/api/media/:id');
      expect(normalizeApiPathname('/api/admin/evict/key-42.png')).toBe('/api/admin/:entity/:id');
      expect(normalizeApiPathname('/api/schedule/sub-1/ics')).toBe('/api/schedule/:id/ics');
      expect(normalizeApiPathname('/api/admin/versions/v-1/restore')).toBe('/api/admin/versions/:id/restore');
    });
  });
});
