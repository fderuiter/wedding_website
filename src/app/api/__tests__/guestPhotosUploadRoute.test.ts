/** @jest-environment node */

import { POST } from '../guest/photos/upload/route';
import { resetStorageProvider } from '@/utils/storage';
import { writeFile } from 'fs/promises';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    writeFile: jest.fn(),
  };
});

const mockGetAppConfig = jest.fn();

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: (...args: any[]) => mockGetAppConfig(...args),
  };
});

jest.mock('@/features/media', () => ({
  mediaRepository: {
    createMedia: jest.fn().mockResolvedValue({
      id: 'media-123',
      url: '/uploads/photos/photo.png',
      altText: 'Guest Photo',
      createdAt: new Date(),
    }),
  },
}));

jest.mock('@/features/content', () => ({
  contentRepository: {
    createNode: jest.fn().mockResolvedValue({
      id: 'node-123',
      type: 'Photo',
      data: { url: '/uploads/photos/photo.png' },
    }),
  },
}));

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

const VALID_PNG_BUF = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const VALID_JPEG_BUF = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z',
  'base64'
);

// Minimal valid WEBP buffer
const VALID_WEBP_BUF = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64'
);

function makeRequest(overrides: { file?: Partial<File> | null; noFile?: boolean }) {
  const { file, noFile = false } = overrides;

  const defaultFile: Partial<File> & { arrayBuffer: () => Promise<ArrayBuffer> } = {
    name: 'guest-photo.png',
    size: 1024,
    type: 'image/png',
    arrayBuffer: async () =>
      VALID_PNG_BUF.buffer.slice(VALID_PNG_BUF.byteOffset, VALID_PNG_BUF.byteOffset + VALID_PNG_BUF.byteLength),
  };

  const formData = new Map<string, File | null>();
  if (!noFile) {
    formData.set('file', (file ?? defaultFile) as File);
  }

  return {
    url: 'http://localhost/api/guest/photos/upload',
    formData: jest.fn(async () => ({
      get: (key: string) => formData.get(key) ?? null,
    })),
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/guest/photos/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    resetStorageProvider();
    mockGetAppConfig.mockResolvedValue({ modules: ['gallery'] });
  });

  describe('feature toggle validation', () => {
    it('returns 404 when gallery feature is disabled', async () => {
      mockGetAppConfig.mockResolvedValueOnce({ modules: { gallery: false } });

      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Feature 'gallery' is disabled");
    });
  });

  describe('file validation', () => {
    it('returns 400 when no file is provided', async () => {
      const req = makeRequest({ noFile: true });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('No file provided');
    });

    it('returns 400 when file size exceeds 10MB limit', async () => {
      const oversizedFile = {
        name: 'huge.jpg',
        size: 10 * 1024 * 1024 + 1,
        type: 'image/jpeg',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: oversizedFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('File size exceeds 10MB limit');
    });

    it('returns 400 for unsupported file type (pdf)', async () => {
      const pdfFile = {
        name: 'document.pdf',
        size: 1024,
        type: 'application/pdf',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: pdfFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid file format. Only JPEG, PNG, and WebP images are allowed');
    });

    it('returns 400 when file extension does not match declared MIME type', async () => {
      const mismatchedFile = {
        name: 'photo.png',
        size: 1024,
        type: 'image/jpeg',
        arrayBuffer: async () =>
          VALID_JPEG_BUF.buffer.slice(
            VALID_JPEG_BUF.byteOffset,
            VALID_JPEG_BUF.byteOffset + VALID_JPEG_BUF.byteLength
          ),
      };
      const req = makeRequest({ file: mismatchedFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('File extension does not match the declared MIME type');
    });

    it('returns 400 and halts upload when image sanitization fails for corrupt file', async () => {
      const corruptJpeg = {
        name: 'photo.jpg',
        size: 1024,
        type: 'image/jpeg',
        arrayBuffer: async () => new Uint8Array([255, 216, 255, 224, 0, 0, 0]).buffer,
      };
      const req = makeRequest({ file: corruptJpeg as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Image sanitization failed. The file may be corrupt or invalid.');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('successful uploads', () => {
    it('successfully uploads valid PNG image, writes to storage, and persists DB records', async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.url).toMatch(/^\/uploads\//);
      expect(json.data.id).toBe('media-123');

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const { mediaRepository } = require('@/features/media');
      const { contentRepository } = require('@/features/content');
      expect(mediaRepository.createMedia).toHaveBeenCalledTimes(1);
      expect(contentRepository.createNode).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'Photo' }),
        'Guest'
      );
    });

    it('accepts valid JPEG image', async () => {
      const jpegFile = {
        name: 'photo.jpg',
        size: 2048,
        type: 'image/jpeg',
        arrayBuffer: async () =>
          VALID_JPEG_BUF.buffer.slice(
            VALID_JPEG_BUF.byteOffset,
            VALID_JPEG_BUF.byteOffset + VALID_JPEG_BUF.byteLength
          ),
      };
      const req = makeRequest({ file: jpegFile as any });
      const res = await POST(req);

      expect(res.status).toBe(201);
    });

    it('accepts valid WebP image', async () => {
      const webpFile = {
        name: 'photo.webp',
        size: 2048,
        type: 'image/webp',
        arrayBuffer: async () =>
          VALID_WEBP_BUF.buffer.slice(
            VALID_WEBP_BUF.byteOffset,
            VALID_WEBP_BUF.byteOffset + VALID_WEBP_BUF.byteLength
          ),
      };
      const req = makeRequest({ file: webpFile as any });
      const res = await POST(req);

      expect(res.status).toBe(201);
    });
  });
});
