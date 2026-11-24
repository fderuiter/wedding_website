/** @jest-environment node */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { POST as postAdminLogin } from '@/app/api/admin/login/route';
import { GET as getPhotoQr } from '@/app/api/admin/photos/qr/route';
import { POST as postAdminSetup } from '@/app/api/admin/setup/route';
import { POST as postGuestLogin } from '@/app/api/guest/login/route';
import { GET as getGuestSession } from '@/app/api/guest/session/route';
import { GET as getValidateCode } from '@/app/api/registry/validate-code/route';
import { generateMetadata } from '@/app/metadata';
import {
  ADMIN_COOKIE,
  isAdminRequest,
  signAdminToken,
  verifyAdminToken,
} from '@/core/auth/auth.server';
import {
  GUEST_COOKIE,
  isGuestRequest,
  signGuestToken,
  verifyGuestToken,
} from '@/core/auth/guest.server';
import {
  GUEST_CALLBACK_URL_HEADER,
  GUEST_GATED_PAGE_HEADER,
  GUEST_HEADER_SIGNATURE_HEADER,
} from '@/core/auth/guestHeaderSignature';
import {
  enforceActiveGuestPageSession,
  getActivePhotoUploadSession,
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import {
  GUEST_PHOTO_COOKIE,
  PHOTO_QR_QUERY_PARAM,
  signPhotoUploadSessionToken,
  verifyPhotoQrLinkToken,
  verifyPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import { prisma } from '@/lib/prisma';
import { middleware } from '@/middleware';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    const error = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    invitationCode: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    broadcastRecipient: {
      updateMany: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
    },
    contentNode: {
      count: jest.fn().mockResolvedValue(1),
    },
  },
}));

function extractSetCookieToken(setCookieHeader: string | null, cookieName: string): string {
  if (!setCookieHeader) return '';
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}

describe('Multisite Cookie Claims, Forged Header Defenses & Metadata Host Trust', () => {
  const originalEnv = { ...process.env };
  const mockCookies = cookies as unknown as jest.Mock;
  const mockHeaders = headers as unknown as jest.Mock;
  const mockRedirect = redirect as unknown as jest.Mock;

  const tenantAliceConfig = {
    id: 'site-alice',
    subdomain: 'alice',
    partner1Name: 'Alice',
    partner2Name: 'Alex',
    brideName: 'Alice',
    groomName: 'Alex',
    baseUrl: 'https://alice.wedding.example',
    weddingDate: new Date('2027-06-20T16:00:00.000Z'),
    venueName: 'Garden Hall',
    venueAddress: '100 Main St',
    venueCity: 'Austin',
    venueState: 'TX',
    venueZip: '78701',
    latitude: 30.2672,
    longitude: -97.7431,
    storyText: '',
    venueDescription: '',
    travelAdvice: '',
    heroTitle: '',
    heroSubtitle: '',
    seoTitle: 'Alice & Alex',
    seoDescription: '',
    faviconUrl: '/assets/favicon.png',
    ogImageUrl: '/api/og',
    seoKeywords: '',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    timezone: 'America/Chicago',
    showCountdown: true,
    showAddToCalendar: true,
    setupCompleted: true,
    features: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const tenantBobConfig = {
    ...tenantAliceConfig,
    id: 'site-bob',
    subdomain: 'bob',
    partner1Name: 'Bob',
    partner2Name: 'Blair',
    brideName: 'Bob',
    groomName: 'Blair',
    baseUrl: 'https://bob.wedding.example',
    seoTitle: 'Bob & Blair',
  };

  const uninitializedTenantConfig = {
    ...tenantAliceConfig,
    id: 'site-new',
    subdomain: 'newcouple',
    partner1Name: '',
    partner2Name: '',
    brideName: '',
    groomName: '',
    baseUrl: '',
    setupCompleted: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };
    globalWithStore.globalFallbackStore?.clear();

    process.env = {
      ...originalEnv,
      ALLOWED_HOSTS: 'localhost,127.0.0.1,*.localhost,wedding.example,*.wedding.example',
      MULTISITE_ENABLED: 'true',
      TRUST_PROXY: 'false',
      GUEST_PASSCODE: 'shared-guest-passcode-123',
      GUEST_SESSION_SECRET: 'multisite-test-guest-session-secret-32chars',
      // Valid scrypt hash for password 'secret'
      ADMIN_PASSWORD:
        'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==',
    };

    mockHeaders.mockImplementation(() => {
      throw new Error('headers() called outside request scope');
    });

    (prisma.appConfig.findUnique as jest.Mock).mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        if (where.id === 'site-alice') return tenantAliceConfig;
        if (where.id === 'site-bob') return tenantBobConfig;
        if (where.id === 'site-new') return uninitializedTenantConfig;
        if (where.id === 'global') return { ...tenantAliceConfig, id: 'global', subdomain: null };
        return null;
      }
    );

    (prisma.appConfig.findFirst as jest.Mock).mockImplementation(
      async ({ where }: { where: { subdomain?: string } }) => {
        if (where.subdomain === 'alice') return tenantAliceConfig;
        if (where.subdomain === 'bob') return tenantBobConfig;
        if (where.subdomain === 'newcouple') return uninitializedTenantConfig;
        return null;
      }
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Cookie claim minting & cross-tenant isolation (MULTISITE_ENABLED=true)', () => {
    it('stamps siteId and normalized subdomain into guest_auth, guest_invite_session, and admin_auth across login, validate-code, and setup routes', async () => {
      // 1. POST /api/guest/login (shared passcode -> guest_auth)
      const guestPassReq = new NextRequest('http://Alice.wedding.example/api/guest/login', {
        method: 'POST',
        headers: {
          host: 'Alice.wedding.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ passcode: 'shared-guest-passcode-123' }),
      });
      const guestPassRes = await postGuestLogin(guestPassReq);
      expect(guestPassRes.status).toBe(200);
      const guestToken = extractSetCookieToken(guestPassRes.headers.get('set-cookie'), GUEST_COOKIE);
      const decodedGuest = await verifyGuestToken(guestToken);
      expect(decodedGuest).toMatchObject({
        guest: true,
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // 2. POST /api/guest/login (invitation code -> guest_invite_session)
      (prisma.invitationCode.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'inv-1',
        code: 'ALICEINV',
        guestName: 'Jordan Guest',
        isSample: false,
      });
      const guestInviteReq = new NextRequest('http://alice.wedding.example/api/guest/login', {
        method: 'POST',
        headers: {
          host: 'alice.wedding.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ passcode: 'ALICEINV' }),
      });
      const guestInviteRes = await postGuestLogin(guestInviteReq);
      expect(guestInviteRes.status).toBe(200);
      const inviteLoginToken = extractSetCookieToken(
        guestInviteRes.headers.get('set-cookie'),
        GUEST_INVITE_COOKIE
      );
      await expect(verifyGuestInviteSessionToken(inviteLoginToken)).resolves.toMatchObject({
        code: 'ALICEINV',
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // 3. GET /api/registry/validate-code -> guest_invite_session
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'inv-2',
        code: 'REGINV01',
        guestName: 'Morgan Guest',
        isSample: false,
      });
      const validateCodeReq = new NextRequest(
        'http://alice.wedding.example/api/registry/validate-code?code=REGINV01',
        {
          headers: { host: 'alice.wedding.example' },
        }
      );
      const validateCodeRes = await getValidateCode(validateCodeReq);
      expect(validateCodeRes.status).toBe(200);
      const validateToken = extractSetCookieToken(
        validateCodeRes.headers.get('set-cookie'),
        GUEST_INVITE_COOKIE
      );
      await expect(verifyGuestInviteSessionToken(validateToken)).resolves.toMatchObject({
        code: 'REGINV01',
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // 4. POST /api/admin/login -> admin_auth
      const adminLoginReq = new NextRequest('http://alice.wedding.example/api/admin/login', {
        method: 'POST',
        headers: {
          host: 'alice.wedding.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password: 'secret' }),
      });
      const adminLoginRes = await postAdminLogin(adminLoginReq);
      expect(adminLoginRes.status).toBe(200);
      const adminToken = extractSetCookieToken(
        adminLoginRes.headers.get('set-cookie'),
        ADMIN_COOKIE
      );
      await expect(verifyAdminToken(adminToken)).resolves.toMatchObject({
        isAdmin: true,
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // 5. POST /api/admin/setup (Step 1 auth-only check on uninitialized tenant) -> admin_auth
      const adminSetupReq = new NextRequest('http://newcouple.wedding.example/api/admin/setup', {
        method: 'POST',
        headers: {
          host: 'newcouple.wedding.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password: 'secret' }),
      });
      const adminSetupRes = await postAdminSetup(adminSetupReq);
      expect(adminSetupRes.status).toBe(200);
      const setupAdminToken = extractSetCookieToken(
        adminSetupRes.headers.get('set-cookie'),
        ADMIN_COOKIE
      );
      await expect(verifyAdminToken(setupAdminToken)).resolves.toMatchObject({
        isAdmin: true,
        siteId: 'site-new',
        subdomain: 'newcouple',
      });

      // 6. GET /api/admin/photos/qr -> photo_qr_link carrying siteId & subdomain
      const aliceQrReq = new NextRequest('http://alice.wedding.example/api/admin/photos/qr', {
        headers: {
          host: 'alice.wedding.example',
          cookie: `${ADMIN_COOKIE}=${adminToken}`,
        },
      });
      const aliceQrRes = await getPhotoQr(aliceQrReq);
      expect(aliceQrRes.status).toBe(200);
      const aliceQrJson = await aliceQrRes.json();
      const aliceQrToken = new URL(aliceQrJson.uploadUrl).searchParams.get(PHOTO_QR_QUERY_PARAM);
      await expect(verifyPhotoQrLinkToken(aliceQrToken)).resolves.toMatchObject({
        purpose: 'photo_qr_link',
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // Exchanging Alice's QR link succeeds on alice.wedding.example and stamps tenant claims on guest_photo_session
      const aliceQrExchangeReq = new NextRequest(
        `http://alice.wedding.example/photos?qr=${encodeURIComponent(aliceQrToken || '')}`,
        { headers: { host: 'alice.wedding.example' } }
      );
      const aliceQrExchangeRes = await middleware(aliceQrExchangeReq);
      expect(aliceQrExchangeRes.status).toBe(303);
      expect(aliceQrExchangeRes.headers.get('location')).toBe(
        'http://alice.wedding.example/photos?tab=guest'
      );
      const alicePhotoCookie = extractSetCookieToken(
        aliceQrExchangeRes.headers.get('set-cookie'),
        GUEST_PHOTO_COOKIE
      );
      await expect(verifyPhotoUploadSessionToken(alicePhotoCookie)).resolves.toMatchObject({
        purpose: 'photo_upload_session',
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      // Replaying Alice's QR link on bob.wedding.example is rejected without minting a cookie
      const bobQrReplayReq = new NextRequest(
        `http://bob.wedding.example/photos?qr=${encodeURIComponent(aliceQrToken || '')}`,
        { headers: { host: 'bob.wedding.example' } }
      );
      const bobQrReplayRes = await middleware(bobQrReplayReq);
      expect(bobQrReplayRes.status).toBe(303);
      expect(bobQrReplayRes.headers.get('location')).toBe(
        'http://bob.wedding.example/guest/login?callbackUrl=%2Fphotos%3Ftab%3Dguest'
      );
      expect(bobQrReplayRes.headers.get('set-cookie')).toBeNull();
    });

    it('rejects Tenant A cookies on Tenant B across Edge middleware and Node auth helpers when MULTISITE_ENABLED=true', async () => {
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-active',
        code: 'ALICEINV',
        guestName: 'Jordan Guest',
        isSample: false,
      });

      const aliceGuestToken = await signGuestToken({
        guest: true,
        siteId: 'site-alice',
        subdomain: 'alice',
        iat: Date.now(),
        exp: Date.now() + 60_000,
      });
      const aliceInviteToken = await signGuestInviteSessionToken({
        code: 'ALICEINV',
        guestName: 'Jordan Guest',
        siteId: 'site-alice',
        subdomain: 'alice',
      });
      const aliceAdminToken = await signAdminToken({
        isAdmin: true,
        siteId: 'site-alice',
        subdomain: 'alice',
        iat: Date.now(),
        exp: Date.now() + 60_000,
      });

      // Valid on Tenant A (alice.wedding.example)
      const alicePageReq = new NextRequest('http://alice.wedding.example/photos', {
        headers: {
          host: 'alice.wedding.example',
          cookie: `${GUEST_COOKIE}=${aliceGuestToken}`,
        },
      });
      expect((await middleware(alicePageReq)).status).toBe(200);
      await expect(isGuestRequest(alicePageReq)).resolves.toBe(true);

      const aliceInviteReq = new NextRequest('http://alice.wedding.example/photos', {
        headers: {
          host: 'alice.wedding.example',
          cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
        },
      });
      expect((await middleware(aliceInviteReq)).status).toBe(200);
      await expect(getGuestInviteSession(aliceInviteReq)).resolves.toMatchObject({
        code: 'ALICEINV',
      });

      const aliceAdminReq = new NextRequest('http://alice.wedding.example/admin/dashboard', {
        headers: {
          host: 'alice.wedding.example',
          cookie: `${ADMIN_COOKIE}=${aliceAdminToken}`,
        },
      });
      expect((await middleware(aliceAdminReq)).status).toBe(200);
      await expect(isAdminRequest(aliceAdminReq)).resolves.toBe(true);

      // Rejected on Tenant B (bob.wedding.example) at Edge AND Node
      const bobGuestReq = new NextRequest('http://bob.wedding.example/photos', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${GUEST_COOKIE}=${aliceGuestToken}`,
        },
      });
      expect((await middleware(bobGuestReq)).status).toBe(303);
      await expect(isGuestRequest(bobGuestReq)).resolves.toBe(false);

      const bobInviteReq = new NextRequest('http://bob.wedding.example/photos', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
        },
      });
      expect((await middleware(bobInviteReq)).status).toBe(303);
      await expect(getGuestInviteSession(bobInviteReq)).resolves.toBeNull();

      const bobAdminReq = new NextRequest('http://bob.wedding.example/admin/dashboard', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${ADMIN_COOKIE}=${aliceAdminToken}`,
        },
      });
      expect((await middleware(bobAdminReq)).status).toBe(303);
      await expect(isAdminRequest(bobAdminReq)).resolves.toBe(false);

      // guest_photo_session valid on Tenant A, rejected on Tenant B across Edge, Node helper, and withApiMiddleware
      const alicePhotoToken = await signPhotoUploadSessionToken({
        v: 1,
        siteId: 'site-alice',
        subdomain: 'alice',
      });
      const alicePhotoReq = new NextRequest('http://alice.wedding.example/photos', {
        headers: {
          host: 'alice.wedding.example',
          cookie: `${GUEST_PHOTO_COOKIE}=${alicePhotoToken}`,
        },
      });
      expect((await middleware(alicePhotoReq)).status).toBe(200);
      await expect(getActivePhotoUploadSession(alicePhotoReq)).resolves.toMatchObject({
        purpose: 'photo_upload_session',
        siteId: 'site-alice',
        subdomain: 'alice',
      });

      const bobPhotoReq = new NextRequest('http://bob.wedding.example/photos', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${GUEST_PHOTO_COOKIE}=${alicePhotoToken}`,
        },
      });
      expect((await middleware(bobPhotoReq)).status).toBe(303);
      await expect(getActivePhotoUploadSession(bobPhotoReq)).resolves.toBeNull();

      const directUploadGuard = withApiMiddleware(async () =>
        NextResponse.json({ success: true }, { status: 201 })
      );
      const bobDirectUploadReq = new NextRequest(
        'http://bob.wedding.example/api/guest/photos/upload',
        {
          method: 'POST',
          headers: {
            host: 'bob.wedding.example',
            cookie: `${GUEST_PHOTO_COOKIE}=${alicePhotoToken}`,
          },
        }
      );
      expect((await directUploadGuard(bobDirectUploadReq)).status).toBe(401);

      const bobDirectInviteUploadReq = new NextRequest(
        'http://bob.wedding.example/api/guest/photos/upload',
        {
          method: 'POST',
          headers: {
            host: 'bob.wedding.example',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
          },
        }
      );
      expect((await directUploadGuard(bobDirectInviteUploadReq)).status).toBe(401);
    });

    it('rejects tokens missing subdomain/siteId claims or carrying mismatched siteId when MULTISITE_ENABLED=true, while preserving single-site tokens when MULTISITE_ENABLED=false', async () => {
      const legacySingleSiteAdmin = await signAdminToken({
        isAdmin: true,
        iat: Date.now(),
        exp: Date.now() + 60_000,
      });
      const mismatchedSiteIdAdmin = await signAdminToken({
        isAdmin: true,
        siteId: 'stale-bob-site-id',
        subdomain: 'bob',
        iat: Date.now(),
        exp: Date.now() + 60_000,
      });

      // Rejected when MULTISITE_ENABLED=true
      const bobMissingClaimsReq = new NextRequest('http://bob.wedding.example/admin/dashboard', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${ADMIN_COOKIE}=${legacySingleSiteAdmin}`,
        },
      });
      expect((await middleware(bobMissingClaimsReq)).status).toBe(303);
      await expect(isAdminRequest(bobMissingClaimsReq)).resolves.toBe(false);

      // Mismatched siteId rejected in Node even when subdomain matches
      const bobMismatchedSiteIdReq = new NextRequest('http://bob.wedding.example/api/admin/me', {
        headers: {
          host: 'bob.wedding.example',
          cookie: `${ADMIN_COOKIE}=${mismatchedSiteIdAdmin}`,
        },
      });
      await expect(isAdminRequest(bobMismatchedSiteIdReq)).resolves.toBe(false);

      // Accepted when MULTISITE_ENABLED=false
      process.env.MULTISITE_ENABLED = 'false';
      const singleSiteReq = new NextRequest('http://localhost:3000/admin/dashboard', {
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_COOKIE}=${legacySingleSiteAdmin}`,
        },
      });
      expect((await middleware(singleSiteReq)).status).toBe(200);
      await expect(isAdminRequest(singleSiteReq)).resolves.toBe(true);
    });

    it('reuses valid same-tenant cookies on re-login, mints fresh tenant-stamped cookies across tenants, and clears cross-tenant cookies on GET /api/guest/session', async () => {
      const aliceAdminToken = await signAdminToken({
        isAdmin: true,
        siteId: 'site-alice',
        subdomain: 'alice',
        iat: Date.now() - 10_000,
        exp: Date.now() + 60_000,
      });
      const aliceGuestToken = await signGuestToken({
        guest: true,
        jti: 'alice-jti-preserve',
        siteId: 'site-alice',
        subdomain: 'alice',
        iat: Date.now() - 10_000,
        exp: Date.now() + 60_000,
      });
      const aliceInviteToken = await signGuestInviteSessionToken({
        code: 'SHARED01',
        guestName: 'Jordan Guest',
        siteId: 'site-alice',
        subdomain: 'alice',
        iat: Date.now() - 10_000,
        exp: Date.now() + 60_000,
      });

      // Same-tenant re-login on alice.wedding.example preserves existing cookies
      const sameTenantAdminRes = await postAdminLogin(
        new NextRequest('http://alice.wedding.example/api/admin/login', {
          method: 'POST',
          headers: {
            host: 'alice.wedding.example',
            'content-type': 'application/json',
            cookie: `${ADMIN_COOKIE}=${aliceAdminToken}`,
          },
          body: JSON.stringify({ password: 'secret' }),
        })
      );
      expect(extractSetCookieToken(sameTenantAdminRes.headers.get('set-cookie'), ADMIN_COOKIE)).toBe(
        aliceAdminToken
      );

      const sameTenantGuestRes = await postGuestLogin(
        new NextRequest('http://alice.wedding.example/api/guest/login', {
          method: 'POST',
          headers: {
            host: 'alice.wedding.example',
            'content-type': 'application/json',
            cookie: `${GUEST_COOKIE}=${aliceGuestToken}`,
          },
          body: JSON.stringify({ passcode: 'shared-guest-passcode-123' }),
        })
      );
      expect(extractSetCookieToken(sameTenantGuestRes.headers.get('set-cookie'), GUEST_COOKIE)).toBe(
        aliceGuestToken
      );

      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-shared',
        code: 'SHARED01',
        guestName: 'Jordan Guest',
        isSample: false,
      });
      (prisma.invitationCode.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-shared',
        code: 'SHARED01',
        guestName: 'Jordan Guest',
        isSample: false,
      });

      const sameTenantValidateRes = await getValidateCode(
        new NextRequest('http://alice.wedding.example/api/registry/validate-code?code=SHARED01', {
          headers: {
            host: 'alice.wedding.example',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
          },
        })
      );
      expect(
        extractSetCookieToken(sameTenantValidateRes.headers.get('set-cookie'), GUEST_INVITE_COOKIE)
      ).toBe(aliceInviteToken);

      // GET /api/guest/session accepts Alice cookies on Alice tenant and rejects/clears on Bob tenant
      const aliceSessionRes = await getGuestSession(
        new NextRequest('http://alice.wedding.example/api/guest/session', {
          headers: {
            host: 'alice.wedding.example',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}; ${GUEST_COOKIE}=${aliceGuestToken}`,
          },
        })
      );
      expect(await aliceSessionRes.json()).toMatchObject({
        success: true,
        data: {
          status: 'invitation',
          isVerified: true,
          code: 'SHARED01',
          hasPasscodeSession: true,
        },
      });

      const bobSessionWithAliceCookiesRes = await getGuestSession(
        new NextRequest('http://bob.wedding.example/api/guest/session', {
          headers: {
            host: 'bob.wedding.example',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}; ${GUEST_COOKIE}=${aliceGuestToken}`,
          },
        })
      );
      expect(await bobSessionWithAliceCookiesRes.json()).toMatchObject({
        success: true,
        data: {
          status: 'none',
          isVerified: false,
          code: null,
          hasPasscodeSession: false,
        },
      });
      expect(bobSessionWithAliceCookiesRes.headers.get('set-cookie')).toContain(
        `${GUEST_INVITE_COOKIE}=;`
      );

      // Cross-tenant login on bob.wedding.example replaces Alice's cookies with fresh Bob tokens
      const crossTenantAdminRes = await postAdminLogin(
        new NextRequest('http://bob.wedding.example/api/admin/login', {
          method: 'POST',
          headers: {
            host: 'bob.wedding.example',
            'content-type': 'application/json',
            cookie: `${ADMIN_COOKIE}=${aliceAdminToken}`,
          },
          body: JSON.stringify({ password: 'secret' }),
        })
      );
      const mintedBobAdminToken = extractSetCookieToken(
        crossTenantAdminRes.headers.get('set-cookie'),
        ADMIN_COOKIE
      );
      expect(mintedBobAdminToken).not.toBe(aliceAdminToken);
      await expect(verifyAdminToken(mintedBobAdminToken)).resolves.toMatchObject({
        isAdmin: true,
        siteId: 'site-bob',
        subdomain: 'bob',
      });

      const crossTenantGuestRes = await postGuestLogin(
        new NextRequest('http://bob.wedding.example/api/guest/login', {
          method: 'POST',
          headers: {
            host: 'bob.wedding.example',
            'content-type': 'application/json',
            cookie: `${GUEST_COOKIE}=${aliceGuestToken}`,
          },
          body: JSON.stringify({ passcode: 'shared-guest-passcode-123' }),
        })
      );
      const mintedBobGuestToken = extractSetCookieToken(
        crossTenantGuestRes.headers.get('set-cookie'),
        GUEST_COOKIE
      );
      expect(mintedBobGuestToken).not.toBe(aliceGuestToken);
      await expect(verifyGuestToken(mintedBobGuestToken)).resolves.toMatchObject({
        guest: true,
        siteId: 'site-bob',
        subdomain: 'bob',
      });

      const crossTenantInviteLoginRes = await postGuestLogin(
        new NextRequest('http://bob.wedding.example/api/guest/login', {
          method: 'POST',
          headers: {
            host: 'bob.wedding.example',
            'content-type': 'application/json',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
          },
          body: JSON.stringify({ passcode: 'SHARED01' }),
        })
      );
      const mintedBobInviteToken = extractSetCookieToken(
        crossTenantInviteLoginRes.headers.get('set-cookie'),
        GUEST_INVITE_COOKIE
      );
      expect(mintedBobInviteToken).not.toBe(aliceInviteToken);
      await expect(verifyGuestInviteSessionToken(mintedBobInviteToken)).resolves.toMatchObject({
        code: 'SHARED01',
        siteId: 'site-bob',
        subdomain: 'bob',
      });

      const crossTenantValidateRes = await getValidateCode(
        new NextRequest('http://bob.wedding.example/api/registry/validate-code?code=SHARED01', {
          headers: {
            host: 'bob.wedding.example',
            cookie: `${GUEST_INVITE_COOKIE}=${aliceInviteToken}`,
          },
        })
      );
      const mintedBobValidateToken = extractSetCookieToken(
        crossTenantValidateRes.headers.get('set-cookie'),
        GUEST_INVITE_COOKIE
      );
      expect(mintedBobValidateToken).not.toBe(aliceInviteToken);
      await expect(verifyGuestInviteSessionToken(mintedBobValidateToken)).resolves.toMatchObject({
        code: 'SHARED01',
        siteId: 'site-bob',
        subdomain: 'bob',
      });
    });
  });

  describe('enforceActiveGuestPageSession forged x-guest-* header defenses', () => {
    it('queries InvitationCode and redirects with HTTP 303 when callers forge x-guest-gated-page: 0 or x-guest-callback-url with missing or invalid signature', async () => {
      process.env.MULTISITE_ENABLED = 'false';
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue(null);

      const revokedInviteToken = await signGuestInviteSessionToken({
        code: 'REVOKED77',
        guestName: 'Revoked Caller',
      });

      mockCookies.mockResolvedValue({
        get: (name: string) =>
          name === GUEST_INVITE_COOKIE ? { value: revokedInviteToken } : undefined,
      });

      // Forged x-guest-gated-page: 0 + tampered signature + forged callbackUrl
      mockHeaders.mockResolvedValue(
        new Headers({
          [GUEST_GATED_PAGE_HEADER]: '0',
          [GUEST_CALLBACK_URL_HEADER]: '/guest/login',
          [GUEST_HEADER_SIGNATURE_HEADER]: 'forged-invalid-hmac',
        })
      );

      let caughtError: (Error & { digest?: string }) | null = null;
      try {
        await enforceActiveGuestPageSession();
      } catch (err) {
        caughtError = err as Error & { digest?: string };
      }

      expect(prisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'REVOKED77', isSample: false },
      });
      expect(mockRedirect).toHaveBeenCalledWith('/guest/login');
      expect(caughtError?.digest).toBe('NEXT_REDIRECT;replace;/guest/login;303;');
    });
  });

  describe('generateMetadata TRUST_PROXY canonical origin gating', () => {
    it('ignores spoofed x-forwarded-host and x-forwarded-proto when TRUST_PROXY=false and honors trusted hops when TRUST_PROXY=1', async () => {
      process.env.MULTISITE_ENABLED = 'false';

      process.env.TRUST_PROXY = 'false';
      mockHeaders.mockResolvedValue(
        new Headers({
          host: 'localhost:3000',
          'x-forwarded-host': 'alice.wedding.example',
          'x-forwarded-proto': 'https',
        })
      );
      const localMeta = await generateMetadata();
      expect(localMeta.metadataBase?.toString()).toBe('http://localhost:3000/');

      process.env.TRUST_PROXY = '1';
      mockHeaders.mockResolvedValue(
        new Headers({
          host: '127.0.0.1:3000',
          'x-forwarded-host': 'spoofed.evil.org, alice.wedding.example',
          'x-forwarded-proto': 'http, https',
        })
      );
      const proxiedMeta = await generateMetadata();
      expect(proxiedMeta.metadataBase?.toString()).toBe('https://alice.wedding.example/');
    });
  });
});
