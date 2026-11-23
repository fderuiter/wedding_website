/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockGetAppConfig = jest.fn();
const mockSanitizeAppConfigForBackup = jest.fn((cfg: unknown) => cfg);
const mockUpsertAppConfig = jest.fn();
const mockCreateSnapshotVersion = jest.fn();
const mockRevalidatePath = jest.fn();
const mockIsAdminRequest = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
}));

jest.mock('@/lib/backupPersistence', () => ({
  sanitizeAppConfigForBackup: (cfg: unknown) => mockSanitizeAppConfigForBackup(cfg),
}));

jest.mock('@/core/auth/auth.server', () => {
  const actual = jest.requireActual('@/core/auth/auth.server');
  return {
    ...actual,
    isAdminRequest: (...args: unknown[]) => mockIsAdminRequest(...args),
  };
});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      upsert: (...args: unknown[]) => mockUpsertAppConfig(...args),
    },
    snapshotVersion: {
      create: (...args: unknown[]) => mockCreateSnapshotVersion(...args),
    },
  },
}));

import { GET as getPhotoQr, POST as postPhotoQr } from '../qr/route';
import { verifyPhotoQrLinkToken } from '@/core/auth/photoUploadToken';

describe('/api/admin/photos/qr Route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'admin-qr-route-test-secret-at-least-32-chars',
      GUEST_PASSCODE: 'distinct-admin-qr-passcode',
    };
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      baseUrl: 'https://wedding.example.com',
      modules: { gallery: true },
      guestPhotoQrTokenVersion: 2,
      autoApproveGuestPhotos: false,
    });
    mockUpsertAppConfig.mockImplementation(
      async ({ update }: { update: Record<string, unknown> }) => ({
        id: 'global',
        guestPhotoQrTokenVersion: update.guestPhotoQrTokenVersion ? 3 : 2,
        autoApproveGuestPhotos:
          typeof update.autoApproveGuestPhotos === 'boolean'
            ? update.autoApproveGuestPhotos
            : false,
      })
    );
    mockCreateSnapshotVersion.mockResolvedValue({ id: 'snap-1' });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects non-admin requests with HTTP 401', async () => {
    mockIsAdminRequest.mockResolvedValueOnce(false);
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr');
    const res = await getPhotoQr(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 when gallery feature module is disabled', async () => {
    mockGetAppConfig.mockResolvedValueOnce({
      id: 'global',
      modules: { gallery: false },
    });
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr');
    const res = await getPhotoQr(req);
    expect(res.status).toBe(404);
  });

  it('returns signed upload URL, tokenVersion, and autoApproveGuestPhotos on GET', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr');
    const res = await getPhotoQr(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.tokenVersion).toBe(2);
    expect(json.autoApproveGuestPhotos).toBe(false);

    const url = new URL(json.uploadUrl);
    expect(url.origin).toBe('https://wedding.example.com');
    expect(url.pathname).toBe('/photos');
    const verified = await verifyPhotoQrLinkToken(url.searchParams.get('qr'));
    expect(verified?.v).toBe(2);
  });

  it('rotates guestPhotoQrTokenVersion, records SnapshotVersion audit, and returns fresh signed URL on POST action="rotate"', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rotate' }),
    });

    const res = await postPhotoQr(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpsertAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'global' },
        update: { guestPhotoQrTokenVersion: { increment: 1 } },
      })
    );
    expect(mockCreateSnapshotVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'AppConfig',
          entityId: 'global',
          author: 'Admin',
        }),
      })
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith('/photos/slideshow');
    expect(json.tokenVersion).toBe(3);

    const verified = await verifyPhotoQrLinkToken(new URL(json.uploadUrl).searchParams.get('qr'));
    expect(verified?.v).toBe(3);
  });

  it('toggles autoApproveGuestPhotos and records SnapshotVersion audit on POST', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApproveGuestPhotos: true }),
    });

    const res = await postPhotoQr(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpsertAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'global' },
        update: { autoApproveGuestPhotos: true },
      })
    );
    expect(json.autoApproveGuestPhotos).toBe(true);
    expect(json.tokenVersion).toBe(2);
  });

  it('returns 400 when neither action nor autoApproveGuestPhotos is provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/photos/qr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await postPhotoQr(req);
    expect(res.status).toBe(400);
  });
});
