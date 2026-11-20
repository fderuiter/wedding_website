/** @jest-environment node */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signGuestToken, isGuestRequest, GUEST_COOKIE } from '@/core/auth/guest.server';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

// Mock next/server completely for clean isolated Jest execution
jest.mock('next/server', () => {
  class MockNextRequest {
    url: string;
    method: string;
    nextUrl: URL;
    headers: Headers;
    cookies: any;
    bodyStr: string;

    constructor(url: string, init?: any) {
      this.url = url;
      this.nextUrl = new URL(url);
      this.method = init?.method || 'GET';
      this.headers = new Headers(init?.headers);
      this.bodyStr = init?.body || '';
      
      const cookiesMap = new Map();
      if (init?.cookies) {
        Object.entries(init.cookies).forEach(([k, v]) => cookiesMap.set(k, v));
      }
      this.cookies = {
        get: (name: string) => {
          const val = cookiesMap.get(name);
          return val ? { value: val } : undefined;
        },
        set: (name: string, value: string) => {
          cookiesMap.set(name, value);
        },
      };
    }

    async json() {
      return JSON.parse(this.bodyStr);
    }
  }

  const mockNextRedirect = jest.fn().mockImplementation((url, init) => {
    const headers = new Headers();
    headers.set('location', url.toString());
    return {
      status: init?.status || 302,
      headers,
    };
  });

  const mockNextNext = jest.fn().mockImplementation(() => {
    return {
      status: 200,
      headers: new Headers(),
    };
  });

  const mockNextJson = jest.fn().mockImplementation((body, init) => {
    const cookiesMap = new Map();
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    return {
      status: init?.status || 200,
      headers,
      json: async () => body,
      cookies: {
        set: (name: string, value: string, _opts: any) => {
          cookiesMap.set(name, value);
          headers.append('set-cookie', `${name}=${value}`);
        },
        get: (name: string) => cookiesMap.get(name),
      },
    };
  });

  return {
    NextRequest: MockNextRequest,
    NextResponse: {
      next: mockNextNext,
      redirect: mockNextRedirect,
      json: mockNextJson,
    },
  };
});

// Mock the admin auth and routes helpers so middleware functions smoothly
jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/lib/routes', () => ({
  isProtectedRoute: jest.fn().mockReturnValue(false),
  getNavLinks: jest.fn().mockReturnValue([]),
}));

import { isAdminRequest } from '@/core/auth/auth.server';

const mockIsAdminRequest = isAdminRequest as jest.Mock;

function createMockNextRequest(
  url: string,
  init?: RequestInit & { cookies?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, init as unknown as ConstructorParameters<typeof NextRequest>[1]);
}

describe('Edge-enforced Guest Passcode Gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  describe('Guest Auth Utility (guest.server)', () => {
    it('successfully signs and verifies a valid guest token', async () => {
      const iat = Date.now();
      const exp = iat + 1000 * 60 * 60; // 1 hour
      const token = await signGuestToken({ guest: true, iat, exp });
      expect(token).toBeDefined();

      const verified = await isGuestRequest({
        cookies: {
          get: () => ({ value: token }),
        },
        headers: new Headers(),
      } as any);
      expect(verified).toBe(true);
    });

    it('returns false for tampered/invalid tokens', async () => {
      const iat = Date.now();
      const exp = iat + 1000 * 60 * 60;
      const token = await signGuestToken({ guest: true, iat, exp });
      const tampered = token + 'tamper';

      const verified = await isGuestRequest({
        cookies: {
          get: () => ({ value: tampered }),
        },
        headers: new Headers(),
      } as any);
      expect(verified).toBe(false);
    });

    it('returns false for expired tokens', async () => {
      const iat = Date.now() - 1000 * 60 * 60 * 2; // 2 hours ago
      const exp = iat + 1000 * 60 * 60; // expired 1 hour ago
      const token = await signGuestToken({ guest: true, iat, exp });

      const verified = await isGuestRequest({
        cookies: {
          get: () => ({ value: token }),
        },
        headers: new Headers(),
      } as any);

      expect(verified).toBe(false);
    });

    it('rejects tokens signed with the shared guest passcode', async () => {
      const payload = {
        guest: true,
        iat: Date.now(),
        exp: Date.now() + 1000 * 60 * 60,
      };
      const data = base64urlEncode(JSON.stringify(payload));
      const forgedSignature = await hmacSha256(env.GUEST_PASSCODE, data);
      const forgedToken = `${data}.${forgedSignature}`;

      const verified = await isGuestRequest({
        cookies: {
          get: () => ({ value: forgedToken }),
        },
        headers: new Headers(),
      } as any);

      expect(verified).toBe(false);
    });

    it('throws an error if GUEST_SESSION_SECRET is configured to match GUEST_PASSCODE', async () => {
      const originalSecret = process.env.GUEST_SESSION_SECRET;
      try {
        process.env.GUEST_SESSION_SECRET = env.GUEST_PASSCODE;
        await expect(
          signGuestToken({
            guest: true,
          })
        ).rejects.toThrow('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
      } finally {
        if (originalSecret !== undefined) {
          process.env.GUEST_SESSION_SECRET = originalSecret;
        } else {
          delete process.env.GUEST_SESSION_SECRET;
        }
      }
    });

    describe('production environment secret enforcement', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.GUEST_SESSION_SECRET;
      const originalPasscode = process.env.GUEST_PASSCODE;

      beforeEach(() => {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.GUEST_PASSCODE = 'unique-prod-guest-passcode-2026';
      });

      afterEach(() => {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
        if (originalSecret !== undefined) {
          process.env.GUEST_SESSION_SECRET = originalSecret;
        } else {
          delete process.env.GUEST_SESSION_SECRET;
        }
        if (originalPasscode !== undefined) {
          process.env.GUEST_PASSCODE = originalPasscode;
        } else {
          delete process.env.GUEST_PASSCODE;
        }
      });

      it('throws in production when GUEST_SESSION_SECRET is unset or empty', async () => {
        delete process.env.GUEST_SESSION_SECRET;
        await expect(signGuestToken({ guest: true })).rejects.toThrow(
          'GUEST_SESSION_SECRET must be configured with a distinct secret in production'
        );

        process.env.GUEST_SESSION_SECRET = '';
        await expect(signGuestToken({ guest: true })).rejects.toThrow(
          'GUEST_SESSION_SECRET must be configured with a distinct secret in production'
        );
      });

      it('throws in production when GUEST_SESSION_SECRET is default-guest-session-secret', async () => {
        process.env.GUEST_SESSION_SECRET = 'default-guest-session-secret';
        await expect(signGuestToken({ guest: true })).rejects.toThrow(
          'GUEST_SESSION_SECRET must be configured with a distinct secret in production'
        );
      });

      it('throws in production when GUEST_SESSION_SECRET has fewer than 32 characters', async () => {
        process.env.GUEST_SESSION_SECRET = 'short-secret-under-32-chars';
        await expect(signGuestToken({ guest: true })).rejects.toThrow(
          'GUEST_SESSION_SECRET must be at least 32 characters long in production'
        );
      });

      it('throws in production when GUEST_SESSION_SECRET matches GUEST_PASSCODE', async () => {
        const sharedValue = 'shared-passcode-and-secret-at-least-32-chars';
        process.env.GUEST_PASSCODE = sharedValue;
        process.env.GUEST_SESSION_SECRET = sharedValue;
        await expect(signGuestToken({ guest: true })).rejects.toThrow(
          'GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE'
        );
      });

      it('rejects tokens forged with default-guest-session-secret when GUEST_SESSION_SECRET is unset in production', async () => {
        delete process.env.GUEST_SESSION_SECRET;
        const payload = { guest: true, iat: Date.now(), exp: Date.now() + 60_000 };
        const data = base64urlEncode(JSON.stringify(payload));
        const forgedSig = await hmacSha256('default-guest-session-secret', data);
        const forgedToken = `${data}.${forgedSig}`;

        const verified = await isGuestRequest({
          cookies: { get: () => ({ value: forgedToken }) },
          headers: new Headers(),
        } as any);
        expect(verified).toBe(false);
      });

      it('succeeds in production when GUEST_SESSION_SECRET is at least 32 characters and distinct', async () => {
        process.env.GUEST_SESSION_SECRET = 'a-valid-production-guest-secret-with-32-plus-chars';
        const token = await signGuestToken({
          guest: true,
          iat: Date.now(),
          exp: Date.now() + 60_000,
        });
        const verified = await isGuestRequest({
          cookies: { get: () => ({ value: token }) },
          headers: new Headers(),
        } as any);
        expect(verified).toBe(true);
      });
    });
  });

  describe('Guest Login API Route (POST /api/guest/login)', () => {
    it('returns 400 if passcode is missing', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Passcode is required');
    });

    it('returns 401 for incorrect passcode', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'wrong_code' }),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Incorrect passcode');
      expect(data.helpPrompt).toBeDefined();
    });

    it('returns 200 and sets cookie for correct passcode', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: env.GUEST_PASSCODE }),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const cookieHeader = res.headers.get('set-cookie');
      expect(cookieHeader).toContain(GUEST_COOKIE);
    });

    it('returns 200 and sets guest_invite_session cookie for a valid personal invitation code (case-insensitive)', async () => {
      const prismaWithInvite = prisma as unknown as {
        invitationCode?: { findFirst: jest.Mock };
      };
      const originalInvitationCode = prismaWithInvite.invitationCode;
      const findFirstMock = jest.fn().mockResolvedValue({
        id: 'inv-123',
        code: 'LOVE2026',
        guestName: 'Jordan Lee',
      });
      prismaWithInvite.invitationCode = { findFirst: findFirstMock };

      try {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: '  love2026  ' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.sessionType).toBe('invitation');
        expect(data.guestName).toBe('Jordan Lee');

        expect(findFirstMock).toHaveBeenCalledWith({
          where: {
            code: { equals: 'love2026', mode: 'insensitive' },
            isSample: false,
          },
        });

        const cookieHeader = res.headers.get('set-cookie');
        expect(cookieHeader).toContain(GUEST_INVITE_COOKIE);
        expect(cookieHeader).not.toContain(`${GUEST_COOKIE}=`);
      } finally {
        prismaWithInvite.invitationCode = originalInvitationCode;
      }
    });

    it('returns 401 and sets no session cookie for a sample invitation code', async () => {
      const prismaWithInvite = prisma as unknown as {
        invitationCode?: { findFirst: jest.Mock };
      };
      const originalInvitationCode = prismaWithInvite.invitationCode;
      const findFirstMock = jest.fn().mockResolvedValue(null);
      prismaWithInvite.invitationCode = { findFirst: findFirstMock };

      try {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: 'SMITH2026' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.success).toBe(false);

        expect(findFirstMock).toHaveBeenCalledWith({
          where: {
            code: { equals: 'SMITH2026', mode: 'insensitive' },
            isSample: false,
          },
        });

        const cookieHeader = res.headers.get('set-cookie') || '';
        expect(cookieHeader).not.toContain(GUEST_INVITE_COOKIE);
        expect(cookieHeader).not.toContain(GUEST_COOKIE);
      } finally {
        prismaWithInvite.invitationCode = originalInvitationCode;
      }
    });

    describe('production GUEST_PASSCODE enforcement', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalPasscode = process.env.GUEST_PASSCODE;
      const originalSecret = process.env.GUEST_SESSION_SECRET;

      beforeEach(() => {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.GUEST_SESSION_SECRET = 'a-valid-production-guest-secret-with-32-plus-chars';
      });

      afterEach(() => {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
        if (originalPasscode !== undefined) {
          process.env.GUEST_PASSCODE = originalPasscode;
        } else {
          delete process.env.GUEST_PASSCODE;
        }
        if (originalSecret !== undefined) {
          process.env.GUEST_SESSION_SECRET = originalSecret;
        } else {
          delete process.env.GUEST_SESSION_SECRET;
        }
      });

      it('rejects login requests in production when GUEST_PASSCODE is unset', async () => {
        delete process.env.GUEST_PASSCODE;
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: 'wedding2026' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(503);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(res.headers.get('set-cookie')).toBeNull();
      });

      it('rejects login requests in production when GUEST_PASSCODE is empty or whitespace', async () => {
        process.env.GUEST_PASSCODE = '   ';
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: 'wedding2026' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(503);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(res.headers.get('set-cookie')).toBeNull();
      });

      it('rejects login requests in production when GUEST_PASSCODE is wedding2026', async () => {
        process.env.GUEST_PASSCODE = 'wedding2026';
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: 'wedding2026' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(503);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(res.headers.get('set-cookie')).toBeNull();
      });

      it('allows login in production when GUEST_PASSCODE is a unique non-default value', async () => {
        process.env.GUEST_PASSCODE = 'unique-prod-passcode-2026';
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          body: JSON.stringify({ passcode: 'unique-prod-passcode-2026' }),
        });
        const res = await guestLoginPost(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(res.headers.get('set-cookie')).toContain(GUEST_COOKIE);
      });
    });
  });

  describe('Middleware Access Controls', () => {
    it('bypasses guest passcode check for excluded path /guest/login', async () => {
      const req = new NextRequest('http://localhost/guest/login');
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('rejects unauthenticated requests to self-service lookup API /api/guest/lookup with 401', async () => {
      const req = new NextRequest('http://localhost/api/guest/lookup', { method: 'POST' });
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('allows access to /api/guest/lookup for authenticated guest session', async () => {
      const token = await signGuestToken({ guest: true, exp: Date.now() + 1000 * 60 * 60 });
      const req = createMockNextRequest('http://localhost/api/guest/lookup', {
        method: 'POST',
        cookies: {
          [GUEST_COOKIE]: token,
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('bypasses check for robots.txt', async () => {
      const req = new NextRequest('http://localhost/robots.txt');
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('redirects unauthenticated page request from / to /guest/login with 303', async () => {
      const req = new NextRequest('http://localhost/');
      const res = await middleware(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toContain('/guest/login');
      expect(res.headers.get('location')).toContain('callbackUrl=%2F');
    });

    it('preserves code parameter across /guest/login redirects and strips code from callbackUrl', async () => {
      const req = new NextRequest('http://localhost/schedule?tab=dinner&code=LOVE2026');
      const res = await middleware(req);
      expect(res.status).toBe(303);
      const location = res.headers.get('location')!;
      const redirectUrl = new URL(location);
      expect(redirectUrl.pathname).toBe('/guest/login');
      expect(redirectUrl.searchParams.get('code')).toBe('LOVE2026');
      expect(redirectUrl.searchParams.get('callbackUrl')).toBe('/schedule?tab=dinner');
    });

    it('returns immediate 401 for unauthenticated API requests instead of redirect', async () => {
      const req = new NextRequest('http://localhost/api/weather');
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('allows access for authenticated guest session', async () => {
      const token = await signGuestToken({ guest: true, exp: Date.now() + 1000 * 60 * 60 });
      const req = createMockNextRequest('http://localhost/', {
        cookies: {
          [GUEST_COOKIE]: token,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows access for authenticated personal invitation session (guest_invite_session)', async () => {
      const inviteToken = await signGuestInviteSessionToken({
        code: 'LOVE2026',
        guestName: 'Jordan Lee',
        iat: Date.now(),
        exp: Date.now() + 1000 * 60 * 60,
      });
      const req = createMockNextRequest('http://localhost/', {
        cookies: {
          [GUEST_INVITE_COOKIE]: inviteToken,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('rejects forged token signed with passcode in middleware and redirects to /guest/login', async () => {
      const payload = { guest: true, exp: Date.now() + 1000 * 60 * 60 };
      const data = base64urlEncode(JSON.stringify(payload));
      const forgedSignature = await hmacSha256(env.GUEST_PASSCODE, data);
      const forgedToken = `${data}.${forgedSignature}`;

      const req = createMockNextRequest('http://localhost/', {
        cookies: {
          [GUEST_COOKIE]: forgedToken,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toContain('/guest/login');
    });

    it('allows access for authenticated admin session even without guest session', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const req = new NextRequest('http://localhost/');
      
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });
  });
});
