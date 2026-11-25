/** @jest-environment node */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const mockGetAppConfig = jest.fn();
const mockFindManyContentNode = jest.fn();
const mockFindManyMedia = jest.fn();
const mockFindUniqueInvitation = jest.fn();
const mockFindUniqueAppConfig = jest.fn();
const mockFindFirstAppConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    contentNode: {
      findMany: (...args: unknown[]) => mockFindManyContentNode(...args),
    },
    media: {
      findMany: (...args: unknown[]) => mockFindManyMedia(...args),
    },
    invitationCode: {
      findUnique: (...args: unknown[]) => mockFindUniqueInvitation(...args),
    },
    appConfig: {
      findUnique: (...args: unknown[]) => mockFindUniqueAppConfig(...args),
      findFirst: (...args: unknown[]) => mockFindFirstAppConfig(...args),
    },
  },
}));

import { GET, HEAD } from '../[...path]/route';
import { middleware } from '@/middleware';
import { CSP_NONCE_HEADER } from '@/lib/csp';
import { resetStorageProvider } from '@/utils/storage';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { GUEST_INVITE_COOKIE, signGuestInviteSessionToken } from '@/core/auth/guestInviteToken';
import { GUEST_PHOTO_COOKIE, signPhotoUploadSessionToken } from '@/core/auth/photoUploadToken';

describe('Uploads Serving Route (/api/uploads/[...path]) — Auth, Moderation, Caching, & S3 Streaming', () => {
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
  const testSubdirName = `__test_stream_${crypto.randomBytes(6).toString('hex')}`;
  const testSubdirPath = path.join(uploadsRoot, testSubdirName);
  const photosDirPath = path.join(uploadsRoot, 'photos');
  const createdPhotoFiles: string[] = [];
  const originalEnv = { ...process.env };

  let adminCookieHeader: string;
  let guestCookieHeader: string;
  let inviteCookieHeader: string;
  let photoCookieHeader: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetStorageProvider();
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'uploads-route-test-secret-at-least-32-characters',
      GUEST_PASSCODE: 'distinct-uploads-route-passcode',
    };
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_PUBLIC_URL;

    fs.mkdirSync(testSubdirPath, { recursive: true });
    fs.mkdirSync(photosDirPath, { recursive: true });

    const adminToken = await signAdminToken({ isAdmin: true, iat: Date.now() });
    adminCookieHeader = `${ADMIN_COOKIE}=${adminToken}`;

    const guestToken = await signGuestToken({ guest: true, exp: Date.now() + 3600_000 });
    guestCookieHeader = `${GUEST_COOKIE}=${guestToken}`;

    const inviteToken = await signGuestInviteSessionToken({
      code: 'DARCY26',
      guestName: 'Darcy Family',
    });
    inviteCookieHeader = `${GUEST_INVITE_COOKIE}=${inviteToken}`;

    const photoToken = await signPhotoUploadSessionToken({ v: 1 });
    photoCookieHeader = `${GUEST_PHOTO_COOKIE}=${photoToken}`;

    mockGetAppConfig.mockResolvedValue({
      ogImageUrl: '/images/sunset-embrace.jpg',
      faviconUrl: '/assets/favicon.png',
      brandLogoUrl: null,
      heroImageUrl: null,
      brandWatermarkUrl: null,
      badgeGraphicUrl: null,
      guestPhotoQrTokenVersion: 1,
    });
    mockFindManyContentNode.mockResolvedValue([]);
    mockFindManyMedia.mockResolvedValue([]);
    mockFindUniqueInvitation.mockResolvedValue({
      id: 'inv-1',
      code: 'DARCY26',
      guestName: 'Darcy Family',
      isSample: false,
    });
    mockFindUniqueAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 1 });
    mockFindFirstAppConfig.mockResolvedValue({ guestPhotoQrTokenVersion: 1 });
  });

  afterEach(() => {
    fs.rmSync(testSubdirPath, { recursive: true, force: true });
    while (createdPhotoFiles.length > 0) {
      const filePath = createdPhotoFiles.pop();
      if (filePath) {
        fs.rmSync(filePath, { force: true });
      }
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createTestPhotoFile(filename: string, payload: Buffer): string {
    const uniqueName = `${testSubdirName}-${filename}`;
    const fullPath = path.join(photosDirPath, uniqueName);
    fs.writeFileSync(fullPath, payload);
    createdPhotoFiles.push(fullPath);
    return uniqueName;
  }

  it('returns HTTP 401 on unauthenticated GET and HEAD to /uploads/photos/* and non-allowlisted /uploads/* without leaking file existence', async () => {
    const existingPhotoName = createTestPhotoFile('secret.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(testSubdirPath, 'private-doc.png'), Buffer.from([1, 2, 3]));

    for (const [segments, urlPath] of [
      [['photos', existingPhotoName], `/uploads/photos/${existingPhotoName}`],
      [['photos', 'missing-does-not-exist.jpg'], '/api/uploads/photos/missing-does-not-exist.jpg'],
      [[testSubdirName, 'private-doc.png'], `/uploads/${testSubdirName}/private-doc.png`],
      [[testSubdirName, 'nonexistent.png'], `/uploads/${testSubdirName}/nonexistent.png`],
    ] as Array<[string[], string]>) {
      const getRes = await GET(new NextRequest(`http://localhost:3000${urlPath}`), {
        params: Promise.resolve({ path: segments }),
      });
      expect(getRes.status).toBe(401);
      expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(getRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
      expect(getRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
      expect(getRes.headers.get('Vary')).toBe('Cookie');
      expect(await getRes.json()).toEqual({ error: 'Unauthorized' });

      const headRes = await HEAD(
        new NextRequest(`http://localhost:3000${urlPath}`, { method: 'HEAD' }),
        { params: Promise.resolve({ path: segments }) }
      );
      expect(headRes.status).toBe(401);
      expect(headRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
      expect(headRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
      expect((await headRes.arrayBuffer()).byteLength).toBe(0);
    }
  });

  it('allows unauthenticated GET and HEAD reads exclusively for uploaded AppConfig.ogImageUrl and AppConfig.faviconUrl assets', async () => {
    const ogBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const favBytes = Buffer.from([0x00, 0x00, 0x01, 0x00]);
    fs.writeFileSync(path.join(testSubdirPath, 'og-custom.png'), ogBytes);
    fs.writeFileSync(path.join(testSubdirPath, 'fav-custom.ico'), favBytes);
    fs.writeFileSync(path.join(testSubdirPath, 'other-asset.png'), ogBytes);

    mockGetAppConfig.mockResolvedValue({
      ogImageUrl: `/uploads/${testSubdirName}/og-custom.png`,
      faviconUrl: `https://wedding.example.com/uploads/${testSubdirName}/fav-custom.ico?v=2`,
    });

    const ogRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/og-custom.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'og-custom.png'] }) }
    );
    expect(ogRes.status).toBe(200);
    expect(ogRes.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(ogRes.headers.get('Vary')).toBe('Cookie');
    expect(Buffer.from(await ogRes.arrayBuffer())).toEqual(ogBytes);

    const favHeadRes = await HEAD(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/fav-custom.ico`, {
        method: 'HEAD',
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'fav-custom.ico'] }) }
    );
    expect(favHeadRes.status).toBe(200);
    expect(favHeadRes.headers.get('Content-Type')).toBe('image/x-icon');
    expect(favHeadRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(favHeadRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(favHeadRes.headers.get('Content-Disposition')).toBeNull();
    expect(favHeadRes.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(favHeadRes.headers.get('Vary')).toBe('Cookie');

    const otherRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/other-asset.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'other-asset.png'] }) }
    );
    expect(otherRes.status).toBe(401);
  });

  it('returns HTTP 404 to authenticated guests for PENDING, REJECTED, hidden, or orphaned photos while returning HTTP 200 with Cache-Control: private, no-store to admins', async () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const pendingName = createTestPhotoFile('pending.jpg', payload);
    const rejectedName = createTestPhotoFile('rejected.jpg', payload);
    const orphanName = createTestPhotoFile('orphan.jpg', payload);
    const approvedName = createTestPhotoFile('approved.jpg', payload);

    mockFindManyContentNode.mockImplementation(async (query: { where?: { OR?: Array<{ data?: { equals?: string } }> } }) => {
      const targetUrl = query?.where?.OR?.[0]?.data?.equals;
      if (targetUrl === `/uploads/photos/${pendingName}`) {
        return [{ data: { url: targetUrl, status: 'PENDING', isVisible: false } }];
      }
      if (targetUrl === `/uploads/photos/${rejectedName}`) {
        return [{ data: { url: targetUrl, status: 'REJECTED', isVisible: false } }];
      }
      if (targetUrl === `/uploads/photos/${approvedName}`) {
        return [{ data: { url: targetUrl, status: 'APPROVED', isVisible: true } }];
      }
      return [];
    });

    // Authenticated guests (passcode, invite session, and QR photo session) get 404 on PENDING, REJECTED, and orphaned photos
    for (const cookie of [guestCookieHeader, inviteCookieHeader, photoCookieHeader]) {
      for (const blockedName of [pendingName, rejectedName, orphanName]) {
        const guestRes = await GET(
          new NextRequest(`http://localhost:3000/uploads/photos/${blockedName}`, {
            headers: { cookie },
          }),
          { params: Promise.resolve({ path: ['photos', blockedName] }) }
        );
        expect(guestRes.status).toBe(404);
      }

      // Approved visible photo returns 200 with private, no-cache and Vary: Cookie
      const approvedRes = await GET(
        new NextRequest(`http://localhost:3000/uploads/photos/${approvedName}`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ path: ['photos', approvedName] }) }
      );
      expect(approvedRes.status).toBe(200);
      expect(approvedRes.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(approvedRes.headers.get('Vary')).toBe('Cookie');
      expect(approvedRes.headers.get('Cache-Control')).not.toContain('public');
      expect(approvedRes.headers.get('Cache-Control')).not.toContain('immutable');
    }

    // Admin receives 200 with Cache-Control: private, no-store on PENDING photo preview
    const adminPendingRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/photos/${pendingName}`, {
        headers: { cookie: adminCookieHeader },
      }),
      { params: Promise.resolve({ path: ['photos', pendingName] }) }
    );
    expect(adminPendingRes.status).toBe(200);
    expect(adminPendingRes.headers.get('Cache-Control')).toBe('private, no-store');
    expect(adminPendingRes.headers.get('Vary')).toBe('Cookie');
    expect(Buffer.from(await adminPendingRes.arrayBuffer())).toEqual(payload);
  });

  it('rejects revoked guest_invite_session and rotated guest_photo_session cookies with HTTP 401', async () => {
    const approvedName = createTestPhotoFile('approved-revoked.jpg', Buffer.from([1, 2, 3]));
    mockFindManyContentNode.mockResolvedValue([
      { data: { url: `/uploads/photos/${approvedName}`, status: 'APPROVED', isVisible: true } },
    ]);

    // Revoke invitation code in DB
    mockFindUniqueInvitation.mockResolvedValueOnce(null);
    const revokedInviteRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/photos/${approvedName}`, {
        headers: { cookie: inviteCookieHeader },
      }),
      { params: Promise.resolve({ path: ['photos', approvedName] }) }
    );
    expect(revokedInviteRes.status).toBe(401);

    // Rotate QR token version in DB
    mockFindUniqueAppConfig.mockResolvedValueOnce({ guestPhotoQrTokenVersion: 2 });
    const rotatedPhotoRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/photos/${approvedName}`, {
        headers: { cookie: photoCookieHeader },
      }),
      { params: Promise.resolve({ path: ['photos', approvedName] }) }
    );
    expect(rotatedPhotoRes.status).toBe(401);
  });

  it('streams PNG, WebP, and ICO files for authorized sessions and streams S3 objects when S3 is configured', async () => {
    const pngPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webpPayload = Buffer.from('RIFF\x0c\x00\x00\x00WEBP', 'binary');
    const icoPayload = Buffer.from([0x00, 0x00, 0x01, 0x00]);

    fs.writeFileSync(path.join(testSubdirPath, 'fresh.png'), pngPayload);
    fs.writeFileSync(path.join(testSubdirPath, 'gallery.webp'), webpPayload);
    fs.writeFileSync(path.join(testSubdirPath, 'favicon.ico'), icoPayload);

    mockFindManyMedia.mockImplementation(async () => [
      { id: 'm-1', url: `/uploads/${testSubdirName}/fresh.png` },
      { id: 'm-2', url: `/uploads/${testSubdirName}/gallery.webp` },
      { id: 'm-3', url: `/uploads/${testSubdirName}/favicon.ico` },
    ]);

    const pngRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/fresh.png`, {
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'fresh.png'] }) }
    );
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get('Content-Type')).toBe('image/png');
    expect(pngRes.headers.get('Content-Length')).toBe(String(pngPayload.length));
    expect(pngRes.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(pngRes.headers.get('Vary')).toBe('Cookie');
    expect(pngRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(pngRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(pngRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(pngRes.headers.get('Content-Disposition')).toBeNull();
    expect(Buffer.from(await pngRes.arrayBuffer())).toEqual(pngPayload);

    const headRes = await HEAD(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/favicon.ico`, {
        method: 'HEAD',
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'favicon.ico'] }) }
    );
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get('Content-Type')).toBe('image/x-icon');
    expect(headRes.headers.get('Content-Length')).toBe(String(icoPayload.length));
    expect(headRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(headRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect((await headRes.arrayBuffer()).byteLength).toBe(0);

    // S3 streaming via getStorageProvider().openReadStream ignores untrusted S3 ContentType metadata
    process.env.S3_BUCKET = 'wedding-s3-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 's3-key';
    process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
    resetStorageProvider();

    mockFindManyContentNode.mockResolvedValueOnce([
      { data: { url: '/uploads/photos/s3-streamed.webp', status: 'APPROVED', isVisible: true } },
    ]);

    const s3SendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBeInstanceOf(GetObjectCommand);
        return {
          ContentLength: webpPayload.byteLength,
          ContentType: 'text/html; charset=utf-8',
          LastModified: new Date('2026-07-01T00:00:00Z'),
          Body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(webpPayload));
              controller.close();
            },
          }),
        } as never;
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBeInstanceOf(HeadObjectCommand);
        return {
          ContentLength: webpPayload.byteLength,
          ContentType: 'text/html',
          LastModified: new Date('2026-07-01T00:00:00Z'),
        } as never;
      });

    const s3GetRes = await GET(
      new NextRequest('http://localhost:3000/uploads/photos/s3-streamed.webp', {
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: ['photos', 's3-streamed.webp'] }) }
    );
    expect(s3GetRes.status).toBe(200);
    expect(s3GetRes.headers.get('Content-Type')).toBe('image/webp');
    expect(s3GetRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(s3GetRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(s3GetRes.headers.get('Content-Disposition')).toBeNull();
    expect(s3GetRes.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(s3GetRes.headers.get('Vary')).toBe('Cookie');
    expect(Buffer.from(await s3GetRes.arrayBuffer())).toEqual(webpPayload);

    mockFindManyContentNode.mockResolvedValueOnce([
      { data: { url: '/uploads/photos/s3-streamed.webp', status: 'APPROVED', isVisible: true } },
    ]);
    const s3HeadRes = await HEAD(
      new NextRequest('http://localhost:3000/uploads/photos/s3-streamed.webp', {
        method: 'HEAD',
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: ['photos', 's3-streamed.webp'] }) }
    );
    expect(s3HeadRes.status).toBe(200);
    expect(s3HeadRes.headers.get('Content-Type')).toBe('image/webp');
    expect(s3HeadRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(s3HeadRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(s3HeadRes.headers.get('Content-Length')).toBe(String(webpPayload.byteLength));
    expect((await s3HeadRes.arrayBuffer()).byteLength).toBe(0);

    s3SendSpy.mockRestore();
  });

  it('rejects dot-dot, percent-encoded, backslash, and null-byte path traversal with HTTP 400 and nosniff', async () => {
    const traversalCases: Array<{ rawUrl: string; segments: string[] }> = [
      { rawUrl: 'http://localhost:3000/uploads/..%2fpackage.json', segments: ['..', 'package.json'] },
      { rawUrl: 'http://localhost:3000/uploads/%2e%2e/package.json', segments: ['..', 'package.json'] },
      { rawUrl: 'http://localhost:3000/uploads/..%5cpackage.json', segments: ['..\\package.json'] },
      { rawUrl: 'http://localhost:3000/uploads/evil%00.png', segments: ['evil\0.png'] },
      { rawUrl: 'http://localhost:3000/api/uploads/..%2f.env', segments: ['../.env'] },
    ];

    for (const testCase of traversalCases) {
      const res = await GET(
        new NextRequest(testCase.rawUrl, { headers: { cookie: adminCookieHeader } }),
        { params: Promise.resolve({ path: testCase.segments }) }
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('rejects symbolic links escaping uploads or pointing within uploads with HTTP 400 and nosniff', async () => {
    const validTarget = path.join(testSubdirPath, 'real.png');
    fs.writeFileSync(validTarget, Buffer.from([1, 2, 3, 4]));

    const escapeSymlink = path.join(testSubdirPath, 'escape-pkg.png');
    fs.symlinkSync(path.join(process.cwd(), 'package.json'), escapeSymlink);

    const internalSymlink = path.join(testSubdirPath, 'alias.png');
    fs.symlinkSync(validTarget, internalSymlink);

    const escapeRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/escape-pkg.png`, {
        headers: { cookie: adminCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'escape-pkg.png'] }) }
    );
    expect(escapeRes.status).toBe(400);
    expect(escapeRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const internalRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/alias.png`, {
        headers: { cookie: adminCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'alias.png'] }) }
    );
    expect(internalRes.status).toBe(400);
    expect(internalRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns HTTP 404 with X-Content-Type-Options: nosniff for missing files and directories', async () => {
    const missingRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/does-not-exist.png`, {
        headers: { cookie: adminCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'does-not-exist.png'] }) }
    );
    expect(missingRes.status).toBe(404);
    expect(missingRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const dirRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}`, {
        headers: { cookie: adminCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName] }) }
    );
    expect(dirRes.status).toBe(404);
    expect(dirRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(dirRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(dirRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });

  it('forces Content-Disposition: attachment on fallback application/octet-stream uploads (local & S3) and prevents duplicate CSP headers from middleware', async () => {
    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    fs.writeFileSync(path.join(testSubdirPath, 'legacy-vector.svg'), svgPayload);
    mockFindManyMedia.mockResolvedValue([
      { id: 'm-svg', url: `/uploads/${testSubdirName}/legacy-vector.svg` },
    ]);

    const localFallbackRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/legacy-vector.svg`, {
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'legacy-vector.svg'] }) }
    );
    expect(localFallbackRes.status).toBe(200);
    expect(localFallbackRes.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(localFallbackRes.headers.get('Content-Disposition')).toBe('attachment');
    expect(localFallbackRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(localFallbackRes.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');

    // S3 fallback stream with malicious ContentType metadata must still serve application/octet-stream + attachment
    process.env.S3_BUCKET = 'wedding-s3-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 's3-key';
    process.env.S3_SECRET_ACCESS_KEY = 's3-secret';
    resetStorageProvider();

    const s3SendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({
      ContentLength: svgPayload.byteLength,
      ContentType: 'image/svg+xml',
      LastModified: new Date('2026-07-02T00:00:00Z'),
      Body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(svgPayload));
          controller.close();
        },
      }),
    } as never);

    const s3FallbackRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/legacy-vector.svg`, {
        headers: { cookie: guestCookieHeader },
      }),
      { params: Promise.resolve({ path: [testSubdirName, 'legacy-vector.svg'] }) }
    );
    expect(s3FallbackRes.status).toBe(200);
    expect(s3FallbackRes.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(s3FallbackRes.headers.get('Content-Disposition')).toBe('attachment');
    expect(s3FallbackRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    s3SendSpy.mockRestore();

    // Middleware emits nonced CSP + x-nonce on page routes, while skipping /uploads/* and /api/uploads/*
    const pageMwRes = await middleware(
      new NextRequest('http://localhost:3000/guest/login', {
        headers: { host: 'localhost:3000' },
      })
    );
    const pageNonce = pageMwRes.headers.get(CSP_NONCE_HEADER);
    expect(pageNonce).toBeTruthy();
    expect(pageMwRes.headers.get('Content-Security-Policy')).toContain(`'nonce-${pageNonce}'`);

    for (const uploadUrl of [
      `http://localhost:3000/uploads/${testSubdirName}/legacy-vector.svg`,
      `http://localhost:3000/api/uploads/${testSubdirName}/legacy-vector.svg`,
      'http://localhost:3000/uploads/photos/approved.jpg',
    ]) {
      const uploadMwRes = await middleware(
        new NextRequest(uploadUrl, {
          headers: { host: 'localhost:3000', cookie: guestCookieHeader },
        })
      );
      expect(uploadMwRes.headers.get(CSP_NONCE_HEADER)).toBeNull();
      expect(uploadMwRes.headers.get('Content-Security-Policy')).toBeNull();
    }
  });
});
