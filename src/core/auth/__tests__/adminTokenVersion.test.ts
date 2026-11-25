/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockFindUniqueAppConfig = jest.fn();
const mockFindFirstAppConfig = jest.fn();
const mockUpsertAppConfig = jest.fn();
const mockCreateSnapshotVersion = jest.fn();
const mockCountContentNode = jest.fn().mockResolvedValue(1);

jest.mock('@/lib/geocoding', () => ({
  geocodeBestMatch: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: (...args: unknown[]) => mockFindUniqueAppConfig(...args),
      findFirst: (...args: unknown[]) => mockFindFirstAppConfig(...args),
      upsert: (...args: unknown[]) => mockUpsertAppConfig(...args),
    },
    snapshotVersion: {
      create: (...args: unknown[]) => mockCreateSnapshotVersion(...args),
    },
    contentNode: {
      count: (...args: unknown[]) => mockCountContentNode(...args),
    },
  },
}));

import { POST as login } from '@/app/api/admin/login/route';
import { POST as logout } from '@/app/api/admin/logout/route';
import { GET as me } from '@/app/api/admin/me/route';
import { POST as setup } from '@/app/api/admin/setup/route';
import {
  isAdminRequest,
  signAdminToken,
  verifyAdminToken,
} from '@/core/auth/auth.server';
import { getActivePhotoUploadSession } from '@/core/auth/guestInviteSession';
import {
  GUEST_PHOTO_COOKIE,
  signPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

describe('Admin Token Epoch Revocation & Fail-Closed Photo Upload Sessions', () => {
  const originalEnv = { ...process.env };
  const baseAppConfig = {
    id: 'global',
    subdomain: null,
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    brideName: 'Alex',
    groomName: 'Taylor',
    baseUrl: 'https://wedding.example',
    weddingDate: new Date('2027-06-15T18:00:00.000Z'),
    venueName: 'Grand Hall',
    venueAddress: '100 Main St',
    venueCity: 'Chicago',
    venueState: 'IL',
    venueZip: '60601',
    latitude: 41.88,
    longitude: -87.63,
    storyText: '',
    venueDescription: '',
    travelAdvice: '',
    heroTitle: '',
    heroSubtitle: '',
    seoTitle: 'Alex & Taylor',
    seoDescription: '',
    faviconUrl: '/assets/favicon.png',
    ogImageUrl: '/images/sunset.jpg',
    seoKeywords: '',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    timezone: 'America/Chicago',
    showCountdown: true,
    showAddToCalendar: true,
    guestPhotoQrTokenVersion: 1,
    adminTokenVersion: 1,
    setupCompleted: true,
    features: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetRateLimitsForTesting();
    process.env = {
      ...originalEnv,
      // Native scrypt hash for 'secret'
      ADMIN_PASSWORD:
        'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==',
      GUEST_SESSION_SECRET: 'photo-session-fail-closed-secret-32chars!!',
      GUEST_PASSCODE: 'wedding2026',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stamps v on signAdminToken, enforces AppConfig.adminTokenVersion in Node, fails closed on DB errors or invalid version values, and skips DB in edgeOnly mode', async () => {
    const v1Token = await signAdminToken({ isAdmin: true, iat: Date.now() });
    expect((await verifyAdminToken(v1Token))?.v).toBe(1);

    const v2Token = await signAdminToken({ isAdmin: true, v: 2, iat: Date.now() });
    expect((await verifyAdminToken(v2Token))?.v).toBe(2);

    const makeReq = (token: string) =>
      new NextRequest('http://localhost:3000/api/admin/me', {
        headers: { cookie: `admin_auth=${token}` },
      });

    mockFindUniqueAppConfig.mockResolvedValue({ adminTokenVersion: 2 });
    await expect(isAdminRequest(makeReq(v1Token))).resolves.toBe(false);
    await expect(isAdminRequest(makeReq(v2Token))).resolves.toBe(true);

    // Edge verification stays stateless and never queries Prisma
    mockFindUniqueAppConfig.mockClear();
    await expect(isAdminRequest(makeReq(v1Token), { edgeOnly: true })).resolves.toBe(true);
    expect(mockFindUniqueAppConfig).not.toHaveBeenCalled();

    // Prisma exceptions and malformed DB values fail closed
    mockFindUniqueAppConfig.mockRejectedValueOnce(new Error('Database connection lost'));
    await expect(isAdminRequest(makeReq(v2Token))).resolves.toBe(false);

    mockFindUniqueAppConfig.mockResolvedValueOnce({ adminTokenVersion: 0 });
    await expect(isAdminRequest(makeReq(v1Token))).resolves.toBe(false);
  });

  it('increments AppConfig.adminTokenVersion on authenticated POST /api/admin/logout while leaving unauthenticated or replayed logout calls inert', async () => {
    let persistedVersion = 1;
    mockFindUniqueAppConfig.mockImplementation(async () => ({
      ...baseAppConfig,
      adminTokenVersion: persistedVersion,
    }));
    mockUpsertAppConfig.mockImplementation(async ({ update, create }) => {
      if (update?.adminTokenVersion?.increment) {
        persistedVersion += update.adminTokenVersion.increment;
      } else if (typeof create?.adminTokenVersion === 'number') {
        persistedVersion = create.adminTokenVersion;
      }
      return { ...baseAppConfig, adminTokenVersion: persistedVersion };
    });

    // 1. Login mints v=1 cookie
    const loginRes1 = await login(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secret' }),
      })
    );
    expect(loginRes1.status).toBe(200);
    const tokenV1 = loginRes1.cookies.get('admin_auth')?.value ?? '';
    expect((await verifyAdminToken(tokenV1))?.v).toBe(1);
    mockUpsertAppConfig.mockClear();

    // 2. Unauthenticated logout clears cookie without incrementing adminTokenVersion
    const unauthLogoutRes = await logout(
      new NextRequest('http://localhost/api/admin/logout', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
      })
    );
    expect(unauthLogoutRes.status).toBe(200);
    expect(persistedVersion).toBe(1);
    expect(mockUpsertAppConfig).not.toHaveBeenCalled();

    // Active v=1 session remains valid
    const meValidRes = await me(
      new NextRequest('http://localhost/api/admin/me', {
        headers: { cookie: `admin_auth=${tokenV1}` },
      })
    );
    expect((await meValidRes.json()).isAdmin).toBe(true);

    // 3. Authenticated logout advances version (1 -> 2) and immediately revokes tokenV1
    const authLogoutRes = await logout(
      new NextRequest('http://localhost/api/admin/logout', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          cookie: `admin_auth=${tokenV1}`,
        },
      })
    );
    expect(authLogoutRes.status).toBe(200);
    expect(persistedVersion).toBe(2);
    expect(mockUpsertAppConfig).toHaveBeenCalledTimes(1);

    const meRevokedRes = await me(
      new NextRequest('http://localhost/api/admin/me', {
        headers: { cookie: `admin_auth=${tokenV1}` },
      })
    );
    expect((await meRevokedRes.json()).isAdmin).toBe(false);

    // Replaying revoked v=1 cookie cannot advance adminTokenVersion again
    const replayLogoutRes = await logout(
      new NextRequest('http://localhost/api/admin/logout', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          cookie: `admin_auth=${tokenV1}`,
        },
      })
    );
    expect(replayLogoutRes.status).toBe(200);
    expect(persistedVersion).toBe(2);

    // 4. Subsequent login with stale v=1 cookie does not reuse tokenV1; mints fresh v=2 token
    const loginRes2 = await login(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `admin_auth=${tokenV1}`,
        },
        body: JSON.stringify({ password: 'secret' }),
      })
    );
    expect(loginRes2.status).toBe(200);
    const tokenV2 = loginRes2.cookies.get('admin_auth')?.value ?? '';
    expect(tokenV2).not.toBe(tokenV1);
    expect((await verifyAdminToken(tokenV2))?.v).toBe(2);
  });

  it('stamps AppConfig.adminTokenVersion into admin_auth cookies across /api/admin/setup step-1 and toggle flows', async () => {
    const uninitializedV3 = {
      ...baseAppConfig,
      partner1Name: '',
      partner2Name: '',
      brideName: '',
      groomName: '',
      venueName: '',
      adminTokenVersion: 3,
      setupCompleted: false,
    };
    mockFindUniqueAppConfig.mockResolvedValue(uninitializedV3);

    const step1Res = await setup(
      new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secret' }),
      })
    );
    expect(step1Res.status).toBe(200);
    expect(
      (await verifyAdminToken(step1Res.cookies.get('admin_auth')?.value ?? ''))?.v
    ).toBe(3);

    const initializedV4 = { ...baseAppConfig, adminTokenVersion: 4 };
    mockFindUniqueAppConfig.mockResolvedValue(initializedV4);
    mockUpsertAppConfig.mockResolvedValue(initializedV4);
    const tokenV4 = await signAdminToken({ isAdmin: true, v: 4, iat: Date.now() });

    const toggleRes = await setup(
      new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `admin_auth=${tokenV4}`,
        },
        body: JSON.stringify({ password: 'secret', setupCompleted: true }),
      })
    );
    expect(toggleRes.status).toBe(200);
    expect(
      (await verifyAdminToken(toggleRes.cookies.get('admin_auth')?.value ?? ''))?.v
    ).toBe(4);
  });

  it('fails closed and rejects guest_photo_session cookies when Prisma throws or omits AppConfig / guestPhotoQrTokenVersion', async () => {
    const v1PhotoSession = await signPhotoUploadSessionToken({ v: 1 });
    const makePhotoReq = () =>
      new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          cookie: `${GUEST_PHOTO_COOKIE}=${v1PhotoSession}`,
        },
      });

    mockFindUniqueAppConfig.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(getActivePhotoUploadSession(makePhotoReq())).resolves.toBeNull();

    mockFindUniqueAppConfig.mockResolvedValueOnce(null);
    await expect(getActivePhotoUploadSession(makePhotoReq())).resolves.toBeNull();

    mockFindUniqueAppConfig.mockResolvedValueOnce({});
    await expect(getActivePhotoUploadSession(makePhotoReq())).resolves.toBeNull();

    mockFindUniqueAppConfig.mockResolvedValueOnce({ guestPhotoQrTokenVersion: 1 });
    await expect(getActivePhotoUploadSession(makePhotoReq())).resolves.toEqual(
      expect.objectContaining({ purpose: 'photo_upload_session', v: 1 })
    );
  });
});
