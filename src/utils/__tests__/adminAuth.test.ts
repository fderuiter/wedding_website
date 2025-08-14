import type { NextRequest } from 'next/server';
import { isAdminClient } from '../adminAuth.client';
import { isAdminRequest } from '../adminAuth.server';

describe('admin authentication helpers', () => {
  describe('isAdminClient', () => {
    afterEach(() => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: '',
      });
    });

    it('returns true when admin cookie is present', () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'admin_auth=true',
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
    it('returns true for request with admin cookie', async () => {
      const req = {
        cookies: {
          get: () => ({ value: 'true' }),
        },
        headers: {
          get: () => 'admin_auth=true',
        },
      } as unknown as NextRequest;
      await expect(isAdminRequest(req)).resolves.toBe(true);
    });

    it('returns true for request with admin header but without cookie', async () => {
      const req = {
        cookies: {
          get: () => undefined,
        },
        headers: {
          get: () => 'admin_auth=true',
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
