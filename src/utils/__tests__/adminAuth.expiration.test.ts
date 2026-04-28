import type { NextRequest } from 'next/server';
import { isAdminRequest, signAdminToken } from '../adminAuth.server';

describe('admin authentication expiration', () => {
  it('returns false for a token with an expired exp claim', async () => {
    const pastTime = Date.now() - 10000; // 10 seconds ago
    const token = signAdminToken({ isAdmin: true, iat: pastTime - 60 * 60 * 8 * 1000, exp: pastTime });

    const req = {
      cookies: {
        get: () => ({ value: token }),
      },
      headers: {
        get: () => `admin_auth=${token}`,
      },
    } as unknown as NextRequest;

    await expect(isAdminRequest(req)).resolves.toBe(false);
  });

  it('returns true for a token with a valid exp claim', async () => {
    const futureTime = Date.now() + 10000; // 10 seconds from now
    const token = signAdminToken({ isAdmin: true, iat: Date.now(), exp: futureTime });

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

  it('returns false for an older token without exp claim that has expired based on iat', async () => {
    const pastTime = Date.now() - (60 * 60 * 8 * 1000) - 10000; // 8 hours and 10 seconds ago
    const token = signAdminToken({ isAdmin: true, iat: pastTime });

    const req = {
      cookies: {
        get: () => ({ value: token }),
      },
      headers: {
        get: () => `admin_auth=${token}`,
      },
    } as unknown as NextRequest;

    await expect(isAdminRequest(req)).resolves.toBe(false);
  });

  it('returns true for an older token without exp claim that is still valid based on iat', async () => {
    const pastTime = Date.now() - (60 * 60 * 7 * 1000); // 7 hours ago
    const token = signAdminToken({ isAdmin: true, iat: pastTime });

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
});
