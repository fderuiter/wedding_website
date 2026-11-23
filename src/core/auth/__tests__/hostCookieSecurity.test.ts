/** @jest-environment node */

import { NextRequest } from 'next/server';
import {
  ADMIN_COOKIE,
  isAdminRequest,
  setAdminAuthCookie,
  signAdminToken,
} from '@/core/auth/auth.server';
import {
  GUEST_COOKIE,
  isGuestRequest,
  signGuestToken,
} from '@/core/auth/guest.server';
import {
  GUEST_INVITE_COOKIE,
  clearGuestInviteSessionCookie,
  getSignedGuestInviteSession,
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteToken';
import {
  GUEST_PHOTO_COOKIE,
  getSignedPhotoUploadSession,
  signPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import {
  clearSessionCookie,
  getSessionCookieOptions,
  readRequestCookieCandidates,
  resolveSessionCookieName,
} from '@/core/auth/tokenCookieHelpers';
import { rateLimit, resetRateLimitsForTesting } from '@/utils/rateLimit';

const ActualNextServer = jest.requireActual('next/server') as {
  NextResponse: typeof import('next/server').NextResponse;
};

describe('__Host- session cookie security and multi-cookie HMAC verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TRUST_PROXY: '1',
      GUEST_SESSION_SECRET: 'prod-guest-secret-at-least-32-characters-long',
      GUEST_PASSCODE: 'correct-horse-battery-staple',
      ALLOWED_HOSTS: 'wedding.example,localhost,localhost:3000,127.0.0.1:3000',
    };
    resetRateLimitsForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('cookie naming and attributes across HTTPS production vs plain HTTP local', () => {
    it('uses __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/, and omits Domain on HTTPS in production', async () => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true,
        writable: true,
      });

      const httpsReq = new NextRequest('https://wedding.example/api/guest/login', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
        },
      });

      expect(resolveSessionCookieName(ADMIN_COOKIE, httpsReq)).toBe('__Host-admin_auth');
      expect(resolveSessionCookieName(GUEST_COOKIE, httpsReq)).toBe('__Host-guest_auth');
      expect(resolveSessionCookieName(GUEST_INVITE_COOKIE, httpsReq)).toBe(
        '__Host-guest_invite_session'
      );
      expect(resolveSessionCookieName(GUEST_PHOTO_COOKIE, httpsReq)).toBe(
        '__Host-guest_photo_session'
      );

      const opts = getSessionCookieOptions(3600, httpsReq);
      expect(opts).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 3600,
      });
      expect('domain' in opts).toBe(false);

      // Verify real NextResponse Set-Cookie wire serialization satisfies RFC 6265bis __Host- rules
      const inviteToken = await signGuestInviteSessionToken({
        code: 'FAM2026',
        guestName: 'Jordan Smith',
      });
      const realRes = ActualNextServer.NextResponse.json({ ok: true });
      setGuestInviteSessionCookie(realRes, inviteToken, httpsReq);

      const rawSetCookie = realRes.headers.get('set-cookie') || '';
      expect(rawSetCookie).toContain('__Host-guest_invite_session=');
      expect(rawSetCookie).toMatch(/;\s*Path=\/(?:;|$)/i);
      expect(rawSetCookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
      expect(rawSetCookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(rawSetCookie).toMatch(/;\s*SameSite=lax/i);
      expect(rawSetCookie).not.toMatch(/Domain=/i);

      const adminToken = await signAdminToken({ isAdmin: true });
      const adminRes = ActualNextServer.NextResponse.json({ ok: true });
      setAdminAuthCookie(adminRes, adminToken, undefined, httpsReq);
      const adminRawCookie = adminRes.headers.get('set-cookie') || '';
      expect(adminRawCookie).toContain('__Host-admin_auth=');
      expect(adminRawCookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(adminRawCookie).not.toMatch(/Domain=/i);
    });

    it('keeps unprefixed cookie names without Secure on plain HTTP localhost even when NODE_ENV=production', async () => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true,
        writable: true,
      });

      const localHttpReq = new NextRequest('http://127.0.0.1:3000/api/guest/login', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
        },
      });

      expect(resolveSessionCookieName(ADMIN_COOKIE, localHttpReq)).toBe('admin_auth');
      expect(resolveSessionCookieName(GUEST_COOKIE, localHttpReq)).toBe('guest_auth');
      expect(resolveSessionCookieName(GUEST_INVITE_COOKIE, localHttpReq)).toBe(
        'guest_invite_session'
      );

      const opts = getSessionCookieOptions(3600, localHttpReq);
      expect(opts.secure).toBe(false);
      expect(opts.path).toBe('/');
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');

      const inviteToken = await signGuestInviteSessionToken({
        code: 'LOCAL1',
        guestName: 'Local Tester',
      });
      const realRes = ActualNextServer.NextResponse.json({ ok: true });
      setGuestInviteSessionCookie(realRes, inviteToken, localHttpReq);
      const rawSetCookie = realRes.headers.get('set-cookie') || '';
      expect(rawSetCookie).toContain('guest_invite_session=');
      expect(rawSetCookie).not.toContain('__Host-guest_invite_session=');
      expect(rawSetCookie).not.toMatch(/;\s*Secure(?:;|$)/i);
    });

    it('clears both __Host- and stale unprefixed cookies when logging out over HTTPS in production', () => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true,
        writable: true,
      });

      const httpsReq = new NextRequest('https://wedding.example/api/registry/session', {
        method: 'DELETE',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          cookie: 'guest_invite_session=legacy-token; __Host-guest_invite_session=current-token',
        },
      });

      const realRes = ActualNextServer.NextResponse.json({ ok: true });
      clearGuestInviteSessionCookie(realRes, httpsReq);

      const setCookies =
        typeof realRes.headers.getSetCookie === 'function'
          ? realRes.headers.getSetCookie()
          : [realRes.headers.get('set-cookie') || ''];
      const joined = setCookies.join('\n');
      expect(joined).toContain('__Host-guest_invite_session=;');
      expect(joined).toContain('guest_invite_session=;');

      const adminRes = ActualNextServer.NextResponse.json({ ok: true });
      const adminReq = new NextRequest('https://wedding.example/api/admin/logout', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          cookie: 'admin_auth=legacy-admin',
        },
      });
      clearSessionCookie(adminRes, ADMIN_COOKIE, adminReq);
      const adminCookies =
        typeof adminRes.headers.getSetCookie === 'function'
          ? adminRes.headers.getSetCookie().join('\n')
          : adminRes.headers.get('set-cookie') || '';
      expect(adminCookies).toContain('__Host-admin_auth=;');
      expect(adminCookies).toContain('admin_auth=;');
    });
  });

  describe('multi-cookie candidate ordering and HMAC fallback against cookie shadowing', () => {
    beforeEach(() => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'production',
        configurable: true,
        writable: true,
      });
    });

    it('orders all __Host- candidates ahead of unprefixed candidates and preserves duplicate header entries', async () => {
      const req = new NextRequest('https://wedding.example/api/admin/me', {
        headers: {
          host: 'wedding.example',
          cookie:
            'admin_auth=shadowed-domain-cookie; __Host-admin_auth=host-first; __Host-admin_auth=host-second; admin_auth=valid-fallback',
        },
      });

      const candidates = await readRequestCookieCandidates(ADMIN_COOKIE, req);
      expect(candidates).toHaveLength(4);
      expect(candidates.slice(0, 2).sort()).toEqual(['host-first', 'host-second']);
      expect(candidates.slice(2).sort()).toEqual(['shadowed-domain-cookie', 'valid-fallback']);
    });

    it('authenticates admin, guest, and invite sessions even when preceded by forged or stale shadowed cookies', async () => {
      const validAdminToken = await signAdminToken({ isAdmin: true });
      const validGuestToken = await signGuestToken({ guest: true });
      const validInviteToken = await signGuestInviteSessionToken({
        code: 'WED2026',
        guestName: 'Alex Rivera',
      });
      const olderValidInviteToken = await signGuestInviteSessionToken({
        code: 'OLD2025',
        guestName: 'Stale Household',
      });

      // 1. Sibling subdomain plants forged unprefixed cookie ahead of legitimate __Host- cookie
      const shadowedAdminReq = new NextRequest('https://wedding.example/api/admin/me', {
        headers: {
          host: 'wedding.example',
          cookie: `admin_auth=forged.signature; __Host-admin_auth=${validAdminToken}`,
        },
      });
      expect(await isAdminRequest(shadowedAdminReq)).toBe(true);

      // 2. Duplicate same-name cookies where first entry is forged/expired and second entry is valid
      const duplicateGuestReq = new NextRequest('https://wedding.example/api/rsvp', {
        headers: {
          host: 'wedding.example',
          cookie: `__Host-guest_auth=forged.token; guest_auth=also.bad; __Host-guest_auth=${validGuestToken}`,
        },
      });
      expect(await isGuestRequest(duplicateGuestReq)).toBe(true);

      // 3. Both __Host- and unprefixed invite cookies are valid: prefers __Host- over unprefixed
      const dualValidInviteReq = new NextRequest('https://wedding.example/api/registry/session', {
        headers: {
          host: 'wedding.example',
          cookie: `guest_invite_session=${olderValidInviteToken}; __Host-guest_invite_session=${validInviteToken}`,
        },
      });
      const preferredInvite = await getSignedGuestInviteSession(dualValidInviteReq);
      expect(preferredInvite).toMatchObject({
        code: 'WED2026',
        guestName: 'Alex Rivera',
      });

      // 4. Forged __Host- invite cookie falls back to valid unprefixed cookie
      const fallbackInviteReq = new NextRequest('https://wedding.example/api/registry/session', {
        headers: {
          host: 'wedding.example',
          cookie: `__Host-guest_invite_session=bad.sig; guest_invite_session=${olderValidInviteToken}`,
        },
      });
      const fallbackInvite = await getSignedGuestInviteSession(fallbackInviteReq);
      expect(fallbackInvite).toMatchObject({
        code: 'OLD2025',
        guestName: 'Stale Household',
      });

      // 5. Shadowed QR photo session cookie falls through to valid __Host-guest_photo_session
      const validPhotoToken = await signPhotoUploadSessionToken({ v: 2 });
      const shadowedPhotoReq = new NextRequest('https://wedding.example/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          cookie: `guest_photo_session=forged.photo; __Host-guest_photo_session=${validPhotoToken}`,
        },
      });
      const verifiedPhoto = await getSignedPhotoUploadSession(shadowedPhotoReq);
      expect(verifiedPhoto).toMatchObject({
        purpose: 'photo_upload_session',
        v: 2,
      });
    });

    it('keys rate limits by verified session token even when a forged shadowed cookie appears first', async () => {
      const guestTokenA = await signGuestToken({ guest: true });

      // Exhaust the shared NAT IP (203.0.113.50) rate-limit bucket
      for (let i = 0; i < 2; i++) {
        const ipReq = new NextRequest('https://wedding.example/api/rsvp', {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-real-ip': '203.0.113.50',
          },
        });
        const res = await rateLimit(ipReq, 2, 60_000);
        expect(res).toBeNull();
      }

      const exhaustedIpReq = new NextRequest('https://wedding.example/api/rsvp', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-real-ip': '203.0.113.50',
        },
      });
      expect((await rateLimit(exhaustedIpReq, 2, 60_000))?.status).toBe(429);

      // Guest A on the same NAT IP with shadowed cookie still gets their independent session bucket
      const shadowedSessionReq = new NextRequest('https://wedding.example/api/rsvp', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-real-ip': '203.0.113.50',
          cookie: `guest_auth=forged.shadow; __Host-guest_auth=${guestTokenA}`,
        },
      });
      const sessionRateResult = await rateLimit(shadowedSessionReq, 2, 60_000);
      expect(sessionRateResult).toBeNull();
    });
  });
});
