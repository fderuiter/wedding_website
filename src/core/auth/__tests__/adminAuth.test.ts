import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_COOKIE, getAdminCookieOptions, isAdminRequest, setAdminAuthCookie, signAdminToken } from '@/core/auth/auth.server';

describe('admin authentication helpers', () => {
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  beforeAll(() => {
    process.env.ADMIN_PASSWORD = 'test-admin-secret';
  });

  afterAll(() => {
    if (previousAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  });

  describe('getAdminCookieOptions', () => {
    it('returns default options with 8-hour maxAge', () => {
      const options = getAdminCookieOptions();
      expect(options).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 28800,
      });
    });

    it('returns custom maxAge options when specified (e.g. 0 for logout)', () => {
      const options = getAdminCookieOptions(0);
      expect(options).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    });
  });

  describe('setAdminAuthCookie', () => {
    it('sets cookie on response with default maxAge', () => {
      const response = NextResponse.json({ success: true });
      const setSpy = jest.spyOn(response.cookies, 'set');
      setAdminAuthCookie(response, 'test-token');

      expect(setSpy).toHaveBeenCalledWith(
        ADMIN_COOKIE,
        'test-token',
        getAdminCookieOptions()
      );
    });

    it('sets cookie on response with custom maxAge', () => {
      const response = NextResponse.json({ success: true });
      const setSpy = jest.spyOn(response.cookies, 'set');
      setAdminAuthCookie(response, '', 0);

      expect(setSpy).toHaveBeenCalledWith(
        ADMIN_COOKIE,
        '',
        getAdminCookieOptions(0)
      );
    });
  });

  describe('isAdminRequest', () => {
    let token: string;
    
    beforeAll(async () => {
      token = await signAdminToken({ isAdmin: true, iat: Date.now() });
    });

    it('returns true for request with valid signed admin cookie', async () => {
      const req = {
        cookies: {
          get: () => ({ value: token }),
        },
        headers: {
          get: () => `admin_auth=${token}`,
        },
      } as unknown as NextRequest;
      await expect(isAdminRequest(req)).resolves.toBe(true);
    });

    it('returns false for request with invalid cookie value (e.g. just "true")', async () => {
      const req = {
        cookies: {
          get: () => ({ value: 'true' }),
        },
        headers: {
          get: () => 'admin_auth=true',
        },
      } as unknown as NextRequest;
      await expect(isAdminRequest(req)).resolves.toBe(false);
    });

    it('returns true for request with admin header but without cookie (edge case in logic)', async () => {
      const req = {
        cookies: {
          get: () => undefined,
        },
        headers: {
          get: () => `admin_auth=${token}`,
        },
      } as unknown as NextRequest;
      await expect(isAdminRequest(req)).resolves.toBe(true);
    });

    it('returns false for request without admin cookie', async () => {
      const req = {
        cookies: {
          get: () => undefined,
        },
        headers: {
          get: () => null,
        },
      } as unknown as NextRequest;
      await expect(isAdminRequest(req)).resolves.toBe(false);
    });
  });
});
