/** @jest-environment node */

import { NextRequest } from 'next/server';
import { middleware, config as middlewareConfig } from '@/middleware';
import { signAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';

describe('Middleware Route Classification and Authorization Bypass', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      ALLOWED_HOSTS: 'localhost,127.0.0.1,*.localhost',
      CRON_SECRET: 'test-cron-secret-123',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Stripe webhook and standalone uploads exclusions', () => {
    it('allows unauthenticated POST /api/registry/webhook/stripe without session cookies', async () => {
      const req = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'stripe-signature': 't=1700000000,v1=deadbeef',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows unauthenticated GET /uploads/* and /api/uploads/* without session cookies and matches /uploads/:path* in matcher', async () => {
      expect(middlewareConfig.matcher).toContain('/uploads/:path*');

      for (const uploadPath of ['/uploads/photo.png', '/uploads/nested/hero.webp', '/uploads/favicon.ico', '/api/uploads/photo.png']) {
        const req = new NextRequest(`http://localhost:3000${uploadPath}`, {
          headers: { host: 'localhost:3000' },
        });
        const res = await middleware(req);
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
      }
    });
  });

  describe('First-run setup route classification (/api/admin/setup)', () => {
    it('allows unauthenticated GET /api/admin/setup to pass middleware without cookies', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/setup', {
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      // Status 200 from NextResponse.next()
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows unauthenticated POST /api/admin/setup to pass middleware without cookies', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/setup', {
        method: 'POST',
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows trailing slash /api/admin/setup/ without cookies', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/setup/', {
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Cron routes bearer authorization bypass (/api/cron/*)', () => {
    it('allows GET /api/cron/broadcasts with valid Bearer token', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer test-cron-secret-123',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows POST /api/cron/broadcasts with valid Bearer token', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer test-cron-secret-123',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('allows trailing slash /api/cron/broadcasts/ with valid Bearer token', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts/', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer test-cron-secret-123',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('blocks GET /api/cron/broadcasts without Authorization header with HTTP 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('blocks GET /api/cron/broadcasts with invalid Bearer token with HTTP 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer wrong-secret-token',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('blocks GET /api/cron/broadcasts with empty or malformed authorization header', async () => {
      const emptyBearerReq = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer ',
        },
      });
      const emptyRes = await middleware(emptyBearerReq);
      expect(emptyRes.status).toBe(401);

      const basicAuthReq = new NextRequest('http://localhost:3000/api/cron/broadcasts', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });
      const basicRes = await middleware(basicAuthReq);
      expect(basicRes.status).toBe(401);
    });
  });

  describe('Perimeter security and isolation', () => {
    it('blocks access to protected administrative routes even when valid cron bearer token is presented', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/seating', {
        headers: {
          host: 'localhost:3000',
          authorization: 'Bearer test-cron-secret-123',
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('blocks access to protected administrative routes without session cookies', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/settings', {
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('allows access to protected administrative routes when valid admin cookie is provided', async () => {
      const token = await signAdminToken({ isAdmin: true, iat: Date.now() });
      const req = new NextRequest('http://localhost:3000/api/admin/settings', {
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_COOKIE}=${token}`,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it('blocks unauthenticated API requests to non-excluded endpoints with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/weather', {
        headers: { host: 'localhost:3000' },
      });

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('blocks guest-authenticated GET requests to /api/media and /api/media/ with 401 while allowing /api/photos', async () => {
      const guestToken = await signGuestToken({ guest: true, exp: Date.now() + 1000 * 60 * 60 });
      const guestHeaders = {
        host: 'localhost:3000',
        cookie: `${GUEST_COOKIE}=${guestToken}`,
      };

      const mediaRes = await middleware(new NextRequest('http://localhost:3000/api/media?page=1&limit=100', { headers: guestHeaders }));
      expect(mediaRes.status).toBe(401);

      const trailingSlashRes = await middleware(new NextRequest('http://localhost:3000/api/media/', { headers: guestHeaders }));
      expect(trailingSlashRes.status).toBe(401);

      const childRes = await middleware(new NextRequest('http://localhost:3000/api/media/123', { headers: guestHeaders }));
      expect(childRes.status).toBe(401);

      const photosRes = await middleware(new NextRequest('http://localhost:3000/api/photos', { headers: guestHeaders }));
      expect(photosRes.status).toBe(200);
    });

    it('enforces auth checks on /api/* paths ending with image suffixes while still excluding public static images', async () => {
      const adminPngReq = new NextRequest('http://localhost:3000/api/admin/evict/key-0.png', {
        headers: { host: 'localhost:3000' },
      });
      const adminPngRes = await middleware(adminPngReq);
      expect(adminPngRes.status).toBe(401);

      const apiPhotoSvgReq = new NextRequest('http://localhost:3000/api/photos/banner.svg', {
        headers: { host: 'localhost:3000' },
      });
      const apiPhotoSvgRes = await middleware(apiPhotoSvgReq);
      expect(apiPhotoSvgRes.status).toBe(401);

      const publicImgReq = new NextRequest('http://localhost:3000/images/sunset-embrace.jpg', {
        headers: { host: 'localhost:3000' },
      });
      const publicImgRes = await middleware(publicImgReq);
      expect(publicImgRes.status).toBe(200);
      expect(publicImgRes.headers.get('location')).toBeNull();
    });
  });
});
