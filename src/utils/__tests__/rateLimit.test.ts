import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import {
  rateLimit,
  checkAuthLockout,
  recordAuthFailure,
  createAuthLockoutInstance,
  getClientIp,
  sanitizeIpToken,
  hashAuthLockoutKey,
  normalizeApiPathname,
  resetRateLimitsForTesting,
  setAuthLockoutPoolForTesting,
  getRateLimitsCountForTesting,
  getRateLimitsForTesting,
  getAuthRateLimitsCountForTesting,
  getAuthRateLimitsForTesting,
  MAX_RATE_LIMIT_KEYS,
} from '../rateLimit';
import { signAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteToken';
import { logger } from '@/lib/logger';

describe('rateLimit', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalStaticExport = process.env.STATIC_EXPORT;

  const setNodeEnv = (val: string | undefined) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = val;
  };

  beforeEach(() => {
    setAuthLockoutPoolForTesting(undefined);
    resetRateLimitsForTesting();
    delete process.env.TRUST_PROXY;
    delete process.env.STATIC_EXPORT;
    setNodeEnv(originalNodeEnv);
  });

  afterAll(() => {
    setAuthLockoutPoolForTesting(undefined);
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
    if (originalStaticExport === undefined) {
      delete process.env.STATIC_EXPORT;
    } else {
      process.env.STATIC_EXPORT = originalStaticExport;
    }
    setNodeEnv(originalNodeEnv);
  });

  test('rateLimit exports a function', () => {
    expect(typeof rateLimit).toBe('function');
  });

  describe('Default TRUST_PROXY=false (proxy headers and removed req.ip ignored)', () => {
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

    test('ignores removed NextRequest.ip property and resolves 127.0.0.1 when TRUST_PROXY is false', async () => {
      const req1 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '198.51.100.1',
        },
      });
      Object.defineProperty(req1, 'ip', { value: '192.0.2.10' });

      const req2 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '198.51.100.2',
        },
      });
      Object.defineProperty(req2, 'ip', { value: '192.0.2.99' });

      expect(getClientIp(req1)).toBe('127.0.0.1');
      expect(getClientIp(req2)).toBe('127.0.0.1');
      expect(await rateLimit(req1, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(req2, 1, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
      expect(getRateLimitsForTesting().has('/api/test:127.0.0.1')).toBe(true);
    });

    test('logs a one-time structured warning in production when forwarded headers arrive with TRUST_PROXY=false', () => {
      setNodeEnv('production');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        const req1 = new NextRequest('http://localhost/api/test', {
          headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
        });
        const req2 = new NextRequest('http://localhost/api/test', {
          headers: { 'x-real-ip': '203.0.113.11' },
        });

        expect(getClientIp(req1)).toBe('127.0.0.1');
        expect(getClientIp(req2)).toBe('127.0.0.1');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('TRUST_PROXY is disabled'),
          expect.objectContaining({
            trustProxy: false,
            headers: ['x-forwarded-for'],
          })
        );
      } finally {
        warnSpy.mockRestore();
        setNodeEnv(originalNodeEnv);
      }
    });
  });

  describe('Opt-in TRUST_PROXY enabled & IP sanitization', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = 'true';
    });

    test('sanitizes IPv4 ports, bracketed IPv6 ports, quotes, and preserves unbracketed IPv6', () => {
      expect(sanitizeIpToken('203.0.113.45:54321')).toBe('203.0.113.45');
      expect(sanitizeIpToken('"[2001:DB8::1]:8443"')).toBe('2001:db8::1');
      expect(sanitizeIpToken('[2001:db8::42]')).toBe('2001:db8::42');
      expect(sanitizeIpToken('2001:db8::1')).toBe('2001:db8::1');
      expect(sanitizeIpToken('fe80::1%eth0')).toBe('fe80::1');
      expect(sanitizeIpToken('not-a-valid-ip:8080')).toBeNull();
      expect(sanitizeIpToken('')).toBeNull();
    });

    test('resolves <client-ip> from two-hop Cloud Run X-Forwarded-For: <client-ip>, <lb-ip> when TRUST_PROXY=2', () => {
      process.env.TRUST_PROXY = '2';

      const cloudRunReq = new NextRequest('http://localhost/api/guest/login', {
        headers: { 'x-forwarded-for': '203.0.113.77:51234, 34.107.200.5' },
      });
      expect(getClientIp(cloudRunReq)).toBe('203.0.113.77');

      const ipv6CloudRunReq = new NextRequest('http://localhost/api/guest/login', {
        headers: { 'x-forwarded-for': '[2001:db8::88]:443, 34.107.200.5' },
      });
      expect(getClientIp(ipv6CloudRunReq)).toBe('2001:db8::88');
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
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.195:40123' },
      });

      const reqSpoofed2 = new NextRequest('http://localhost/api/test', {
        headers: { 'x-forwarded-for': '8.8.8.8, 203.0.113.195:40999' },
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

    test('extracts sanitized client IP from x-real-ip when x-forwarded-for is missing', async () => {
      const req = new NextRequest('http://localhost/api/test', {
        headers: { 'x-real-ip': '198.51.100.42:55100' },
      });

      expect(getClientIp(req)).toBe('198.51.100.42');
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

    test('isolates general API buckets across admin_auth, guest_invite_session, and per-login guest_auth cookies on shared Wi-Fi IP while keeping auth routes keyed by client IP', async () => {
      const sharedWifiIp = '198.51.100.50';
      const now = Date.now();
      const exp = now + 3600000;

      const adminToken = await signAdminToken({ isAdmin: true, iat: now, exp });
      const inviteTokenA = await signGuestInviteSessionToken({
        code: 'HOUSEHOLD_A',
        guestName: 'Household A',
        iat: now,
        exp,
      });
      const inviteTokenB = await signGuestInviteSessionToken({
        code: 'HOUSEHOLD_B',
        guestName: 'Household B',
        iat: now,
        exp,
      });
      // Two guests logging in at the exact same millisecond receive distinct per-login guest_auth tokens
      const guestToken1 = await signGuestToken({ guest: true, iat: now, exp });
      const guestToken2 = await signGuestToken({ guest: true, iat: now, exp });
      expect(guestToken1).not.toBe(guestToken2);

      const makeGeneralReq = (cookieHeader?: string) =>
        new NextRequest('http://localhost/api/schedule', {
          headers: {
            'x-forwarded-for': sharedWifiIp,
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
          },
        });

      // Exhaust limit=1 for admin session
      expect(await rateLimit(makeGeneralReq(`${ADMIN_COOKIE}=${adminToken}`), 1, 60000)).toBeNull();
      expect((await rateLimit(makeGeneralReq(`${ADMIN_COOKIE}=${adminToken}`), 1, 60000))?.status).toBe(429);

      // Household A, Household B, Guest 1, Guest 2, and unauthenticated IP each have independent general buckets
      expect(await rateLimit(makeGeneralReq(`${GUEST_INVITE_COOKIE}=${inviteTokenA}`), 1, 60000)).toBeNull();
      expect((await rateLimit(makeGeneralReq(`${GUEST_INVITE_COOKIE}=${inviteTokenA}`), 1, 60000))?.status).toBe(429);

      expect(await rateLimit(makeGeneralReq(`${GUEST_INVITE_COOKIE}=${inviteTokenB}`), 1, 60000)).toBeNull();
      expect(await rateLimit(makeGeneralReq(`${GUEST_COOKIE}=${guestToken1}`), 1, 60000)).toBeNull();
      expect((await rateLimit(makeGeneralReq(`${GUEST_COOKIE}=${guestToken1}`), 1, 60000))?.status).toBe(429);

      expect(await rateLimit(makeGeneralReq(`${GUEST_COOKIE}=${guestToken2}`), 1, 60000)).toBeNull();
      expect(await rateLimit(makeGeneralReq(), 1, 60000)).toBeNull();

      // Auth routes ALWAYS key by client IP even if valid session cookies are attached
      for (let i = 0; i < 5; i++) {
        const authReq = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: {
            'x-forwarded-for': sharedWifiIp,
            cookie: `${GUEST_COOKIE}=${i % 2 === 0 ? guestToken1 : guestToken2}`,
          },
        });
        expect(await rateLimit(authReq, 5, 15 * 60 * 1000)).toBeNull();
      }
      const sixthAuthWithAdminCookie = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: {
          'x-forwarded-for': sharedWifiIp,
          cookie: `${ADMIN_COOKIE}=${adminToken}`,
        },
      });
      expect((await rateLimit(sixthAuthWithAdminCookie, 5, 15 * 60 * 1000))?.status).toBe(429);
      expect(getAuthRateLimitsForTesting().has(`/api/guest/login:${sharedWifiIp}`)).toBe(true);
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

  describe('PostgreSQL lockout synchronization, HMAC hashing, STATIC_EXPORT bypass & fail-open fallback', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = '1';
    });

    test('hashes raw client IP keys with HMAC-SHA256 so raw IPs never appear in digest', () => {
      const rawKey = '/api/guest/login:203.0.113.99';
      const hashed = hashAuthLockoutKey(rawKey);
      expect(hashed).toMatch(/^[a-f0-9]{64}$/);
      expect(hashed).not.toContain('203.0.113.99');
      expect(hashAuthLockoutKey(rawKey)).toBe(hashed);
    });

    test('skips PostgreSQL queries during STATIC_EXPORT=true builds and uses local memory', async () => {
      process.env.STATIC_EXPORT = 'true';
      const querySpy = jest.fn();
      const mockPool = { query: querySpy } as unknown as Pool;
      setAuthLockoutPoolForTesting(mockPool);

      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.55' },
      });
      expect(await checkAuthLockout(req, 5, 15 * 60 * 1000)).toBeNull();
      await recordAuthFailure(req, 15 * 60 * 1000);
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('fails open to local authStore when PostgreSQL errors or times out without throwing', async () => {
      const failingPool = {
        query: jest.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as Pool;
      const instanceWithBrokenDb = createAuthLockoutInstance({
        pool: failingPool,
        queryTimeoutMs: 25,
      });

      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.66' },
      });

      // Valid check does not fail when DB errors
      expect(await instanceWithBrokenDb.checkLockout(req, 5, 15 * 60 * 1000)).toBeNull();

      // 5 failed attempts fall back to local memory store
      for (let i = 0; i < 5; i++) {
        await instanceWithBrokenDb.recordFailure(req, 15 * 60 * 1000);
      }
      expect(instanceWithBrokenDb.getLocalStoreSize()).toBe(1);

      // 6th check enforces 429 from local memory fallback
      const blocked = await instanceWithBrokenDb.checkLockout(req, 5, 15 * 60 * 1000);
      expect(blocked?.status).toBe(429);

      // Hanging pool times out cleanly and fails open
      const hangingPool = {
        query: jest.fn(() => new Promise(() => {})),
      } as unknown as Pool;
      const instanceWithTimeout = createAuthLockoutInstance({
        pool: hangingPool,
        queryTimeoutMs: 20,
      });
      const freshReq = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.67' },
      });
      expect(await instanceWithTimeout.checkLockout(freshReq, 5, 15 * 60 * 1000)).toBeNull();
    });
  });

  describe('normalizeApiPathname', () => {
    test('preserves static API endpoints while collapsing dynamic parameters', () => {
      expect(normalizeApiPathname('/api/admin/login')).toBe('/api/admin/login');
      expect(normalizeApiPathname('/api/admin/setup/')).toBe('/api/admin/setup');
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
