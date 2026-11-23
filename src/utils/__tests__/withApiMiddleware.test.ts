import { withApiMiddleware } from '../withApiMiddleware';
import { ApiError } from '../ApiError';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { resetRateLimitsForTesting } from '../rateLimit';
import { GUEST_INVITE_COOKIE, getGuestInviteSession, signGuestInviteSessionToken } from '@/core/auth/guestInviteSession';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';

describe('withApiMiddleware - Targeted Catch-Block Logging', () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  test('withApiMiddleware exports a function', () => {
    expect(typeof withApiMiddleware).toBe('function');
  });

  test('logs error alongside route and apiVersion v2 even when legacy version header is sent', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Database crash');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/registry/items');
    req.headers.get = jest.fn((key: string) => {
      if (key === 'x-api-version') return 'v1';
      return null;
    });

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Database crash',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v2',
        route: '/api/registry/items',
      }
    );
  });

  test('defaults API version to v2 when version metadata is absent', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Network failure');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/attractions');

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Network failure',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v2',
        route: '/api/attractions',
      }
    );
  });

  test('request failures due to missing or malformed headers do not crash the error-logging block', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Fatal service error');
    });

    const middleware = withApiMiddleware(handler);

    // Mock a request that throws on headers.get
    const req = {
      url: 'http://localhost/api/malformed',
      headers: {
        get: () => {
          throw new Error('Malformed header stream');
        },
      },
    } as unknown as NextRequest;

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Malformed header stream',
    });

    // Logging should still have occurred successfully without crashing
    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v2',
        route: '/api/malformed',
      }
    );
  });

  describe('Production Environment Sanitization & Request Tracing', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    });

    afterEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    });

    test('masks uncaught exceptions in production and attaches referenceId in payload and logs', async () => {
      const internalError = new Error('Database password leak: secret123 at postgres://user:pass@host/db');
      const handler = jest.fn().mockImplementation(() => {
        throw internalError;
      });

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/registry/items');

      const res = await middleware(req, {});
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('An unexpected error occurred. Please try again later.');
      expect(typeof body.referenceId).toBe('string');
      expect(body.referenceId.length).toBeGreaterThan(0);
      expect(body.error).not.toContain('Database password leak');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled API Error:',
        internalError,
        {
          apiVersion: 'v2',
          route: '/api/registry/items',
          referenceId: body.referenceId,
        }
      );
    });

    test('sanitizes 500 response returned from route handler in production', async () => {
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal query failure details' }), { status: 500, headers: { 'content-type': 'application/json' } })
      );

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/weather');

      const res = await middleware(req, {});
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('An unexpected error occurred. Please try again later.');
      expect(typeof body.referenceId).toBe('string');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled API Error:',
        'Internal query failure details',
        {
          apiVersion: 'v2',
          route: '/api/weather',
          referenceId: body.referenceId,
        }
      );
    });

    test('preserves 4xx operational errors (ApiError) without masking or adding referenceId in production', async () => {
      const handler = jest.fn().mockImplementation(() => {
        throw new ApiError(400, 'Invalid payload: email is required', { field: 'email' });
      });

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/registry/items');

      const res = await middleware(req, {});
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'Invalid payload: email is required',
        details: { field: 'email' },
      });
      expect(body.referenceId).toBeUndefined();
      expect(loggerSpy).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limiting & Route Throttling', () => {
    beforeEach(() => {
      resetRateLimitsForTesting();
    });

    test('subjects /api/admin/me to standard rate limit (100 req/min) instead of strict login limit (5 req/15min)', async () => {
      const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost/api/admin/me', {
          headers: { 'x-forwarded-for': '192.168.1.100' },
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }
      expect(handler).toHaveBeenCalledTimes(10);
    });

    test('subjects /api/admin/logout to standard rate limit (100 req/min) instead of strict login limit', async () => {
      const handler = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost/api/admin/logout', {
          headers: { 'x-forwarded-for': '192.168.1.101' },
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }
      expect(handler).toHaveBeenCalledTimes(10);
    });

    test('permits 10 consecutive valid logins (200) on /api/admin/login while returning 429 on the 6th failed attempt (401)', async () => {
      const validHandler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const validMiddleware = withApiMiddleware(validHandler);

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '192.168.1.102' },
        });
        const res = await validMiddleware(req, {});
        expect(res.status).toBe(200);
      }
      expect(validHandler).toHaveBeenCalledTimes(10);

      const failedHandler = jest.fn().mockRejectedValue(new ApiError(401, 'Invalid password.'));
      const failedMiddleware = withApiMiddleware(failedHandler);

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '192.168.1.102' },
        });
        const res = await failedMiddleware(req, {});
        expect(res.status).toBe(401);
      }

      const req6 = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.102' },
      });
      const res6 = await failedMiddleware(req6, {});
      expect(res6.status).toBe(429);
      const body = await res6.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Too many requests');
      expect(failedHandler).toHaveBeenCalledTimes(5);
    });

    test('permits 10 consecutive valid logins (200) on /api/guest/login while returning 429 on the 6th failed attempt (401)', async () => {
      let shouldFail = false;
      const handler = jest.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify(shouldFail ? { success: false, error: 'Incorrect passcode' } : { success: true }),
          {
            status: shouldFail ? 401 : 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      );
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '192.168.1.103' },
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }

      shouldFail = true;
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '192.168.1.103' },
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(401);
      }

      const req6 = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.103' },
      });
      const res6 = await middleware(req6, {});
      expect(res6.status).toBe(429);
      expect(handler).toHaveBeenCalledTimes(15);
    });

    test('enforces strict 5 failed-attempt limit (403) on POST /api/admin/setup while keeping GET /api/admin/setup under general quota', async () => {
      const handler = jest.fn().mockImplementation(async (req: NextRequest) => {
        if (req.method === 'POST') {
          return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ success: true, initialized: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const middleware = withApiMiddleware(handler);

      // 15 GET requests do not consume POST credential budget or trigger 5-attempt lockout
      for (let i = 0; i < 15; i++) {
        const getReq = new NextRequest('http://localhost/api/admin/setup', { method: 'GET' });
        const getRes = await middleware(getReq, {});
        expect(getRes.status).toBe(200);
      }

      // 5 failed POST attempts return 403, 6th POST attempt returns 429
      for (let i = 0; i < 5; i++) {
        const postReq = new NextRequest('http://localhost/api/admin/setup', { method: 'POST' });
        const postRes = await middleware(postReq, {});
        expect(postRes.status).toBe(403);
      }

      const postReq6 = new NextRequest('http://localhost/api/admin/setup', { method: 'POST' });
      const postRes6 = await middleware(postReq6, {});
      expect(postRes6.status).toBe(429);

      // Subsequent GET status check still succeeds under general quota
      const statusReqAfterLockout = new NextRequest('http://localhost/api/admin/setup', { method: 'GET' });
      const statusResAfterLockout = await middleware(statusReqAfterLockout, {});
      expect(statusResAfterLockout.status).toBe(200);
    });

    test('enforces strict 5 request limit on GET /api/registry/validate-code', async () => {
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid invitation code.' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      );
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest(`http://localhost/api/registry/validate-code?code=CODE000${i}`);
        const res = await middleware(req, {});
        expect(res.status).toBe(404);
      }

      const req6 = new NextRequest('http://localhost/api/registry/validate-code?code=CODE0006');
      const res6 = await middleware(req6, {});
      expect(res6.status).toBe(429);
    });

    test('exempts /api/health from rate limiting across more than 100 consecutive requests', async () => {
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', database: 'connected' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 110; i++) {
        const req = new NextRequest('http://localhost/api/health', {
          headers: { 'x-forwarded-for': '192.168.1.104' },
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }
      expect(handler).toHaveBeenCalledTimes(110);
    });

    test('falls back safely to root path evaluation when request lacks standard URL properties', async () => {
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'root' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const middleware = withApiMiddleware(handler);

      const reqWithoutUrl = {
        headers: new Headers({ 'x-forwarded-for': '192.168.1.105' }),
      } as any;
      const res = await middleware(reqWithoutUrl, {});
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Active Guest Invitation Session Enforcement', () => {
    const prismaWithInvite = prisma as unknown as {
      invitationCode?: {
        findUnique?: jest.Mock;
      };
    };
    let originalInvitationCode: typeof prismaWithInvite.invitationCode;
    let mockFindUnique: jest.Mock;

    beforeEach(() => {
      resetRateLimitsForTesting();
      originalInvitationCode = prismaWithInvite.invitationCode;
      mockFindUnique = jest.fn();
      prismaWithInvite.invitationCode = {
        findUnique: mockFindUnique,
      };
    });

    afterEach(() => {
      prismaWithInvite.invitationCode = originalInvitationCode;
    });

    test('returns 401 and expires cookie when guest_invite_session has no active InvitationCode and fallback cookies are absent', async () => {
      mockFindUnique.mockResolvedValue(null);
      const handler = jest.fn();
      const middleware = withApiMiddleware(handler);

      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKED1',
        guestName: 'Former Guest',
      });
      const req = new NextRequest('http://localhost/api/photos', {
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}`,
        },
      });

      const res = await middleware(req, {});
      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();

      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'Unauthorized',
      });

      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain(`${GUEST_INVITE_COOKIE}=`);
      expect(setCookie).toContain('Max-Age=0');
    });

    test('returns 401 when guest_invite_session resolves to a sample InvitationCode', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'sample-1',
        code: 'SMITH2026',
        guestName: 'Sample Guest',
        isSample: true,
      });
      const handler = jest.fn();
      const middleware = withApiMiddleware(handler);

      const sampleToken = await signGuestInviteSessionToken({
        code: 'SMITH2026',
        guestName: 'Sample Guest',
      });
      const req = new NextRequest('http://localhost/api/registry/items', {
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${sampleToken}`,
        },
      });

      const res = await middleware(req, {});
      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    test('allows request to proceed when caller also holds valid guest_auth or admin_auth cookie', async () => {
      mockFindUnique.mockResolvedValue(null);
      const handler = jest.fn().mockImplementation(() =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const middleware = withApiMiddleware(handler);

      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKED1',
        guestName: 'Former Guest',
      });
      const guestToken = await signGuestToken({
        guest: true,
        exp: Date.now() + 60_000,
      });
      const adminToken = await signAdminToken({
        isAdmin: true,
        iat: Date.now(),
      });

      const guestReq = new NextRequest('http://localhost/api/photos', {
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}; ${GUEST_COOKIE}=${guestToken}`,
        },
      });
      const guestRes = await middleware(guestReq, {});
      expect(guestRes.status).toBe(200);

      const adminReq = new NextRequest('http://localhost/api/photos', {
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}; ${ADMIN_COOKIE}=${adminToken}`,
        },
      });
      const adminRes = await middleware(adminReq, {});
      expect(adminRes.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    test('exempts /api/registry/session from 401 middleware block so session route can return isVerified: false', async () => {
      mockFindUnique.mockResolvedValue(null);
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ isVerified: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const middleware = withApiMiddleware(handler);

      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKED1',
        guestName: 'Former Guest',
      });
      const req = new NextRequest('http://localhost/api/registry/session', {
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${revokedToken}`,
        },
      });

      const res = await middleware(req, {});
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('reuses verified guest_invite_session across middleware and downstream handler without repeating database lookup', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'active-inv-1',
        code: 'REUSE2026',
        guestName: 'Reusable Session Guest',
        isSample: false,
      });

      const handler = jest.fn(async (incomingReq: NextRequest) => {
        const session = await getGuestInviteSession(incomingReq);
        return new Response(JSON.stringify({ code: session?.code }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const middleware = withApiMiddleware(handler);
      const validToken = await signGuestInviteSessionToken({
        code: 'REUSE2026',
        guestName: 'Reusable Session Guest',
      });
      const req = new NextRequest('http://localhost/api/registry/contribute', {
        method: 'POST',
        headers: {
          cookie: `${GUEST_INVITE_COOKIE}=${validToken}`,
        },
      });

      const res = await middleware(req, {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.code).toBe('REUSE2026');
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
    });
  });
});
