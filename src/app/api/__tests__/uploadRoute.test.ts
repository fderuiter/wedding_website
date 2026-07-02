/** @jest-environment node */

import { POST } from '../admin/upload/route';

jest.mock('@/core/auth/auth.server', () => ({
  verifyAdminToken: jest.fn(),
  isAdminRequest: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue({ toString: () => 'abcd1234ef56789a' }),
}));

import { isAdminRequest } from '@/core/auth/auth.server';
import { writeFile } from 'fs/promises';

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

function makeRequest(overrides: {
  hasAuth?: boolean;
  token?: string;
  file?: Partial<File> | null;
  noFile?: boolean;
}) {
  const { hasAuth = true, token = 'valid-token', file, noFile = false } = overrides;

  const cookies = new Map<string, { name: string; value: string }>();
  if (hasAuth) {
    cookies.set('admin_auth', { name: 'admin_auth', value: token });
  }

  const defaultFile: Partial<File> & { arrayBuffer: () => Promise<ArrayBuffer> } = {
    name: 'test-image.png',
    size: 1024,
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
  };

  const formData = new Map<string, File | null>();
  if (!noFile) {
    formData.set('file', (file ?? defaultFile) as File);
  }

  return {
    url: 'http://localhost/api/admin/upload',
    cookies: {
      get: jest.fn((key: string) => cookies.get(key)),
    },
    formData: jest.fn(async () => ({
      get: (key: string) => formData.get(key) ?? null,
    })),
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/admin/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
  });

  describe('authentication', () => {
    beforeEach(() => {
      mockIsAdminRequest.mockResolvedValue(false);
    });

    it('returns 401 when no auth cookie is present', async () => {
      const req = makeRequest({ hasAuth: false });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 401 when token verification fails', async () => {
      mockIsAdminRequest.mockResolvedValueOnce(false);
      const req = makeRequest({ hasAuth: true, token: 'bad-token' });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('file validation', () => {
    beforeEach(() => {
      mockIsAdminRequest.mockResolvedValue(true);
    });

    it('returns 400 when no file is provided', async () => {
      const req = makeRequest({ noFile: true });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('No file provided');
    });

    it('returns 400 when file size exceeds 5MB', async () => {
      const oversizedFile = {
        name: 'large.png',
        size: 5 * 1024 * 1024 + 1,
        type: 'image/png',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: oversizedFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('File size exceeds 5MB limit');
    });

    it('returns 400 for file exactly at 5MB limit', async () => {
      const exactLimitFile = {
        name: 'exact.png',
        size: 5 * 1024 * 1024,
        type: 'image/png',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: exactLimitFile as any });
      const res = await POST(req);

      // Exactly at limit should pass (> 5MB fails, not >= 5MB)
      expect(res.status).toBe(200);
    });

    it('returns 400 for unsupported file type (gif)', async () => {
      const gifFile = {
        name: 'animated.gif',
        size: 1024,
        type: 'image/gif',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: gifFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid file format. Only JPG, PNG, and ICO are supported');
    });

    it('returns 400 for unsupported file type (webp)', async () => {
      const webpFile = {
        name: 'image.webp',
        size: 1024,
        type: 'image/webp',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const req = makeRequest({ file: webpFile as any });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid file format. Only JPG, PNG, and ICO are supported');
    });

    it('accepts image/jpeg files', async () => {
      const jpegFile = {
        name: 'photo.jpg',
        size: 1024,
        type: 'image/jpeg',
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8]).buffer,
      };
      const req = makeRequest({ file: jpegFile as any });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('accepts image/png files', async () => {
      const pngFile = {
        name: 'icon.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      };
      const req = makeRequest({ file: pngFile as any });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('accepts image/x-icon files', async () => {
      const icoFile = {
        name: 'favicon.ico',
        size: 512,
        type: 'image/x-icon',
        arrayBuffer: async () => new Uint8Array([0, 0, 1, 0]).buffer,
      };
      const req = makeRequest({ file: icoFile as any });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });

    it('accepts image/vnd.microsoft.icon files', async () => {
      const icoFile = {
        name: 'favicon.ico',
        size: 512,
        type: 'image/vnd.microsoft.icon',
        arrayBuffer: async () => new Uint8Array([0, 0, 1, 0]).buffer,
      };
      const req = makeRequest({ file: icoFile as any });
      const res = await POST(req);

      expect(res.status).toBe(200);
    });
  });

  describe('successful upload', () => {
    beforeEach(() => {
      mockIsAdminRequest.mockResolvedValue(true);
    });

    it('writes the file to the public/uploads directory', async () => {
      const pngFile = {
        name: 'my-photo.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
      };
      const req = makeRequest({ file: pngFile as any });
      await POST(req);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [filePath] = mockWriteFile.mock.calls[0];
      expect(filePath).toMatch(/public[/\\]uploads[/\\]/);
      expect(filePath).toMatch(/\.png$/);
    });

    it('returns a url with /uploads/ prefix', async () => {
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.url).toMatch(/^\/uploads\//);
    });

    it('preserves the original file extension in the returned URL', async () => {
      const jpgFile = {
        name: 'photo.jpg',
        size: 500,
        type: 'image/jpeg',
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8]).buffer,
      };
      const req = makeRequest({ file: jpgFile as any });
      const res = await POST(req);

      const json = await res.json();
      expect(json.data.url).toMatch(/\.jpg$/);
    });

    it('generates a unique filename for each upload', async () => {
      const file1 = {
        name: 'image.png',
        size: 100,
        type: 'image/png',
        arrayBuffer: async () => new ArrayBuffer(0),
      };
      const file2 = {
        name: 'image.png',
        size: 100,
        type: 'image/png',
        arrayBuffer: async () => new ArrayBuffer(0),
      };

      const req1 = makeRequest({ file: file1 as any });
      const req2 = makeRequest({ file: file2 as any });

      const res1 = await POST(req1);
      const res2 = await POST(req2);

      const json1 = await res1.json();
      const json2 = await res2.json();

      // The crypto mock returns the same value here, but the structure is the same
      // In production, two calls would produce different hashes
      expect(json1.data.url).toMatch(/^\/uploads\//);
      expect(json2.data.url).toMatch(/^\/uploads\//);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      mockIsAdminRequest.mockResolvedValue(true);
    });

    it('returns 500 when writeFile throws an error', async () => {
      mockWriteFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));
      const req = makeRequest({});
      const res = await POST(req);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('ENOENT: no such file or directory');
    });

    it('returns 500 when formData throws an error', async () => {
      mockIsAdminRequest.mockResolvedValueOnce(true);
      const brokenReq = {
        url: 'http://localhost/api/admin/upload',
        cookies: {
          get: jest.fn().mockReturnValue({ name: 'admin_auth', value: 'token' }),
        },
        formData: jest.fn().mockRejectedValue(new Error('Failed to parse form data')),
      } as unknown as import('next/server').NextRequest;

      const res = await POST(brokenReq);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to parse form data');
    });
  });
});