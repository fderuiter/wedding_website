import http from 'node:http';
import { NextRequest } from 'next/server';
import {
  rateLimit,
  checkAuthLockout,
  recordFailedAuthAttempt,
  normalizeApiPathname,
  resetRateLimitsForTesting,
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

  describe('Default TRUST_PROXY=false (verified socket IP boundary, proxy headers ignored)', () => {
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

    test('assigns isolated session identifiers for verified admin, guest_invite_session, and guest_auth cookies on shared Wi-Fi', async () => {
      const validAdminToken = await signAdminToken({
        isAdmin: true,
        iat: 1000,
        exp: Date.now() + 3600000,
      });
      const validInviteToken = await signGuestInviteSessionToken({
        code: 'HOUSEHOLD1',
        guestName: 'Alice & Bob',
        iat: 2000,
        exp: Date.now() + 3600000,
      });
      const validGuestTokenA = await signGuestToken({
        guest: true,
        iat: 3000,
        exp: Date.now() + 3600000,
      });
      const validGuestTokenB = await signGuestToken({
        guest: true,
        iat: 4000,
        exp: Date.now() + 3600000,
      });

      const sharedVenueIp = '198.51.100.50';

      const adminReq1 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${ADMIN_COOKIE}=${validAdminToken}`,
        },
      });
      const adminReq2 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${ADMIN_COOKIE}=${validAdminToken}`,
        },
      });

      const inviteReq1 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${GUEST_INVITE_COOKIE}=${validInviteToken}`,
        },
      });
      const inviteReq2 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${GUEST_INVITE_COOKIE}=${validInviteToken}`,
        },
      });

      const guestAReq1 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${GUEST_COOKIE}=${validGuestTokenA}`,
        },
      });
      const guestAReq2 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${GUEST_COOKIE}=${validGuestTokenA}`,
        },
      });

      const guestBReq1 = new NextRequest('http://localhost/api/schedule', {
        headers: {
          'x-forwarded-for': sharedVenueIp,
          cookie: `${GUEST_COOKIE}=${validGuestTokenB}`,
        },
      });

      const unauthReq = new NextRequest('http://localhost/api/schedule', {
        headers: { 'x-forwarded-for': sharedVenueIp },
      });

      expect(await rateLimit(adminReq1, 1, 60000)).toBeNull();
      expect((await rateLimit(adminReq2, 1, 60000))?.status).toBe(429);

      expect(await rateLimit(inviteReq1, 1, 60000)).toBeNull();
      expect((await rateLimit(inviteReq2, 1, 60000))?.status).toBe(429);

      expect(await rateLimit(guestAReq1, 1, 60000)).toBeNull();
      expect((await rateLimit(guestAReq2, 1, 60000))?.status).toBe(429);

      // Distinct guest session and unauthenticated visitor on the same venue Wi-Fi IP remain unblocked
      expect(await rateLimit(guestBReq1, 1, 60000)).toBeNull();
      expect(await rateLimit(unauthReq, 1, 60000)).toBeNull();
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
