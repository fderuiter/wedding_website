import type { NextRequest } from 'next/server';
import { isAdminClient } from '../adminAuth.client';
import { isAdminRequest, signAdminToken } from '../adminAuth.server';

describe('admin authentication helpers', () => {
  describe('isAdminClient', () => {
    afterEach(() => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: '',
      });
    });

    it('returns true when admin cookie is present (simulated non-HttpOnly)', () => {
      // We simulate a non-HttpOnly cookie for testing purposes, although in prod it is HttpOnly.
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'admin_auth=some_token',
      });
      expect(isAdminClient()).toBe(true);
    });

    it('returns false when admin cookie is absent', () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: '',
      });
      expect(isAdminClient()).toBe(false);
    });
  });

  describe('isAdminRequest', () => {
    const token = signAdminToken({ isAdmin: true, iat: Date.now() });

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
