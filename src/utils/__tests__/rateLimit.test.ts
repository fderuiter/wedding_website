import http from 'node:http';
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import {
  rateLimit,
  checkAuthLockout,
  recordAuthFailure,
  recordFailedAuthAttempt,
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
import { signGuestToken, verifyGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import {
  signGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteToken';
import { logger } from '@/lib/logger';
import {
  INTERNAL_SOCKET_IP_HEADER,
  INTERNAL_SOCKET_IP_SIG_HEADER,
  createVerifiedSocketIpHeaders,
  getOrCreateSocketIpSecret,
  installHttpSocketIpBoundary,
  normalizeSocketIp,
  readVerifiedSocketIp,
  stampIncomingMessageSocketIp,
  stripInternalSocketIpHeaders,
} from '@/lib/socket-ip-boundary.js';

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

  describe('Default TRUST_PROXY=false (verified socket IP boundary, proxy headers and removed req.ip ignored)', () => {
    test('ignores rotating X-Forwarded-For and X-Real-IP headers from one verified TCP socket and blocks after 5 failed attempts', async () => {
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2', {
            'x-forwarded-for': `198.51.100.${i + 1}`,
            'x-real-ip': `203.0.113.${i + 1}`,
          }),
        });
        expect(await checkAuthLockout(req)).toBeNull();
        await recordFailedAuthAttempt(req);
      }

      const spoofReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.2', {
          'x-forwarded-for': '198.51.100.250',
          'x-real-ip': '203.0.113.250',
        }),
      });
      const blockedRes = await checkAuthLockout(spoofReq);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
      expect(getAuthRateLimitsForTesting().has('/api/admin/login:127.0.0.2')).toBe(true);

      // Distinct TCP peer socket (127.0.0.3) remains completely unaffected
      const otherPeerReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.3'),
      });
      expect(await checkAuthLockout(otherPeerReq)).toBeNull();
    });

    test('normalizes IPv4-mapped IPv6 socket addresses (::ffff:127.0.0.2) to canonical IPv4', async () => {
      expect(normalizeSocketIp('::ffff:127.0.0.2')).toBe('127.0.0.2');
      expect(normalizeSocketIp('0:0:0:0:0:ffff:127.0.0.2')).toBe('127.0.0.2');
      expect(normalizeSocketIp('[::ffff:127.0.0.3]')).toBe('127.0.0.3');

      const mappedReq = new NextRequest('http://localhost/api/test', {
        headers: createVerifiedSocketIpHeaders('::ffff:127.0.0.2', {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '198.51.100.1',
        }),
      });
      const canonicalReq = new NextRequest('http://localhost/api/test', {
        headers: createVerifiedSocketIpHeaders('127.0.0.2', {
          'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '198.51.100.2',
        }),
      });

      expect(await rateLimit(mappedReq, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(canonicalReq, 1, 60000);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(429);
      expect(getRateLimitsForTesting().has('/api/test:127.0.0.2')).toBe(true);
    });

    test('deletes caller-supplied NextRequest.ip property and resolves 127.0.0.1 when TRUST_PROXY is false and no socket header is present', async () => {
      const req1 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '198.51.100.1',
        },
      });
      Object.defineProperty(req1, 'ip', { value: '192.0.2.10', configurable: true });

      const req2 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.2',
          'x-real-ip': '198.51.100.2',
        },
      });
      Object.defineProperty(req2, 'ip', { value: '192.0.2.99', configurable: true });

      expect(getClientIp(req1)).toBe('127.0.0.1');
      expect('ip' in req1).toBe(false);
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

    test('rejects forged client-supplied internal socket headers and falls back to loopback 127.0.0.1', async () => {
      expect(getOrCreateSocketIpSecret()).toHaveLength(64);

      const forgedUnsignedReq = new NextRequest('http://localhost/api/test', {
        headers: {
          [INTERNAL_SOCKET_IP_HEADER]: '198.51.100.99',
        },
      });
      const forgedBadSigReq = new NextRequest('http://localhost/api/test', {
        headers: {
          [INTERNAL_SOCKET_IP_HEADER]: '198.51.100.88',
          [INTERNAL_SOCKET_IP_SIG_HEADER]: 'a'.repeat(64),
        },
      });

      expect(readVerifiedSocketIp(forgedUnsignedReq.headers)).toBeNull();
      expect(readVerifiedSocketIp(forgedBadSigReq.headers)).toBeNull();

      expect(await rateLimit(forgedUnsignedReq, 1, 60000)).toBeNull();
      const blockedRes = await rateLimit(forgedBadSigReq, 1, 60000);
      expect(blockedRes?.status).toBe(429);
      expect(getRateLimitsForTesting().has('/api/test:127.0.0.1')).toBe(true);
    });

    test('strips forged internal headers and stamps verified socket.remoteAddress at the HTTP server boundary', async () => {
      installHttpSocketIpBoundary();

      const mockIncoming = {
        headers: {
          [INTERNAL_SOCKET_IP_HEADER]: '203.0.113.200',
          [INTERNAL_SOCKET_IP_SIG_HEADER]: 'f'.repeat(64),
        },
        rawHeaders: [
          INTERNAL_SOCKET_IP_HEADER,
          '203.0.113.200',
          INTERNAL_SOCKET_IP_SIG_HEADER,
          'f'.repeat(64),
        ],
        socket: { remoteAddress: '::ffff:127.0.0.4' },
      };
      stripInternalSocketIpHeaders(mockIncoming);
      expect(mockIncoming.headers[INTERNAL_SOCKET_IP_HEADER]).toBeUndefined();
      expect(stampIncomingMessageSocketIp(mockIncoming)).toBe('127.0.0.4');
      expect(readVerifiedSocketIp(mockIncoming.headers)).toBe('127.0.0.4');

      const observedIps: string[] = [];
      const observedStatuses: number[] = [];
      const server = http.createServer(async (incomingReq, res) => {
        const headerEntries: Record<string, string> = {};
        for (const [k, v] of Object.entries(incomingReq.headers)) {
          if (typeof v === 'string') {
            headerEntries[k] = v;
          }
        }
        const nextReq = new NextRequest('http://127.0.0.1/api/test', {
          headers: headerEntries,
        });
        const verified = readVerifiedSocketIp(nextReq.headers);
        if (verified) {
          observedIps.push(verified);
        }
        const rl = await rateLimit(nextReq, 1, 60000);
        observedStatuses.push(rl ? rl.status : 200);
        res.end?.();
      });

      const emitSimulatedSocketRequest = async (remoteAddress: string, forgedIp: string) => {
        let done!: () => void;
        const finished = new Promise<void>((resolve) => {
          done = resolve;
        });
        const fakeIncoming = {
          headers: {
            [INTERNAL_SOCKET_IP_HEADER]: forgedIp,
            [INTERNAL_SOCKET_IP_SIG_HEADER]: 'b'.repeat(64),
            'x-forwarded-for': forgedIp,
          },
          rawHeaders: [
            INTERNAL_SOCKET_IP_HEADER,
            forgedIp,
            INTERNAL_SOCKET_IP_SIG_HEADER,
            'b'.repeat(64),
            'x-forwarded-for',
            forgedIp,
          ],
          socket: { remoteAddress },
        } as unknown as http.IncomingMessage;
        const fakeRes = { end: () => done() } as unknown as http.ServerResponse;
        server.emit('request', fakeIncoming, fakeRes);
        await finished;
      };

      await emitSimulatedSocketRequest('::ffff:127.0.0.2', '198.51.100.10');
      await emitSimulatedSocketRequest('127.0.0.2', '198.51.100.11');
      await emitSimulatedSocketRequest('127.0.0.3', '198.51.100.12');

      expect(observedIps).toEqual(['127.0.0.2', '127.0.0.2', '127.0.0.3']);
      expect(observedStatuses).toEqual([200, 429, 200]);
    });

    test('counts only failed authentication attempts toward the 5-attempt authStore lockout', async () => {
      // Six valid login checks from the same socket IP do not increment authStore
      for (let i = 0; i < 6; i++) {
        const validReq = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2'),
        });
        expect(await checkAuthLockout(validReq)).toBeNull();
      }
      expect(getAuthRateLimitsCountForTesting()).toBe(0);

      // Five failed login attempts populate authStore and block the 6th check
      for (let i = 0; i < 5; i++) {
        const failedReq = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2'),
        });
        expect(await checkAuthLockout(failedReq)).toBeNull();
        await recordFailedAuthAttempt(failedReq);
      }

      const sixthReq = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.2'),
      });
      const lockedOut = await checkAuthLockout(sixthReq);
      expect(lockedOut?.status).toBe(429);
    });

    test('binds auth lockout endpoints strictly to client IP even when rotating valid guest_auth cookies', async () => {
      for (let i = 0; i < 5; i++) {
        const freshGuestToken = await signGuestToken({
          guest: true,
          iat: 10000 + i,
          exp: Date.now() + 3600000,
        });
        const attemptReq = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2', {
            cookie: `${GUEST_COOKIE}=${freshGuestToken}`,
          }),
        });
        expect(await checkAuthLockout(attemptReq)).toBeNull();
        await recordFailedAuthAttempt(attemptReq);
      }

      const sixthGuestToken = await signGuestToken({
        guest: true,
        iat: 20000,
        exp: Date.now() + 3600000,
      });
      const bypassAttemptReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.2', {
          cookie: `${GUEST_COOKIE}=${sixthGuestToken}`,
        }),
      });
      expect((await checkAuthLockout(bypassAttemptReq))?.status).toBe(429);
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

    test('rejects unverified admin, guest, and invite cookies and falls back to client IP throttling', async () => {
      const req1 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.195',
          cookie: `${ADMIN_COOKIE}=attacker-fake-token-1; ${GUEST_COOKIE}=fake-guest-1; ${GUEST_INVITE_COOKIE}=fake-invite-1`,
        },
      });
      const req2 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '203.0.113.195',
          cookie: `${ADMIN_COOKIE}=attacker-fake-token-2; ${GUEST_COOKIE}=fake-guest-2; ${GUEST_INVITE_COOKIE}=fake-invite-2`,
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

    test('falls back to client IP when admin or guest cookies are expired', async () => {
      const expiredAdminToken = await signAdminToken({
        isAdmin: true,
        exp: Date.now() - 5000,
      });
      const expiredGuestToken = await signGuestToken({
        guest: true,
        exp: Date.now() - 5000,
      });
      const expiredInviteToken = await signGuestInviteSessionToken({
        code: 'EXPIRED1',
        guestName: 'Expired Guest',
        exp: Date.now() - 5000,
      });
      expect(await verifyGuestToken(expiredGuestToken)).toBeNull();

      const reqExpired1 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '198.51.100.20',
          cookie: `${ADMIN_COOKIE}=${expiredAdminToken}; ${GUEST_COOKIE}=${expiredGuestToken}`,
        },
      });
      const reqExpired2 = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-forwarded-for': '198.51.100.20',
          cookie: `${GUEST_INVITE_COOKIE}=${expiredInviteToken}`,
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
        expect(await checkAuthLockout(loginReq)).toBeNull();
        await recordFailedAuthAttempt(loginReq);
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
      const afterEvict = await checkAuthLockout(postFloodLoginReq);
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
      expect(normalizeApiPathname('/api/admin/geocode')).toBe('/api/admin/geocode');
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
      expect(normalizeApiPathname('/api/admin/registry/items/item-42/unclaim')).toBe('/api/admin/registry/items/:id/unclaim');
      expect(normalizeApiPathname('/api/admin/broadcast/history')).toBe('/api/admin/broadcast/history');
      expect(normalizeApiPathname('/api/admin/broadcast/bc-123')).toBe('/api/admin/broadcast/:id');
      expect(normalizeApiPathname('/api/admin/broadcast/schedule/bc-123')).toBe('/api/admin/broadcast/schedule/:id');
      expect(normalizeApiPathname('/api/admin/invitation-codes/merge')).toBe('/api/admin/invitation-codes/merge');
      expect(normalizeApiPathname('/api/admin/contributors/c-99')).toBe('/api/admin/:entity/:id');
      expect(normalizeApiPathname('/api/admin/contributors/c-99/action')).toBe('/api/admin/contributors/:id/action');
      expect(normalizeApiPathname('/api/admin/registry/items/item-123/unclaim')).toBe(
        '/api/admin/registry/items/:id/unclaim'
      );
      expect(normalizeApiPathname('/api/admin/geocode')).toBe('/api/admin/geocode');
      expect(normalizeApiPathname('/api/registry/claim')).toBe('/api/registry/claim');
      expect(normalizeApiPathname('/api/uploads/photos/hero.webp')).toBe('/api/uploads/:path');
    });
  });

  describe('Canonical Principals, Dual Session + IP Ceilings & Protected LRU Eviction', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = '1';
    });

    test('keys admin and invitation sessions on canonical identifiers regardless of token iat rotation', async () => {
      const now = Date.now();
      const exp = now + 3_600_000;
      const adminToken1 = await signAdminToken({ isAdmin: true, iat: now, exp });
      const adminToken2 = await signAdminToken({ isAdmin: true, iat: now + 1000, exp });
      expect(adminToken1).not.toBe(adminToken2);

      const adminReq1 = new NextRequest('http://localhost/api/admin/settings', {
        headers: { 'x-forwarded-for': '198.51.100.10', cookie: `${ADMIN_COOKIE}=${adminToken1}` },
      });
      const adminReq2 = new NextRequest('http://localhost/api/admin/settings', {
        headers: { 'x-forwarded-for': '198.51.100.11', cookie: `${ADMIN_COOKIE}=${adminToken2}` },
      });
      expect(await rateLimit(adminReq1, 1, 60_000)).toBeNull();
      expect((await rateLimit(adminReq2, 1, 60_000))?.status).toBe(429);

      const inviteToken1 = await signGuestInviteSessionToken({
        code: 'familya',
        guestName: 'Family A',
        iat: now,
        exp,
      });
      const inviteToken2 = await signGuestInviteSessionToken({
        code: 'FAMILYA',
        guestName: 'Family A',
        iat: now + 2000,
        exp,
      });
      expect(inviteToken1).not.toBe(inviteToken2);

      const inviteReq1 = new NextRequest('http://localhost/api/rsvp', {
        headers: {
          'x-forwarded-for': '198.51.100.12',
          cookie: `${GUEST_INVITE_COOKIE}=${inviteToken1}`,
        },
      });
      const inviteReq2 = new NextRequest('http://localhost/api/rsvp', {
        headers: {
          'x-forwarded-for': '198.51.100.13',
          cookie: `${GUEST_INVITE_COOKIE}=${inviteToken2}`,
        },
      });
      expect(await rateLimit(inviteReq1, 1, 60_000)).toBeNull();
      expect((await rateLimit(inviteReq2, 1, 60_000))?.status).toBe(429);
    });

    test('enforces aggregate client-IP ceiling across rotated guest_auth jti tokens while isolating shared Wi-Fi sessions', async () => {
      const abusiveIp = '203.0.113.200';
      const now = Date.now();
      const exp = now + 3_600_000;

      // Default aggregate IP ceiling for limit=5 is max(5 * 5, 20) = 25
      for (let i = 1; i <= 25; i++) {
        const rotatedGuestToken = await signGuestToken({
          guest: true,
          jti: `rotated-guest-${i}`,
          iat: now + i,
          exp,
        });
        const req = new NextRequest('http://localhost/api/schedule', {
          headers: {
            'x-forwarded-for': abusiveIp,
            cookie: `${GUEST_COOKIE}=${rotatedGuestToken}`,
          },
        });
        expect(await rateLimit(req, 5, 60_000)).toBeNull();
      }

      const twentySixthToken = await signGuestToken({
        guest: true,
        jti: 'rotated-guest-26',
        iat: now + 26,
        exp,
      });
      const blockedByIpCeiling = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': abusiveIp,
          cookie: `${GUEST_COOKIE}=${twentySixthToken}`,
        },
      });
      expect((await rateLimit(blockedByIpCeiling, 5, 60_000))?.status).toBe(429);

      // Different client IP remains unaffected
      const otherIpReq = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': '203.0.113.201',
          cookie: `${GUEST_COOKIE}=${twentySixthToken}`,
        },
      });
      expect(await rateLimit(otherIpReq, 5, 60_000)).toBeNull();
    });

    test('retains active blocked keys in generalStore and authStore when inserting 10,000 unblocked keys and refreshes LRU on access', async () => {
      // 1. Block an attacker IP on public_address_collect (limit = 2)
      const blockedGeneralIp = '198.51.100.250';
      const makeBlockedReq = () =>
        new NextRequest('http://localhost/api/guest/address/public', {
          method: 'POST',
          headers: { 'x-forwarded-for': blockedGeneralIp },
        });
      expect(await rateLimit(makeBlockedReq(), 2, 60_000, 'public_address_collect', 'general', { scope: 'ip' })).toBeNull();
      expect(await rateLimit(makeBlockedReq(), 2, 60_000, 'public_address_collect', 'general', { scope: 'ip' })).toBeNull();
      expect(
        (await rateLimit(makeBlockedReq(), 2, 60_000, 'public_address_collect', 'general', { scope: 'ip' }))?.status
      ).toBe(429);

      // 2. Seed an early unblocked key that we will refresh via LRU access
      const hotUnblockedIp = '198.51.100.251';
      const hotReq = new NextRequest('http://localhost/api/weather', {
        headers: { 'x-forwarded-for': hotUnblockedIp },
      });
      expect(await rateLimit(hotReq, 10, 60_000)).toBeNull();

      // Seed a cold unblocked key right after hotReq
      const coldUnblockedIp = '198.51.100.252';
      const coldReq = new NextRequest('http://localhost/api/weather', {
        headers: { 'x-forwarded-for': coldUnblockedIp },
      });
      expect(await rateLimit(coldReq, 10, 60_000)).toBeNull();

      // Refresh hotReq so it moves after coldReq in LRU order
      expect(await rateLimit(hotReq, 10, 60_000)).toBeNull();

      // Fill up to MAX_RATE_LIMIT_KEYS (currently 3 entries -> insert 9,997 + 1 overflow = 9,998 unblocked keys)
      for (let i = 0; i < MAX_RATE_LIMIT_KEYS - 2; i++) {
        const fillerReq = new NextRequest('http://localhost/api/weather', {
          headers: { 'x-forwarded-for': `10.99.${Math.floor(i / 256)}.${i % 256}` },
        });
        expect(await rateLimit(fillerReq, 10, 60_000)).toBeNull();
      }

      // Cold unblocked key was evicted first, while refreshed hot key AND active blocked key remain!
      expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);
      expect(getRateLimitsForTesting().has(`/api/weather:${coldUnblockedIp}`)).toBe(false);
      expect(getRateLimitsForTesting().has(`/api/weather:${hotUnblockedIp}`)).toBe(true);
      expect(getRateLimitsForTesting().has(`public_address_collect:${blockedGeneralIp}`)).toBe(true);

      // Insert 10,000 MORE unblocked keys to churn the entire unblocked capacity
      for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
        const churnReq = new NextRequest('http://localhost/api/weather', {
          headers: { 'x-forwarded-for': `10.100.${Math.floor(i / 256)}.${i % 256}` },
        });
        expect(await rateLimit(churnReq, 10, 60_000)).toBeNull();
      }

      expect(getRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);
      expect(getRateLimitsForTesting().has(`public_address_collect:${blockedGeneralIp}`)).toBe(true);
      expect(
        (await rateLimit(makeBlockedReq(), 2, 60_000, 'public_address_collect', 'general', { scope: 'ip' }))?.status
      ).toBe(429);

      // 3. Verify authStore also retains active blocked keys across 10,000 unblocked failure keys
      const blockedAuthIp = '198.51.100.253';
      const blockedAuthReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': blockedAuthIp },
      });
      for (let i = 0; i < 5; i++) {
        await recordAuthFailure(blockedAuthReq, 15 * 60 * 1000);
      }
      expect((await checkAuthLockout(blockedAuthReq, 5, 15 * 60 * 1000))?.status).toBe(429);

      for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
        const unblockedAuthReq = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': `10.101.${Math.floor(i / 256)}.${i % 256}` },
        });
        await recordAuthFailure(unblockedAuthReq, 15 * 60 * 1000);
      }

      expect(getAuthRateLimitsCountForTesting()).toBe(MAX_RATE_LIMIT_KEYS);
      expect((await checkAuthLockout(blockedAuthReq, 5, 15 * 60 * 1000))?.status).toBe(429);
    });
  });
});
