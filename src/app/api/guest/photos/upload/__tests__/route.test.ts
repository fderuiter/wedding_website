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
import {
  GUEST_PHOTO_COOKIE,
  signPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';

describe('POST /api/guest/photos/upload (Scoped Auth, Sanitization, & Auto-Approval)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
