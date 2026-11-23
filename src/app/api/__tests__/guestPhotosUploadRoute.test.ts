/** @jest-environment node */

import { POST } from '../guest/photos/upload/route';
import { resetStorageProvider } from '@/utils/storage';
import { writeFile } from 'fs/promises';
import { mediaRepository } from '@/features/media';
import { contentRepository } from '@/features/content';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';

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

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
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

// Real 16x16 HEIC buffer
const VALID_HEIC_BUF = Buffer.from(
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADUAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAPW1kYXQAAAAxKAGvBPIWZzRxZNLf+Cv///V4+y/SYUEm1Qjs/VLEYCa/deugZMTNE6ls0CgrqKdepg==',
  'base64'
);

function makeRequest(overrides: {
  file?: Partial<File> | null;
  files?: Partial<File>[];
  noFile?: boolean;
  uploaderName?: string;
  caption?: string;
}) {
  const { file, files, noFile = false, uploaderName, caption } = overrides;

  const defaultFile: Partial<File> & { arrayBuffer: () => Promise<ArrayBuffer> } = {
    name: 'guest-photo.png',
    size: 1024,
    type: 'image/png',
    arrayBuffer: async () =>
      VALID_PNG_BUF.buffer.slice(VALID_PNG_BUF.byteOffset, VALID_PNG_BUF.byteOffset + VALID_PNG_BUF.byteLength),
  };

  const formDataMap = new Map<string, Array<File | string>>();
  if (!noFile) {
    if (files) {
      formDataMap.set('files', files as File[]);
    } else {
      formDataMap.set('file', [(file ?? defaultFile) as File]);
    }
  }
  if (uploaderName !== undefined) {
    formDataMap.set('uploaderName', [uploaderName]);
  }
  if (caption !== undefined) {
    formDataMap.set('caption', [caption]);
  }

  return {
    url: 'http://localhost/api/guest/photos/upload',
    formData: jest.fn(async () => ({
      get: (key: string) => formDataMap.get(key)?.[0] ?? null,
      getAll: (key: string) => formDataMap.get(key) ?? [],
    })),
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/guest/photos/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    resetStorageProvider();
    mockGetAppConfig.mockResolvedValue({ modules: ['gallery'] });
    (getGuestInviteSession as jest.Mock).mockResolvedValue(null);
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
      expect(json.error).toBe('Invalid file format. Only JPEG, PNG, WebP, and HEIC images are allowed');
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

    it('returns 400 and halts upload when corrupt HEIC payload fails transcoding', async () => {
      const corruptHeic = {
        name: 'IMG_0001.HEIC',
        size: 64,
        type: 'image/heic',
        arrayBuffer: async () =>
          new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 1, 2, 3]).buffer,
      };
      const req = makeRequest({ file: corruptHeic as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Image sanitization failed. The file may be corrupt or invalid.');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('returns 400 when batch payload exceeds 10 files limit', async () => {
      const defaultFile = {
        name: 'guest-photo.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () =>
          VALID_PNG_BUF.buffer.slice(VALID_PNG_BUF.byteOffset, VALID_PNG_BUF.byteOffset + VALID_PNG_BUF.byteLength),
      };
      const elevenFiles = Array(11).fill(defaultFile);
      const req = makeRequest({ files: elevenFiles as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Maximum 10 photos allowed per upload');
    });
  });

  describe('successful uploads', () => {
    it('successfully uploads valid PNG image, writes to storage, and persists DB records', async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0].url).toMatch(/^\/uploads\//);
      expect(json.data[0].id).toBe('media-123');

      expect(json.data[0].status).toBe('PENDING');
      expect(json.data[0].isVisible).toBe(false);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mediaRepository.createMedia).toHaveBeenCalledTimes(1);
      expect(contentRepository.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Photo',
          data: expect.objectContaining({
            status: 'PENDING',
            isVisible: false,
          }),
        }),
        'Guest'
      );
    });

    it('successfully uploads multiple valid images in a single request (batch payload)', async () => {
      const file1 = {
        name: 'photo1.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () =>
          VALID_PNG_BUF.buffer.slice(VALID_PNG_BUF.byteOffset, VALID_PNG_BUF.byteOffset + VALID_PNG_BUF.byteLength),
      };
      const file2 = {
        name: 'photo2.jpg',
        size: 2048,
        type: 'image/jpeg',
        arrayBuffer: async () =>
          VALID_JPEG_BUF.buffer.slice(
            VALID_JPEG_BUF.byteOffset,
            VALID_JPEG_BUF.byteOffset + VALID_JPEG_BUF.byteLength
          ),
      };
      const req = makeRequest({ files: [file1, file2] as any });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].status).toBe('PENDING');
      expect(json.data[1].status).toBe('PENDING');

      expect(mediaRepository.createMedia).toHaveBeenCalledTimes(2);
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

    it('transcodes valid HEIC uploads to .jpg and stores human-friendly title instead of raw camera filename', async () => {
      const heicFile = {
        name: 'IMG_1234.HEIC',
        size: VALID_HEIC_BUF.byteLength,
        type: '',
        arrayBuffer: async () =>
          VALID_HEIC_BUF.buffer.slice(
            VALID_HEIC_BUF.byteOffset,
            VALID_HEIC_BUF.byteOffset + VALID_HEIC_BUF.byteLength
          ),
      };
      const req = makeRequest({
        file: heicFile as any,
        uploaderName: '  Aunt Clara  ',
        caption: '  Sparkler exit!  ',
      });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data[0].url).toMatch(/^\/uploads\/photos\/.*\.jpg$/);
      expect(json.data[0].title).toBe('Sparkler exit!');
      expect(json.data[0].uploaderName).toBe('Aunt Clara');
      expect(json.data[0].caption).toBe('Sparkler exit!');

      expect(mediaRepository.createMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringMatching(/^\/uploads\/photos\/.*\.jpg$/),
          altText: 'Sparkler exit!',
        }),
        'Aunt Clara'
      );
      expect(contentRepository.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: expect.objectContaining({
            title: 'Sparkler exit!',
            altText: 'Sparkler exit!',
            uploaderName: 'Aunt Clara',
            caption: 'Sparkler exit!',
            originalFilename: 'IMG_1234.HEIC',
            status: 'PENDING',
            isVisible: false,
          }),
        }),
        'Aunt Clara'
      );
    });

    it('falls back to "Guest Photo" (never raw camera filename) when uploaderName and caption are omitted', async () => {
      const jpegFile = {
        name: 'DSC_9081.JPG',
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
      expect(contentRepository.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Guest Photo',
            altText: 'Guest Photo',
            originalFilename: 'DSC_9081.JPG',
          }),
        }),
        'Guest'
      );
    });

    it('attributes upload to active guest_session household when uploaderName is omitted or blank', async () => {
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'RIVERA26',
        guestName: '  The Rivera Family  ',
        guestIds: ['guest-1'],
      });

      const jpegFile = {
        name: 'IMG_5522.JPG',
        size: 2048,
        type: 'image/jpeg',
        arrayBuffer: async () =>
          VALID_JPEG_BUF.buffer.slice(
            VALID_JPEG_BUF.byteOffset,
            VALID_JPEG_BUF.byteOffset + VALID_JPEG_BUF.byteLength
          ),
      };
      const req = makeRequest({ file: jpegFile as any, uploaderName: '   ' });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data[0].uploaderName).toBe('The Rivera Family');
      expect(json.data[0].title).toBe('Photo by The Rivera Family');
      expect(getGuestInviteSession).toHaveBeenCalledWith(req);
      expect(contentRepository.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            uploaderName: 'The Rivera Family',
            title: 'Photo by The Rivera Family',
          }),
        }),
        'The Rivera Family'
      );
    });
  });
});
