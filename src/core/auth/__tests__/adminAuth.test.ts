import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ADMIN_COOKIE,
  getAdminCookieOptions,
  isAdminRequest,
  setAdminAuthCookie,
  signAdminToken,
  verifyAdminToken,
} from '@/core/auth/auth.server';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';

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

  describe('verifyAdminToken', () => {
    it('returns the payload when the token is valid and signature matches', async () => {
      const token = await signAdminToken({ isAdmin: true, iat: Date.now() });
      const payload = await verifyAdminToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.isAdmin).toBe(true);
    });

    it('returns null when token is invalid or malformed', async () => {
      expect(await verifyAdminToken('')).toBeNull();
      expect(await verifyAdminToken('invalid-token')).toBeNull();
      expect(await verifyAdminToken('invalid.token.structure')).toBeNull();
      expect(await verifyAdminToken('eyJhbGciOiJIUzI1NiJ9.invalidSig')).toBeNull();
    });

    it('returns null when token is expired via exp claim', async () => {
      const expiredToken = await signAdminToken({
        isAdmin: true,
        exp: Date.now() - 5000,
      });
      expect(await verifyAdminToken(expiredToken)).toBeNull();
    });

    it('returns null when token without exp has expired past 8 hours via iat', async () => {
      const expiredIatToken = await signAdminToken({
        isAdmin: true,
        iat: Date.now() - (9 * 60 * 60 * 1000),
      });
      expect(await verifyAdminToken(expiredIatToken)).toBeNull();
    });

    it('derives a domain-separated signing key from 64-byte scrypt hashes and rejects raw ADMIN_PASSWORD signatures', async () => {
      const savedPassword = process.env.ADMIN_PASSWORD;
      const scryptHash =
        'scrypt:dW5pdC10ZXN0LXNhbHQxNg==:PxxxlLtwOUqVGvw72ACcfwWGGFau07MUM+msUoc1D7VCuwBRorFQiYrVmcl29ZeTYQoAfO/azRoQ1cQKvm9Tmw==';
      process.env.ADMIN_PASSWORD = scryptHash;
      try {
        const derivedToken = await signAdminToken({ isAdmin: true, iat: Date.now() });
        expect(await verifyAdminToken(derivedToken)).toEqual(
          expect.objectContaining({ isAdmin: true })
        );

        const encodedPayload = base64urlEncode(JSON.stringify({ isAdmin: true, iat: Date.now() }));
        const rawHashToken = `${encodedPayload}.${await hmacSha256(scryptHash, encodedPayload)}`;
        expect(await verifyAdminToken(rawHashToken)).toBeNull();

        const rawReq = {
          cookies: { get: () => ({ value: rawHashToken }) },
          headers: { get: () => `admin_auth=${rawHashToken}` },
        } as unknown as NextRequest;
        await expect(isAdminRequest(rawReq)).resolves.toBe(false);
      } finally {
        process.env.ADMIN_PASSWORD = savedPassword;
      }
    });
  });
});
