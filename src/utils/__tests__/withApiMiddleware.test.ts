import { withApiMiddleware } from '../withApiMiddleware';
import { ApiError } from '../ApiError';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { resetRateLimitsForTesting } from '../rateLimit';
import { GUEST_INVITE_COOKIE, signGuestInviteSessionToken } from '@/core/auth/guestInviteSession';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';
import { createVerifiedSocketIpHeaders } from '@/lib/socket-ip-boundary.js';

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

    test('allows 6+ valid logins on /api/admin/login while enforcing strict 5 failed-attempt lockout and isolating socket IPs', async () => {
      let shouldFail = false;
      const handler = jest.fn().mockImplementation(() => {
        if (shouldFail) {
          throw new ApiError(401, 'Invalid password');
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const middleware = withApiMiddleware(handler);

      // Six valid logins from 127.0.0.2 all return 200 without consuming the 5-attempt lockout
      for (let i = 0; i < 6; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2'),
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }

      // Five failed attempts from 127.0.0.2 trigger lockout on the 6th attempt
      shouldFail = true;
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2', {
            'x-forwarded-for': `198.51.100.${i + 1}`,
          }),
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(401);
      }

      shouldFail = false;
      const callsBeforeBlocked = handler.mock.calls.length;
      const req6 = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.2'),
      });
      const res6 = await middleware(req6, {});
      expect(res6.status).toBe(429);
      expect(handler).toHaveBeenCalledTimes(callsBeforeBlocked);
      const body = await res6.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Too many requests');

      // Valid login from a distinct socket IP (127.0.0.3) still succeeds with 200
      const validPeerReq = new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.3'),
      });
      const validPeerRes = await middleware(validPeerReq, {});
      expect(validPeerRes.status).toBe(200);
    });

    test('allows 6+ valid logins on /api/guest/login, locks out after 5 failed 401 responses, and caps total bursts at 100/min', async () => {
      let statusToReturn = 200;
      const handler = jest.fn().mockImplementation(() =>
        new Response(
          JSON.stringify(statusToReturn === 200 ? { success: true } : { success: false, error: 'Incorrect passcode' }),
          { status: statusToReturn, headers: { 'content-type': 'application/json' } }
        )
      );
      const middleware = withApiMiddleware(handler);

      // Six valid guest logins from 127.0.0.2 succeed
      for (let i = 0; i < 6; i++) {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2'),
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(200);
      }

      // Five failed guest logins from 127.0.0.2 trigger 429 on next request
      statusToReturn = 401;
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.2'),
        });
        const res = await middleware(req, {});
        expect(res.status).toBe(401);
      }

      const lockedReq = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.2'),
      });
      const lockedRes = await middleware(lockedReq, {});
      expect(lockedRes.status).toBe(429);

      // On another socket IP (127.0.0.3), generalStore caps total burst requests at 100/min
      statusToReturn = 200;
      for (let i = 0; i < 100; i++) {
        const burstReq = new NextRequest('http://localhost/api/guest/login', {
          method: 'POST',
          headers: createVerifiedSocketIpHeaders('127.0.0.3'),
        });
        const burstRes = await middleware(burstReq, {});
        expect(burstRes.status).toBe(200);
      }
      const burst101Req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('127.0.0.3'),
      });
      const burst101Res = await middleware(burst101Req, {});
      expect(burst101Res.status).toBe(429);
    });

    test('enforces strict 5 failed-attempt limit on POST /api/admin/setup while keeping GET /api/admin/setup under general quota', async () => {
      const handler = jest.fn().mockImplementation((req: NextRequest) => {
        if (req.method === 'POST') {
          throw new ApiError(403, 'Initial setup has already been completed.');
        }
        return new Response(JSON.stringify({ success: true, initialized: true }), {
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

      // 5 failed POST attempts pass to handler (403), 6th POST attempt returns 429 before handler
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

    test('allows 6+ valid checks on GET /api/registry/validate-code and enforces 5 failed-attempt lockout', async () => {
      const handler = jest.fn().mockImplementation((req: NextRequest) => {
        const code = req.nextUrl.searchParams.get('code');
        if (code === 'VALID2026') {
          return new Response(JSON.stringify({ valid: true, guestName: 'Valid Household' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Invalid invitation code.' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      });
      const middleware = withApiMiddleware(handler);

      for (let i = 0; i < 6; i++) {
        const validReq = new NextRequest('http://localhost/api/registry/validate-code?code=VALID2026');
        const validRes = await middleware(validReq, {});
        expect(validRes.status).toBe(200);
      }

      for (let i = 0; i < 5; i++) {
        const req = new NextRequest(`http://localhost/api/registry/validate-code?code=CODE000${i}`);
        const res = await middleware(req, {});
        expect(res.status).toBe(404);
      }

      const req6 = new NextRequest('http://localhost/api/registry/validate-code?code=VALID2026');
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
  });
});
