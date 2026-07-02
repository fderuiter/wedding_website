import type { NextRequest } from 'next/server';
import { isAdminRequest, signAdminToken } from '@/core/auth/auth.server';

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
