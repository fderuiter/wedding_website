/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';

const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

const mockHeadersMap = new Map<string, string>();
const mockCookieStore = new Map<string, string>();

jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (key: string) => mockHeadersMap.get(key.toLowerCase()) ?? null,
  })),
  cookies: jest.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieStore.get(name);
      return value ? { name, value } : undefined;
    },
  })),
}));

const mockFindFirstAppConfig = jest.fn();
const mockFindUniqueInvitation = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findFirst: (...args: unknown[]) => mockFindFirstAppConfig(...args),
    },
    invitationCode: {
      findUnique: (...args: unknown[]) => mockFindUniqueInvitation(...args),
    },
  },
}));

import { middleware } from '@/middleware';
import {
  GUEST_PHOTO_COOKIE,
  signPhotoQrLinkToken,
  signPhotoUploadSessionToken,
  verifyPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import {
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteToken';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

describe('Middleware QR Token Exchange, Scope Isolation, and Token Rotation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHeadersMap.clear();
    mockCookieStore.clear();
    process.env = {
      ...originalEnv,
      ALLOWED_HOSTS: 'localhost,127.0.0.1,*.localhost',
      GUEST_SESSION_SECRET: 'integration-test-photo-secret-at-least-32-chars',
      GUEST_PASSCODE: 'distinct-integration-passcode',
    };
    mockFindFirstAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 1 });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Middleware QR Exchange (/photos?qr=<signedToken>)', () => {
    it('exchanges a valid signed QR token for an HttpOnly guest_photo_session cookie and 303 redirects to /photos?tab=guest', async () => {
      const qrToken = await signPhotoQrLinkToken({ v: 2 });
      const req = new NextRequest(
        `http://localhost:3000/photos?qr=${encodeURIComponent(qrToken)}`,
        { headers: { host: 'localhost:3000' } }
      );

      const res = await middleware(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('http://localhost:3000/photos?tab=guest');

      const setCookieHeader = res.headers.get('set-cookie') ?? '';
      expect(setCookieHeader).toContain(`${GUEST_PHOTO_COOKIE}=`);
      expect(setCookieHeader).toMatch(/HttpOnly/i);
      expect(setCookieHeader).toMatch(/SameSite=Lax/i);
      expect(setCookieHeader).toContain('Path=/');

      const cookieMatch = setCookieHeader.match(new RegExp(`${GUEST_PHOTO_COOKIE}=([^;]+)`));
      const cookieVal = cookieMatch?.[1];
      const verified = await verifyPhotoUploadSessionToken(cookieVal);
      expect(verified).toEqual(
        expect.objectContaining({
          purpose: 'photo_upload_session',
          v: 2,
        })
      );
    });

    it('rejects invalid or expired QR tokens by 303 redirecting unauthenticated visitors to /guest/login without setting a cookie', async () => {
      const expiredToken = await signPhotoQrLinkToken({ v: 1, iat: 1000, exp: 2000 });

      for (const badToken of ['invalid.token', expiredToken]) {
        const req = new NextRequest(
          `http://localhost:3000/photos?qr=${encodeURIComponent(badToken)}`,
          { headers: { host: 'localhost:3000' } }
        );

        const res = await middleware(req);
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe(
          'http://localhost:3000/guest/login?callbackUrl=%2Fphotos%3Ftab%3Dguest'
        );
        expect(res.headers.get('set-cookie')).toBeNull();
      }
    });

    it('preserves authenticated guest or admin access by stripping an invalid ?qr= parameter cleanly', async () => {
      const guestToken = await signGuestToken({ guest: true, iat: Date.now() });
      const req = new NextRequest('http://localhost:3000/photos?qr=expired-or-tampered', {
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_COOKIE}=${guestToken}`,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('http://localhost:3000/photos?tab=guest');
    });
  });

  describe('Strict Scope Isolation for guest_photo_session', () => {
    it('allows photo-scoped sessions on /photos, /photos/slideshow, GET /api/photos, and POST /api/guest/photos/upload', async () => {
      const photoSession = await signPhotoUploadSessionToken({ v: 1 });
      const cookieHeader = `${GUEST_PHOTO_COOKIE}=${photoSession}`;

      const allowedRequests = [
        new NextRequest('http://localhost:3000/photos?tab=guest', {
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
        new NextRequest('http://localhost:3000/photos/slideshow', {
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
        new NextRequest('http://localhost:3000/api/photos', {
          method: 'GET',
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
        new NextRequest('http://localhost:3000/api/guest/photos/upload', {
          method: 'POST',
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
        new NextRequest('http://localhost:3000/uploads/photos/approved.jpg', {
          method: 'GET',
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
        new NextRequest('http://localhost:3000/api/uploads/photos/approved.jpg', {
          method: 'HEAD',
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        }),
      ];

      for (const req of allowedRequests) {
        const res = await middleware(req);
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
      }
    });

    it('redirects photo-scoped sessions 303 to /guest/login on /, /guest, /registry, and /schedule while allowing /guest?code=INVITE1', async () => {
      const photoSession = await signPhotoUploadSessionToken({ v: 1 });
      const cookieHeader = `${GUEST_PHOTO_COOKIE}=${photoSession}`;

      for (const blockedPath of ['/', '/guest', '/registry', '/schedule', '/travel']) {
        const req = new NextRequest(`http://localhost:3000${blockedPath}`, {
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        });
        const res = await middleware(req);
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toContain('http://localhost:3000/guest/login');
      }

      // Personalized QR portal (/guest?code=...) still works for upgrading to an invite session
      const invitePortalReq = new NextRequest('http://localhost:3000/guest?code=DARCY26', {
        headers: { host: 'localhost:3000', cookie: cookieHeader },
      });
      const portalRes = await middleware(invitePortalReq);
      expect(portalRes.status).toBe(200);
    });

    it('returns HTTP 401 on non-photo APIs (/api/rsvp, /api/guest/lookup, /api/media, /api/admin/*) for photo-scoped sessions', async () => {
      const photoSession = await signPhotoUploadSessionToken({ v: 1 });
      const cookieHeader = `${GUEST_PHOTO_COOKIE}=${photoSession}`;

      const blockedApis: Array<{ path: string; method: string }> = [
        { path: '/api/rsvp', method: 'POST' },
        { path: '/api/rsvp', method: 'GET' },
        { path: '/api/guest/lookup', method: 'GET' },
        { path: '/api/media', method: 'GET' },
        { path: '/api/media/export', method: 'GET' },
        { path: '/api/admin/settings', method: 'GET' },
        { path: '/api/admin/photos/qr', method: 'POST' },
      ];

      for (const { path, method } of blockedApis) {
        const req = new NextRequest(`http://localhost:3000${path}`, {
          method,
          headers: { host: 'localhost:3000', cookie: cookieHeader },
        });
        const res = await middleware(req);
        expect(res.status).toBe(401);
      }

      // Also verify withApiMiddleware defense-in-depth blocks /api/rsvp directly even if middleware were bypassed
      const rsvpHandler = withApiMiddleware(async () => NextResponse.json({ ok: true }));
      const directRsvpReq = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        headers: { host: 'localhost:3000', cookie: cookieHeader },
      });
      const directRsvpRes = await rsvpHandler(directRsvpReq);
      expect(directRsvpRes.status).toBe(401);
    });
  });

  describe('QR Token Rotation Invalidation & Auth Preservation', () => {
    it('invalidates previously issued QR cookies across page and API guards upon token rotation while preserving admin and guest sessions', async () => {
      const v1PhotoSession = await signPhotoUploadSessionToken({ v: 1 });
      // Rotate token version in database from 1 -> 2
      mockFindFirstAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 2 });

      // 1. withApiMiddleware rejects v1 photo session on upload endpoint with 401 and clears cookie
      const uploadHandler = withApiMiddleware(async () =>
        NextResponse.json({ success: true }, { status: 201 })
      );
      const staleUploadReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_PHOTO_COOKIE}=${v1PhotoSession}`,
        },
      });
      const staleUploadRes = await uploadHandler(staleUploadReq);
      expect(staleUploadRes.status).toBe(401);
      expect(staleUploadRes.headers.get('set-cookie') ?? '').toContain(`${GUEST_PHOTO_COOKIE}=;`);

      // 2. Fresh v2 photo session succeeds with 201 on upload endpoint
      const v2PhotoSession = await signPhotoUploadSessionToken({ v: 2 });
      const freshUploadReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_PHOTO_COOKIE}=${v2PhotoSession}`,
        },
      });
      const freshUploadRes = await uploadHandler(freshUploadReq);
      expect(freshUploadRes.status).toBe(201);

      // 3. enforceActiveGuestPageSession redirects stale v1 photo session on /photos to /guest/login
      mockHeadersMap.set('x-guest-callback-url', '/photos');
      mockCookieStore.set(GUEST_PHOTO_COOKIE, v1PhotoSession);
      await expect(enforceActiveGuestPageSession()).rejects.toThrow('NEXT_REDIRECT:/guest/login');

      // 4. Fresh v2 photo session passes enforceActiveGuestPageSession on /photos, but redirects on /registry
      mockCookieStore.set(GUEST_PHOTO_COOKIE, v2PhotoSession);
      await expect(enforceActiveGuestPageSession()).resolves.toBeUndefined();

      mockHeadersMap.set('x-guest-callback-url', '/registry');
      await expect(enforceActiveGuestPageSession()).rejects.toThrow('NEXT_REDIRECT:/guest/login');

      // 5. Admin, passcode guest, and active invite sessions retain full access even when holding a rotated v1 photo cookie
      const adminToken = await signAdminToken({ isAdmin: true, iat: Date.now() });
      const adminUploadReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_COOKIE}=${adminToken}; ${GUEST_PHOTO_COOKIE}=${v1PhotoSession}`,
        },
      });
      expect((await uploadHandler(adminUploadReq)).status).toBe(201);

      const guestToken = await signGuestToken({ guest: true, iat: Date.now() });
      const guestUploadReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_COOKIE}=${guestToken}; ${GUEST_PHOTO_COOKIE}=${v1PhotoSession}`,
        },
      });
      expect((await uploadHandler(guestUploadReq)).status).toBe(201);

      const inviteToken = await signGuestInviteSessionToken({
        code: 'ACTIVE26',
        guestName: 'Jane Bennet',
      });
      mockFindUniqueInvitation.mockResolvedValue({ code: 'ACTIVE26', guestName: 'Jane Bennet' });
      const inviteUploadReq = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_INVITE_COOKIE}=${inviteToken}; ${GUEST_PHOTO_COOKIE}=${v1PhotoSession}`,
        },
      });
      expect((await uploadHandler(inviteUploadReq)).status).toBe(201);
    });
  });
});
