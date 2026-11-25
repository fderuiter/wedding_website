/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockGetAppConfig = jest.fn();
const mockSanitizeImage = jest.fn();
const mockStorageUpload = jest.fn();
const mockStorageDelete = jest.fn();
const mockCreateMedia = jest.fn();
const mockCreateContentNode = jest.fn();
const mockFindFirstAppConfig = jest.fn();
const mockFindUniqueAppConfig = jest.fn();
const mockRevalidatePath = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
}));

jest.mock('@/utils/imageProcessor', () => ({
  sanitizeImage: (...args: unknown[]) => mockSanitizeImage(...args),
}));

jest.mock('@/utils/storage', () => ({
  getStorageProvider: () => ({
    upload: (...args: unknown[]) => mockStorageUpload(...args),
    delete: (...args: unknown[]) => mockStorageDelete(...args),
  }),
}));

jest.mock('@/features/media', () => ({
  mediaRepository: {
    createMedia: (...args: unknown[]) => mockCreateMedia(...args),
  },
}));

jest.mock('@/features/content', () => ({
  contentRepository: {
    createNode: (...args: unknown[]) => mockCreateContentNode(...args),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: (...args: unknown[]) => mockFindUniqueAppConfig(...args),
      findFirst: (...args: unknown[]) => mockFindFirstAppConfig(...args),
    },
  },
}));

import { POST as uploadGuestPhoto } from '../route';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import {
  GUEST_PHOTO_COOKIE,
  signPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import { createVerifiedSocketIpHeaders } from '@/lib/socket-ip-boundary.js';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

describe('POST /api/guest/photos/upload (Scoped Auth, Sanitization, & Auto-Approval)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'upload-route-test-secret-at-least-32-characters',
      GUEST_PASSCODE: 'distinct-upload-passcode',
    };
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      modules: { gallery: true },
      autoApproveGuestPhotos: false,
      guestPhotoQrTokenVersion: 1,
    });
    mockFindUniqueAppConfig.mockResolvedValue({
      guestPhotoQrTokenVersion: 1,
    });
    mockFindFirstAppConfig.mockResolvedValue({
      guestPhotoQrTokenVersion: 1,
    });
    mockSanitizeImage.mockResolvedValue(
      new File([Buffer.from('sanitized-jpeg-bytes')], 'sanitized.jpg', { type: 'image/jpeg' })
    );
    mockStorageUpload.mockResolvedValue({
      url: '/uploads/photos/sanitized.jpg',
    });
    mockCreateMedia.mockResolvedValue({
      id: 'media-123',
      url: '/uploads/photos/sanitized.jpg',
      altText: 'Sparkler Sendoff',
      isDecorative: false,
      createdAt: new Date('2026-06-20T22:00:00Z'),
    });
    mockCreateContentNode.mockImplementation(async (input: { data: Record<string, unknown> }) => ({
      id: 'node-456',
      type: 'Photo',
      tags: ['gallery', 'guest-upload'],
      data: input.data,
    }));
  });

  afterAll(() => {
    resetRateLimitsForTesting();
    process.env = originalEnv;
  });

  async function buildScopedUploadRequest(formData: FormData, version = 1): Promise<NextRequest> {
    const token = await signPhotoUploadSessionToken({ v: version });
    const req = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        cookie: `${GUEST_PHOTO_COOKIE}=${token}`,
      },
    });
    return Object.assign(req, {
      formData: async () => formData,
    });
  }

  it('records status PENDING and isVisible false when autoApproveGuestPhotos is disabled', async () => {
    const formData = new FormData();
    formData.append(
      'files',
      new File([Buffer.from('raw-image-bytes')], 'sparklers.jpg', { type: 'image/jpeg' })
    );
    formData.append('uploaderName', 'Cousin Sam');
    formData.append('caption', 'Sparkler Sendoff');

    const req = await buildScopedUploadRequest(formData);
    const res = await uploadGuestPhoto(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockSanitizeImage).toHaveBeenCalledTimes(1);
    expect(mockCreateContentNode).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        data: expect.objectContaining({
          status: 'PENDING',
          isVisible: false,
          uploaderName: 'Cousin Sam',
          caption: 'Sparkler Sendoff',
        }),
      }),
      'Cousin Sam'
    );
    expect(mockRevalidatePath).not.toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toEqual(
      expect.objectContaining({
        id: 'media-123',
        nodeId: 'node-456',
        status: 'PENDING',
        isVisible: false,
      })
    );
    expect('url' in json.data[0]).toBe(false);
  });

  it('records status APPROVED, isVisible true, and revalidates gallery/slideshow when autoApproveGuestPhotos is enabled', async () => {
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      modules: { gallery: true },
      autoApproveGuestPhotos: true,
      guestPhotoQrTokenVersion: 1,
    });

    const formData = new FormData();
    formData.append(
      'files',
      new File([Buffer.from('raw-heic-bytes')], 'IMG_9999.HEIC', { type: 'image/heic' })
    );
    formData.append('uploaderName', 'Aunt Clara');
    formData.append('caption', 'First Dance!');

    const req = await buildScopedUploadRequest(formData);
    const res = await uploadGuestPhoto(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(mockSanitizeImage).toHaveBeenCalledTimes(1);
    expect(mockCreateContentNode).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          isVisible: true,
          uploaderName: 'Aunt Clara',
          caption: 'First Dance!',
        }),
      }),
      'Aunt Clara'
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith('/photos');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/photos/slideshow');
    expect(json.data[0]).toEqual(
      expect.objectContaining({
        url: '/uploads/photos/sanitized.jpg',
        status: 'APPROVED',
        isVisible: true,
      })
    );
  });

  it('preserves 10 MB file size rejection even when autoApproveGuestPhotos is enabled', async () => {
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      modules: { gallery: true },
      autoApproveGuestPhotos: true,
      guestPhotoQrTokenVersion: 1,
    });

    const formData = new FormData();
    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 512);
    formData.append(
      'files',
      new File([oversizedBytes], 'too-big.jpg', { type: 'image/jpeg' })
    );

    const req = await buildScopedUploadRequest(formData);
    const res = await uploadGuestPhoto(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/exceeds.*10\s*MB limit/i);
    expect(mockSanitizeImage).not.toHaveBeenCalled();
    expect(mockCreateContentNode).not.toHaveBeenCalled();
  });

  it('rejects rotated photo-scoped sessions with HTTP 401', async () => {
    mockFindUniqueAppConfig.mockResolvedValue({
      guestPhotoQrTokenVersion: 3,
    });

    const formData = new FormData();
    formData.append(
      'files',
      new File([Buffer.from('raw-bytes')], 'dance.jpg', { type: 'image/jpeg' })
    );

    const rotatedReq = await buildScopedUploadRequest(formData, 1);
    const rotatedRes = await uploadGuestPhoto(rotatedReq);
    expect(rotatedRes.status).toBe(401);
  });

  it('caps per-IP uploads at 20 requests per minute across rotated guest_auth jti tokens', async () => {
    const buildGuestJtiUploadRequest = async (ip: string, jti: string): Promise<NextRequest> => {
      const token = await signGuestToken({ guest: true, jti });
      const formData = new FormData();
      formData.append(
        'files',
        new File([Buffer.from('raw-image-bytes')], 'party.jpg', { type: 'image/jpeg' })
      );
      const req = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders(ip, {
          host: 'localhost:3000',
          cookie: `${GUEST_COOKIE}=${token}`,
        }),
      });
      return Object.assign(req, {
        formData: async () => formData,
      });
    };

    // Rotate a brand-new guest_auth jti on every request so per-session limit (15) is never hit
    for (let i = 1; i <= 20; i += 1) {
      const req = await buildGuestJtiUploadRequest('203.0.113.44', `rotated-jti-${i}`);
      const res = await uploadGuestPhoto(req);
      expect(res.status).toBe(201);
    }
    expect(mockSanitizeImage).toHaveBeenCalledTimes(20);

    // 21st request from the same IP with another fresh jti is blocked by ipLimit: 20
    const blockedReq = await buildGuestJtiUploadRequest('203.0.113.44', 'rotated-jti-21');
    const blockedRes = await uploadGuestPhoto(blockedReq);
    const blockedJson = await blockedRes.json();
    expect(blockedRes.status).toBe(429);
    expect(blockedJson.success).toBe(false);
    expect(mockSanitizeImage).toHaveBeenCalledTimes(20);

    // A distinct client IP remains unaffected
    const otherIpReq = await buildGuestJtiUploadRequest('203.0.113.45', 'distinct-ip-jti-1');
    const otherIpRes = await uploadGuestPhoto(otherIpReq);
    expect(otherIpRes.status).toBe(201);
    expect(mockSanitizeImage).toHaveBeenCalledTimes(21);
  });

  it('applies aligned per-file captions in a multi-file batch while preserving fallback attribution for empty captions', async () => {
    const formData = new FormData();
    formData.append(
      'files',
      new File([Buffer.from('img-1')], 'one.jpg', { type: 'image/jpeg' })
    );
    formData.append(
      'files',
      new File([Buffer.from('img-2')], 'two.jpg', { type: 'image/jpeg' })
    );
    formData.append(
      'files',
      new File([Buffer.from('img-3')], 'three.jpg', { type: 'image/jpeg' })
    );
    formData.append('captions', 'Sparkler exit!');
    formData.append('captions', '   ');
    formData.append('captions', 'Table 4 toast');
    formData.append('uploaderName', 'Elena Rivera');

    const req = await buildScopedUploadRequest(formData);
    const res = await uploadGuestPhoto(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data).toHaveLength(3);
    expect(mockCreateContentNode).toHaveBeenCalledTimes(3);

    expect(mockCreateContentNode.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        title: 'Sparkler exit!',
        altText: 'Sparkler exit!',
        caption: 'Sparkler exit!',
        uploaderName: 'Elena Rivera',
      })
    );
    expect(mockCreateContentNode.mock.calls[1][0].data).toEqual(
      expect.objectContaining({
        title: 'Photo by Elena Rivera',
        altText: 'Photo by Elena Rivera',
        uploaderName: 'Elena Rivera',
      })
    );
    expect(mockCreateContentNode.mock.calls[1][0].data.caption).toBeUndefined();
    expect(mockCreateContentNode.mock.calls[2][0].data).toEqual(
      expect.objectContaining({
        title: 'Table 4 toast',
        altText: 'Table 4 toast',
        caption: 'Table 4 toast',
        uploaderName: 'Elena Rivera',
      })
    );
  });

  it('gives distinct guest_photo_session cookies sharing one venue IP independent 15-request/min buckets without hitting 429', async () => {
    const tokenA = await signPhotoUploadSessionToken({ v: 1 });
    const tokenB = await signPhotoUploadSessionToken({ v: 1 });
    expect(tokenA).not.toBe(tokenB);

    const sendBatchForSession = async (token: string): Promise<Response> => {
      const formData = new FormData();
      formData.append(
        'files',
        new File([Buffer.from('venue-photo')], 'venue.jpg', { type: 'image/jpeg' })
      );
      const req = new NextRequest('http://localhost:3000/api/guest/photos/upload', {
        method: 'POST',
        headers: createVerifiedSocketIpHeaders('198.51.100.77', {
          host: 'localhost:3000',
          cookie: `${GUEST_PHOTO_COOKIE}=${token}`,
        }),
      });
      return uploadGuestPhoto(
        Object.assign(req, {
          formData: async () => formData,
        })
      );
    };

    // Guest A makes 15 upload requests on venue Wi-Fi IP 198.51.100.77 -> all 201
    for (let i = 0; i < 15; i += 1) {
      const resA = await sendBatchForSession(tokenA);
      expect(resA.status).toBe(201);
    }

    // Guest B on the exact same venue Wi-Fi IP 198.51.100.77 ALSO makes 15 upload requests -> all 201 (30 total on IP)
    for (let i = 0; i < 15; i += 1) {
      const resB = await sendBatchForSession(tokenB);
      expect(resB.status).toBe(201);
    }

    // Guest A's 16th request within the same minute is rate limited (per-session bucket = 15)
    const sixteenthA = await sendBatchForSession(tokenA);
    expect(sixteenthA.status).toBe(429);
  });
});
