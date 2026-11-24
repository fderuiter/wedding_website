/** @jest-environment node */

import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { middleware } from '@/middleware';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { parseJsonRequestBody } from '@/utils/contentType';
import { validateMutatingRequestOrigin } from '@/utils/hostValidation';
import {
  resetRateLimitsForTesting,
  setAuthLockoutPoolForTesting,
} from '@/utils/rateLimit';
import { signAdminToken } from '@/core/auth/auth.server';
import { signGuestToken } from '@/core/auth/guest.server';
import { POST as maintenanceImportPost } from '@/app/api/admin/maintenance/import/route';
import { POST as adminLogoutPost } from '@/app/api/admin/logout/route';
import { POST as adminUploadPost } from '@/app/api/admin/upload/route';
import { POST as guestPhotoUploadPost } from '@/app/api/guest/photos/upload/route';
import { POST as mediaExportPost } from '@/app/api/media/export/route';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { POST as validateCodePost } from '@/app/api/registry/validate-code/route';
import { prisma } from '@/lib/prisma';

jest.mock('@/utils/storage', () => ({
  getStorageProvider: jest.fn(() => ({
    upload: jest.fn().mockResolvedValue({ url: '/uploads/test-sanitized.jpg' }),
  })),
}));

jest.mock('@/utils/imageProcessor', () => ({
  sanitizeImage: jest.fn(async (file: File) => file),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn().mockResolvedValue({
      id: 'global',
      modules: {
        rsvp: true,
        registry: true,
        gallery: true,
      },
    }),
  };
});

jest.mock('@/features/media', () => ({
  mediaRepository: {
    createMedia: jest.fn().mockResolvedValue({
      id: 'media-1',
      url: '/uploads/test-sanitized.jpg',
      altText: 'Guest Photo',
      createdAt: new Date(),
    }),
  },
}));

jest.mock('@/features/content', () => {
  const actual = jest.requireActual('@/features/content');
  return {
    ...actual,
    contentRepository: {
      createNode: jest.fn().mockResolvedValue({ id: 'node-1' }),
    },
  };
});

describe('Fetch Metadata origin enforcement, 415 Content-Type validation, and auth lockout safety', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      TRUST_PROXY: '1',
      ALLOWED_HOSTS: 'wedding.example,localhost,localhost:3000',
      CRON_SECRET: 'cron-secret-value-for-tests-123456',
      GUEST_SESSION_SECRET: 'prod-guest-secret-at-least-32-characters-long',
      GUEST_PASSCODE: 'valid-guest-passcode',
    };
    setAuthLockoutPoolForTesting(null);
    resetRateLimitsForTesting();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Fetch Metadata and canonical Origin/Referer validation across POST, PUT, PATCH, DELETE', () => {
    const methods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

    it.each(methods)(
      'rejects cross-site, same-site, and mismatched Origin/Referer on %s in both middleware and withApiMiddleware',
      async (method) => {
        const wrappedHandler = withApiMiddleware(async () =>
          NextResponse.json({ mutated: true })
        );

        const attackCases: Array<{ label: string; headers: Record<string, string> }> = [
          {
            label: 'Sec-Fetch-Site: cross-site',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              'sec-fetch-site': 'cross-site',
            },
          },
          {
            label: 'Sec-Fetch-Site: same-site (sibling subdomain)',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              'sec-fetch-site': 'same-site',
              origin: 'https://sub.wedding.example',
            },
          },
          {
            label: 'mismatched Origin header',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              origin: 'https://evil.example',
            },
          },
          {
            label: 'opaque Origin: null',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              origin: 'null',
            },
          },
          {
            label: 'mismatched Referer header without Origin',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              referer: 'https://evil.example/auto-submit-form.html',
            },
          },
        ];

        for (const attack of attackCases) {
          const mwReq = new NextRequest('https://wedding.example/api/guest/login', {
            method,
            headers: attack.headers,
          });
          const mwRes = await middleware(mwReq);
          expect(mwRes.status).toBe(403);

          const apiReq = new NextRequest('https://wedding.example/api/rsvp', {
            method,
            headers: attack.headers,
          });
          const apiRes = await wrappedHandler(apiReq);
          expect(apiRes.status).toBe(403);
        }
      }
    );

    it.each(methods)(
      'allows same-origin, Sec-Fetch-Site: none, and server-to-server %s requests',
      async (method) => {
        const wrappedHandler = withApiMiddleware(async () =>
          NextResponse.json({ mutated: true })
        );

        const validCases: Array<Record<string, string>> = [
          {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'same-origin',
            origin: 'https://wedding.example',
            referer: 'https://wedding.example/rsvp',
          },
          {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'sec-fetch-site': 'none',
          },
          {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
          },
        ];

        for (const headers of validCases) {
          const req = new NextRequest('https://wedding.example/api/rsvp', {
            method,
            headers,
          });
          expect(validateMutatingRequestOrigin(req)).toBeNull();
          const res = await wrappedHandler(req);
          expect(res.status).toBe(200);
        }
      }
    );

    it('exempts POST /api/registry/webhook/stripe and /api/cron/* from browser origin checks', async () => {
      const stripeWebhookReq = new NextRequest(
        'https://wedding.example/api/registry/webhook/stripe',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            origin: 'https://hooks.stripe.com',
            'sec-fetch-site': 'cross-site',
          },
          body: '{"id":"evt_123"}',
        }
      );

      expect(validateMutatingRequestOrigin(stripeWebhookReq)).toBeNull();
      const stripeMwRes = await middleware(stripeWebhookReq);
      expect(stripeMwRes.status).not.toBe(403);
      expect(stripeMwRes.status).not.toBe(401);

      const cronPostReq = new NextRequest(
        'https://wedding.example/api/cron/broadcasts',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            authorization: 'Bearer cron-secret-value-for-tests-123456',
            origin: 'https://scheduler.external.example',
            'sec-fetch-site': 'cross-site',
          },
        }
      );
      expect(validateMutatingRequestOrigin(cronPostReq)).toBeNull();
      const cronMwRes = await middleware(cronPostReq);
      expect(cronMwRes.status).toBe(200);

      // Unauthenticated cron request still fails with 401
      const unauthCronReq = new NextRequest(
        'https://wedding.example/api/cron/broadcasts',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const unauthCronRes = await middleware(unauthCronReq);
      expect(unauthCronRes.status).toBe(401);
    });
  });

  describe('Content-Type: application/json enforcement (415 Unsupported Media Type) and upload/export exemptions', () => {
    const EchoSchema = z.object({ message: z.string().min(1) });

    it.each(['POST', 'PUT', 'PATCH'] as const)(
      'returns 415 on %s routes using createValidatedRoute when Content-Type is not application/json',
      async (method) => {
        const route = createValidatedRoute({
          schema: EchoSchema,
          handler: async (_req, { body }) => NextResponse.json({ echoed: body.message }),
        });

        for (const badContentType of [
          'text/plain',
          'application/x-www-form-urlencoded',
        ]) {
          const badReq = new NextRequest('https://wedding.example/api/test', {
            method,
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              'content-type': badContentType,
            },
            body: JSON.stringify({ message: 'hello' }),
          });
          const badRes = await route(badReq);
          expect(badRes.status).toBe(415);
        }

        const missingCtReq = new NextRequest('https://wedding.example/api/test', {
          method,
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
          },
          body: JSON.stringify({ message: 'hello' }),
        });
        expect((await route(missingCtReq)).status).toBe(415);

        const goodReq = new NextRequest('https://wedding.example/api/test', {
          method,
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ message: 'hello' }),
        });
        const goodRes = await route(goodReq);
        expect(goodRes.status).toBe(200);
      }
    );

    it('rejects text/plain CSRF payloads with 415 on direct JSON route POST /api/admin/maintenance/import', async () => {
      const adminToken = await signAdminToken({ isAdmin: true });
      const textPlainReq = new NextRequest(
        'https://wedding.example/api/admin/maintenance/import',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            cookie: `__Host-admin_auth=${adminToken}`,
            'content-type': 'text/plain',
          },
          body: JSON.stringify({ appConfig: [], registryItem: [] }),
        }
      );

      const res = await maintenanceImportPost(textPlainReq);
      expect(res.status).toBe(415);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows empty-body POST /api/admin/logout without Content-Type while rejecting text/plain bodies on allowEmpty parser', async () => {
      const logoutReq = new NextRequest('https://wedding.example/api/admin/logout', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          'sec-fetch-site': 'same-origin',
          origin: 'https://wedding.example',
        },
      });
      const logoutRes = await adminLogoutPost(logoutReq);
      expect(logoutRes.status).toBe(200);

      const textPlainEmptyParserReq = new NextRequest('https://wedding.example/api/test', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'content-type': 'text/plain',
        },
        body: '{}',
      });
      await expect(
        parseJsonRequestBody(textPlainEmptyParserReq, { allowEmpty: true })
      ).rejects.toMatchObject({ statusCode: 415 });
    });

    it('continues allowing multipart/form-data on /api/admin/upload and /api/guest/photos/upload while blocking cross-site uploads', async () => {
      const adminToken = await signAdminToken({ isAdmin: true });
      const guestToken = await signGuestToken({ guest: true });
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const adminForm = new FormData();
      adminForm.append('file', new File([jpegBytes], 'hero.jpg', { type: 'image/jpeg' }));
      const sameOriginAdminUpload = new NextRequest(
        'https://wedding.example/api/admin/upload',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            cookie: `__Host-admin_auth=${adminToken}`,
            'sec-fetch-site': 'same-origin',
            origin: 'https://wedding.example',
          },
          body: adminForm,
        }
      );
      const adminUploadRes = await adminUploadPost(sameOriginAdminUpload);
      expect(adminUploadRes.status).toBe(200);

      const crossSiteAdminUpload = new NextRequest(
        'https://wedding.example/api/admin/upload',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            cookie: `__Host-admin_auth=${adminToken}`,
            'sec-fetch-site': 'cross-site',
            origin: 'https://evil.example',
          },
          body: adminForm,
        }
      );
      expect((await adminUploadPost(crossSiteAdminUpload)).status).toBe(403);

      const guestForm = new FormData();
      guestForm.append('files', new File([jpegBytes], 'party.jpg', { type: 'image/jpeg' }));
      guestForm.append('uploaderName', 'Sam Guest');
      const sameOriginGuestUpload = new NextRequest(
        'https://wedding.example/api/guest/photos/upload',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            cookie: `__Host-guest_auth=${guestToken}`,
            'sec-fetch-site': 'same-origin',
            origin: 'https://wedding.example',
          },
          body: guestForm,
        }
      );
      const guestUploadRes = await guestPhotoUploadPost(sameOriginGuestUpload);
      expect(guestUploadRes.status).toBe(201);

      const crossSiteGuestUpload = new NextRequest(
        'https://wedding.example/api/guest/photos/upload',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            cookie: `__Host-guest_auth=${guestToken}`,
            'sec-fetch-site': 'cross-site',
          },
          body: guestForm,
        }
      );
      expect((await guestPhotoUploadPost(crossSiteGuestUpload)).status).toBe(403);
    });

    it('allows application/x-www-form-urlencoded on POST /api/media/export while rejecting text/plain (415) and cross-site (403)', async () => {
      const adminToken = await signAdminToken({ isAdmin: true });
      (prisma.media.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([]);

      // Valid same-origin form-urlencoded request passes origin + media-type checks and reaches domain logic (404 when no matching items)
      const formExportReq = new NextRequest('https://wedding.example/api/media/export', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          cookie: `__Host-admin_auth=${adminToken}`,
          'sec-fetch-site': 'same-origin',
          origin: 'https://wedding.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'tag=Ceremony',
      });
      const formExportRes = await mediaExportPost(formExportReq);
      expect(formExportRes.status).toBe(404);

      const textPlainExportReq = new NextRequest('https://wedding.example/api/media/export', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          cookie: `__Host-admin_auth=${adminToken}`,
          'sec-fetch-site': 'same-origin',
          origin: 'https://wedding.example',
          'content-type': 'text/plain',
        },
        body: 'tag=Ceremony',
      });
      expect((await mediaExportPost(textPlainExportReq)).status).toBe(415);

      const crossSiteExportReq = new NextRequest('https://wedding.example/api/media/export', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'https',
          cookie: `__Host-admin_auth=${adminToken}`,
          'sec-fetch-site': 'cross-site',
          origin: 'https://evil.example',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'tag=Ceremony',
      });
      expect((await mediaExportPost(crossSiteExportReq)).status).toBe(403);
    });
  });

  describe('5-attempt failed authentication lockout preservation without cross-site lockout DoS', () => {
    it('does not burn the 5-attempt lockout quota on cross-site 403 requests, and locks out after 5 same-origin failures', async () => {
      const victimIp = '198.51.100.42';

      // 10 forged cross-site POSTs against /api/guest/login from victim's browser are blocked with 403
      for (let i = 0; i < 10; i++) {
        const crossSiteLogin = new NextRequest('https://wedding.example/api/guest/login', {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'x-real-ip': victimIp,
            'sec-fetch-site': 'cross-site',
            origin: 'https://evil.example',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ passcode: 'wrong-passcode' }),
        });
        const res = await guestLoginPost(crossSiteLogin);
        expect(res.status).toBe(403);
      }

      // Legitimate same-origin guest login from the same IP still succeeds and issues __Host-guest_auth!
      const validSameOriginLogin = new NextRequest(
        'https://wedding.example/api/guest/login',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'x-real-ip': victimIp,
            'sec-fetch-site': 'same-origin',
            origin: 'https://wedding.example',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ passcode: 'valid-guest-passcode' }),
        }
      );
      const validLoginRes = await guestLoginPost(validSameOriginLogin);
      expect(validLoginRes.status).toBe(200);
      expect(validLoginRes.headers.get('set-cookie') || '').toContain('__Host-guest_auth=');

      // Now verify 5 same-origin failed attempts on POST /api/registry/validate-code trigger 429 on attempt 6
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);
      const bruteForceIp = '198.51.100.99';

      for (let attempt = 1; attempt <= 5; attempt++) {
        const invalidCodeReq = new NextRequest(
          'https://wedding.example/api/registry/validate-code',
          {
            method: 'POST',
            headers: {
              host: 'wedding.example',
              'x-forwarded-proto': 'https',
              'x-real-ip': bruteForceIp,
              'sec-fetch-site': 'same-origin',
              origin: 'https://wedding.example',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ code: `BAD${attempt}` }),
          }
        );
        const res = await validateCodePost(invalidCodeReq);
        expect(res.status).toBe(404);
      }

      const sixthAttemptReq = new NextRequest(
        'https://wedding.example/api/registry/validate-code',
        {
          method: 'POST',
          headers: {
            host: 'wedding.example',
            'x-forwarded-proto': 'https',
            'x-real-ip': bruteForceIp,
            'sec-fetch-site': 'same-origin',
            origin: 'https://wedding.example',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ code: 'BAD6' }),
        }
      );
      const lockedRes = await validateCodePost(sixthAttemptReq);
      expect(lockedRes.status).toBe(429);
    });

    it('gates x-forwarded-host and x-forwarded-proto behind TRUST_PROXY in validateMutatingRequestOrigin', () => {
      process.env.ALLOWED_HOSTS = 'wedding.example,alt.wedding.example';
      process.env.TRUST_PROXY = 'false';

      // Spoofed x-forwarded-host must be ignored when TRUST_PROXY=false
      const spoofedForwardedHostReq = new NextRequest('https://wedding.example/api/rsvp', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-host': 'alt.wedding.example',
          'x-forwarded-proto': 'https',
          origin: 'https://alt.wedding.example',
        },
      });
      expect(validateMutatingRequestOrigin(spoofedForwardedHostReq)).toBe(
        'Cross-origin request blocked.'
      );

      // Spoofed x-forwarded-proto: http must not downgrade expected https:// origin when TRUST_PROXY=false
      const spoofedProtoReq = new NextRequest('https://wedding.example/api/rsvp', {
        method: 'POST',
        headers: {
          host: 'wedding.example',
          'x-forwarded-proto': 'http',
          origin: 'https://wedding.example',
        },
      });
      expect(validateMutatingRequestOrigin(spoofedProtoReq)).toBeNull();

      // With TRUST_PROXY=1, trusted rightmost forwarded hop is honored
      process.env.TRUST_PROXY = '1';
      expect(validateMutatingRequestOrigin(spoofedForwardedHostReq)).toBeNull();
    });
  });
});
