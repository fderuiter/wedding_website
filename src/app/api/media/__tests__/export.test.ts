/** @jest-environment node */

import { GET, POST } from '../export/route';
import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { isAdminRequest } from '@/core/auth/auth.server';
import { safeFetch } from '@/utils/safeFetch';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    media: {
      findMany: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/utils/safeFetch', () => ({
  safeFetch: jest.fn(),
}));

const mockPrisma = prisma as unknown as {
  media: { findMany: jest.Mock };
  contentNode: { findMany: jest.Mock };
};

const mockGetAppConfig = getAppConfig as jest.Mock;
const mockIsFeatureEnabled = isFeatureEnabled as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;

async function readStream(res: unknown): Promise<Buffer> {
  const stream = (res as { body?: ReadableStream<Uint8Array>; bodyContent?: ReadableStream<Uint8Array> })?.body ||
                 (res as { body?: ReadableStream<Uint8Array>; bodyContent?: ReadableStream<Uint8Array> })?.bodyContent;
  if (!stream || typeof stream.getReader !== 'function') return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

interface ParsedZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

function parseZipArchive(zipBuffer: Buffer): ParsedZipEntry[] {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('End of central directory signature not found');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries: ParsedZipEntry[] = [];

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory header at offset ${offset}`);
    }
    const compressionMethod = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
    const fileCommentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local file header for ${name}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    const data =
      compressionMethod === 0
        ? Buffer.from(rawSlice)
        : compressionMethod === 8
          ? zlib.inflateRawSync(rawSlice)
          : Buffer.alloc(0);

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      data,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

describe('GET & POST /api/media/export Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({ modules: ['gallery'] });
    mockIsFeatureEnabled.mockReturnValue(true);
    mockIsAdminRequest.mockResolvedValue(true);
  });

  describe('Authorization Guardrails', () => {
    test('returns 401 Unauthorized for unauthenticated GET /api/media/export requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/export');
      const res = await GET(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 401 Unauthorized for unauthenticated POST /api/media/export requests', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['m1'] }),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });
  });

  describe('Feature Flag Guardrails', () => {
    test('returns 404 when gallery module is disabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(false);

      const req = new NextRequest('http://localhost/api/media/export');
      const res = await GET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("Feature 'gallery' is disabled");
    });
  });

  describe('GET /api/media/export', () => {
    test('returns 404 if no matching media items exist', async () => {
      mockPrisma.media.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?tag=nonexistent');
      const res = await GET(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('No media items found matching export criteria');
    });

    test('streams ZIP archive for requested tag with proper response headers', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'node-1',
          type: 'Photo',
          tags: ['guest-upload'],
          data: { url: '/uploads/photos/photo1.jpg', title: 'Guest Photo 1' },
        },
      ]);

      const req = new NextRequest('http://localhost/api/media/export?tag=guest-upload');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="wedding-photos.zip"'
      );
    });

    test('streams ZIP archive for requested comma-separated IDs', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/m1.jpg', altText: 'Media 1' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m1,m2');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });
  });

  describe('POST /api/media/export', () => {
    test('streams ZIP archive when given a JSON array of IDs', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/photo1.jpg', altText: 'Photo 1' },
        { id: 'm2', url: '/uploads/photo2.jpg', altText: 'Photo 2' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['m1', 'm2'] }),
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });

    test('streams ZIP archive when given JSON with tag property', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'node-2',
          type: 'Photo',
          tags: ['guest-upload'],
          data: { url: '/uploads/guest_photo.png', title: 'Party Pic' },
        },
      ]);

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: 'guest-upload' }),
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
    });
  });

  describe('Database Field Projections', () => {
    test('projects required fields when querying Prisma media and contentNode by ID', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/m1.jpg', altText: 'Media 1' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([
        { id: 'c1', data: { url: '/uploads/c1.jpg', title: 'Content 1' } },
      ]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m1,c1');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['m1', 'c1'] } },
        select: { id: true, url: true, altText: true },
      });
      expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['m1', 'c1'] } },
        select: { id: true, data: true },
      });
    });

    test('projects required fields when querying Prisma contentNode by tag and fallback media', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([]);
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm-guest', url: '/uploads/photos/guest.jpg', altText: 'Guest Photo' },
      ]);

      const req = new NextRequest('http://localhost/api/media/export?tag=guest-upload');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
        where: { type: 'Photo', tags: { has: 'guest-upload' } },
        select: { id: true, data: true },
      });
      expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
        select: { id: true, url: true, altText: true },
      });
    });

    test('projects required fields when exporting all photos', async () => {
      mockPrisma.contentNode.findMany.mockResolvedValue([
        { id: 'c1', data: { url: '/uploads/c1.jpg', title: 'Content 1' } },
      ]);
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/m1.jpg', altText: 'Media 1' },
      ]);

      const req = new NextRequest('http://localhost/api/media/export');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(mockPrisma.contentNode.findMany).toHaveBeenCalledWith({
        where: { type: 'Photo' },
        select: { id: true, data: true },
      });
      expect(mockPrisma.media.findMany).toHaveBeenCalledWith({
        select: { id: true, url: true, altText: true },
      });
    });
  });

  describe('Bounded Parallel Fetches and Error Fallbacks', () => {
    test('fetches remote HTTP assets in parallel bounded by concurrency limit of 8', async () => {
      const items = Array.from({ length: 17 }, (_, i) => ({
        id: `media-${i + 1}`,
        url: `https://cdn.example.com/photos/photo_${i + 1}.jpg`,
        altText: `Photo ${i + 1}`,
      }));
      mockPrisma.media.findMany.mockResolvedValue(items);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      let activeCount = 0;
      let peakConcurrency = 0;

      mockSafeFetch.mockImplementation(async () => {
        activeCount++;
        peakConcurrency = Math.max(peakConcurrency, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 15));
        activeCount--;
        return new Response(Buffer.from('mock-image-bytes'), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      });

      const req = new NextRequest(
        'http://localhost/api/media/export?ids=' + items.map((it) => it.id).join(',')
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      expect(buffer.length).toBeGreaterThan(0);
      expect(mockSafeFetch).toHaveBeenCalledTimes(17);
      expect(peakConcurrency).toBe(8);
    });

    test('creates error_${filename}.txt inside ZIP when remote HTTP fetch fails with non-200 status', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: 'https://cdn.example.com/broken.jpg', altText: 'Broken Image' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      mockSafeFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404, statusText: 'Not Found' })
      );

      const req = new NextRequest('http://localhost/api/media/export?ids=m1');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('error_Broken_Image.jpg.txt');
    });

    test('creates error_${filename}.txt inside ZIP when remote HTTP fetch throws a network exception', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: 'https://cdn.example.com/network-error.jpg', altText: 'Network Err' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      mockSafeFetch.mockRejectedValueOnce(new Error('Connection timed out'));

      const req = new NextRequest('http://localhost/api/media/export?ids=m1');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('error_Network_Err.jpg.txt');
    });

    test('logs an error entry and continues processing valid media items when a host attempts DNS rebinding', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm-rebind', url: 'https://attacker.example.com/rebind.jpg', altText: 'Rebind Attack' },
        { id: 'm-valid', url: 'https://cdn.example.com/valid.jpg', altText: 'Valid Photo' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      // Item 1 fails due to SSRF / DNS rebinding block
      mockSafeFetch.mockRejectedValueOnce(
        new Error('Blocked: URL resolves to a private or restricted IP address')
      );
      // Item 2 succeeds normally
      mockSafeFetch.mockResolvedValueOnce(
        new Response(Buffer.from('valid-image-bytes'), { status: 200 })
      );

      const req = new NextRequest('http://localhost/api/media/export?ids=m-rebind,m-valid');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');

      // Verifies error file created for the blocked item and valid item exported
      expect(zipContent).toContain('error_Rebind_Attack.jpg.txt');
      expect(zipContent).toContain('Valid_Photo.jpg');
    });

    test('creates missing_${filename}.txt inside ZIP when local file is not found', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/missing-file.jpg', altText: 'Missing Local' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m1');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('missing_Missing_Local.jpg.txt');
    });

    test('deterministically resolves duplicate filenames across parallel fetch batches', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `m-${i + 1}`,
        url: `https://cdn.example.com/photo_${i + 1}.jpg`,
        altText: 'Wedding Ceremony',
      }));
      mockPrisma.media.findMany.mockResolvedValue(items);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      mockSafeFetch.mockResolvedValue(
        new Response(Buffer.from('image-content'), { status: 200 })
      );

      const req = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: items.map((it) => it.id) }),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('Wedding_Ceremony.jpg');
      expect(zipContent).toContain('Wedding_Ceremony_1.jpg');
      expect(zipContent).toContain('Wedding_Ceremony_8.jpg');
      expect(zipContent).toContain('Wedding_Ceremony_9.jpg');
    });
  });

  describe('Path Traversal Guardrails and Canonical Boundary Verification', () => {
    test('rejects relative path traversal sequences escaping public directory and creates error notice', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm-traversal', url: '../../package.json', altText: 'Package Config' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m-traversal');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('error_Package_Config.json.txt');
      expect(zipContent).not.toContain('"name": "wedding_website"');
    });

    test('rejects URL-encoded path traversal sequences (%2e%2e) and creates error notice', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm-encoded', url: '/%2e%2e/%2e%2e/package.json', altText: 'Encoded Traversal' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m-encoded');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('error_Encoded_Traversal.json.txt');
      expect(zipContent).not.toContain('"name": "wedding_website"');
    });

    test('exports valid media items while appending error notices for path traversal attempts in the same batch', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        {
          id: 'm-valid',
          url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
          altText: 'Valid Photo',
        },
        { id: 'm-bad', url: '/uploads/../../package.json', altText: 'Bad Photo' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/media/export?ids=m-valid,m-bad');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const buffer = await readStream(res);
      const zipContent = buffer.toString('utf-8');
      expect(zipContent).toContain('Valid_Photo.jpg');
      expect(zipContent).toContain('error_Bad_Photo.json.txt');
      expect(zipContent).not.toContain('"name": "wedding_website"');
    });

    test('rejects symlinks that point outside the public directory boundary', async () => {
      const publicDir = path.resolve(process.cwd(), 'public');
      const symlinkPath = path.join(publicDir, 'test-outside-symlink.json');
      const targetPath = path.resolve(process.cwd(), 'package.json');

      try {
        try {
          await fs.promises.unlink(symlinkPath);
        } catch {}
        await fs.promises.symlink(targetPath, symlinkPath);

        mockPrisma.media.findMany.mockResolvedValue([
          { id: 'm-symlink', url: '/test-outside-symlink.json', altText: 'Symlink Leak' },
        ]);
        mockPrisma.contentNode.findMany.mockResolvedValue([]);

        const req = new NextRequest('http://localhost/api/media/export?ids=m-symlink');
        const res = await GET(req);

        expect(res.status).toBe(200);
        const buffer = await readStream(res);
        const zipContent = buffer.toString('utf-8');
        expect(zipContent).toContain('error_Symlink_Leak.json.txt');
        expect(zipContent).not.toContain('"name": "wedding_website"');
      } finally {
        try {
          await fs.promises.unlink(symlinkPath);
        } catch {}
      }
    });

    test('allows valid local files inside the public directory to export normally', async () => {
      const publicDir = path.resolve(process.cwd(), 'public');
      const validFilePath = path.join(publicDir, 'test-valid-media.txt');

      try {
        await fs.promises.writeFile(validFilePath, 'valid-media-file-content', 'utf-8');

        mockPrisma.media.findMany.mockResolvedValue([
          { id: 'm-valid-local', url: '/test-valid-media.txt', altText: 'Valid Local Media' },
        ]);
        mockPrisma.contentNode.findMany.mockResolvedValue([]);

        const req = new NextRequest('http://localhost/api/media/export?ids=m-valid-local');
        const res = await GET(req);

        expect(res.status).toBe(200);
        const buffer = await readStream(res);
        const zipContent = buffer.toString('utf-8');
        expect(zipContent).toContain('Valid_Local_Media.txt');
      } finally {
        try {
          await fs.promises.unlink(validFilePath);
        } catch {}
      }
    });

    test('resolves publicRoot realpath once per export and once per local image asset', async () => {
      const publicDir = path.resolve(process.cwd(), 'public');
      const localFiles = [
        path.join(publicDir, 'test-batch-1.jpg'),
        path.join(publicDir, 'test-batch-2.png'),
        path.join(publicDir, 'test-batch-3.webp'),
      ];

      try {
        await Promise.all(
          localFiles.map((filePath, idx) =>
            fs.promises.writeFile(filePath, Buffer.from(`local-image-${idx}`))
          )
        );

        mockPrisma.media.findMany.mockResolvedValue([
          { id: 'l1', url: '/test-batch-1.jpg', altText: 'Batch One' },
          { id: 'l2', url: '/test-batch-2.png', altText: 'Batch Two' },
          { id: 'l3', url: '/test-batch-3.webp', altText: 'Batch Three' },
        ]);
        mockPrisma.contentNode.findMany.mockResolvedValue([]);

        const realpathSpy = jest.spyOn(fs.promises, 'realpath');
        try {
          const req = new NextRequest('http://localhost/api/media/export?ids=l1,l2,l3');
          const res = await GET(req);
          expect(res.status).toBe(200);

          const zipBuffer = await readStream(res);
          const entries = parseZipArchive(zipBuffer);
          expect(entries).toHaveLength(3);
          for (const entry of entries) {
            expect(entry.compressionMethod).toBe(0);
          }

          // 1 call for publicRoot + 1 call per existing target asset = 4 total
          expect(realpathSpy).toHaveBeenCalledTimes(4);
        } finally {
          realpathSpy.mockRestore();
        }
      } finally {
        await Promise.all(
          localFiles.map(async (filePath) => {
            try {
              await fs.promises.unlink(filePath);
            } catch {}
          })
        );
      }
    });
  });

  describe('STORE Image Entries, Stream Backpressure, Cancellation, Preflight & CSRF Guards', () => {
    test('writes compressed image formats with ZIP STORE (method 0) and zero deflate expansion while keeping .txt notices readable', async () => {
      const randomJpegPayload = crypto.randomBytes(1_060_000);
      const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.heic', '.heif'];

      mockPrisma.media.findMany.mockResolvedValue([
        ...extensions.map((ext, idx) => ({
          id: `img-${idx}`,
          url: `https://cdn.example.com/asset_${idx}${ext}`,
          altText: `Asset_${idx}`,
        })),
        { id: 'missing-local', url: '/uploads/does-not-exist.jpg', altText: 'Missing_Img' },
        { id: 'broken-remote', url: 'https://cdn.example.com/fail.jpg', altText: 'Broken_Img' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      mockSafeFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/fail.jpg')) {
          return new Response('Upstream error', { status: 502 });
        }
        const payload = url.endsWith('.jpg') ? randomJpegPayload : Buffer.from(`payload:${url}`);
        return new Response(payload, { status: 200 });
      });

      const req = new NextRequest(
        'http://localhost/api/media/export?ids=' +
          [...extensions.map((_, i) => `img-${i}`), 'missing-local', 'broken-remote'].join(',')
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const zipBuffer = await readStream(res);
      const entries = parseZipArchive(zipBuffer);
      expect(entries).toHaveLength(extensions.length + 2);

      for (const ext of extensions) {
        const entry = entries.find((e) => e.name.endsWith(ext));
        expect(entry).toBeDefined();
        expect(entry!.compressionMethod).toBe(0);
        expect(entry!.compressedSize).toBe(entry!.uncompressedSize);
      }

      const largeJpegEntry = entries.find((e) => e.name === 'Asset_0.jpg')!;
      expect(largeJpegEntry.compressedSize).toBe(randomJpegPayload.length);
      expect(largeJpegEntry.data.equals(randomJpegPayload)).toBe(true);

      const missingNotice = entries.find((e) => e.name === 'missing_Missing_Img.jpg.txt')!;
      expect(missingNotice).toBeDefined();
      expect(missingNotice.data.toString('utf8')).toContain('Local asset file not found');

      const errorNotice = entries.find((e) => e.name === 'error_Broken_Img.jpg.txt')!;
      expect(errorNotice).toBeDefined();
      expect(errorNotice.data.toString('utf8')).toContain('Failed to download resource: HTTP 502');
    });

    test('pauses batch fetching under downstream backpressure and resumes cleanly when consumer drains stream', async () => {
      const items = Array.from({ length: 24 }, (_, i) => ({
        id: `bp-${i + 1}`,
        url: `https://cdn.example.com/bp/photo_${i + 1}.jpg`,
        altText: `Backpressure_${i + 1}`,
      }));
      mockPrisma.media.findMany.mockResolvedValue(items);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const sampleChunk = Buffer.alloc(32 * 1024, 0x61);
      mockSafeFetch.mockImplementation(async () => {
        return new Response(sampleChunk, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      });

      const req = new NextRequest(
        'http://localhost/api/media/export?ids=' + items.map((it) => it.id).join(',')
      );
      const res = await GET(req);
      expect(res.status).toBe(200);

      const stream = (res as unknown as { bodyContent: ReadableStream<Uint8Array> }).bodyContent;
      const reader = stream.getReader();

      // Read only the first chunk, then stall the consumer
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 60));
      // Downstream is paused after highWaterMark: 1 fills; batches 2 and 3 must not start yet
      expect(mockSafeFetch).toHaveBeenCalledTimes(8);

      // Resume draining the rest of the stream
      const chunks: Uint8Array[] = [firstChunk.value!];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      expect(mockSafeFetch).toHaveBeenCalledTimes(24);
      const entries = parseZipArchive(Buffer.concat(chunks));
      expect(entries).toHaveLength(24);
    });

    test('aborts archiver and cancels pending safeFetch requests via AbortSignal when stream is cancelled', async () => {
      const items = Array.from({ length: 16 }, (_, i) => ({
        id: `cancel-${i + 1}`,
        url: `https://cdn.example.com/cancel/photo_${i + 1}.jpg`,
        altText: `Cancel_${i + 1}`,
      }));
      mockPrisma.media.findMany.mockResolvedValue(items);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const capturedSignals: AbortSignal[] = [];
      mockSafeFetch.mockImplementation((_url: string, options?: RequestInit) => {
        const signal = options?.signal as AbortSignal | undefined;
        if (signal) {
          capturedSignals.push(signal);
        }
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Aborted'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('Aborted'));
            },
            { once: true }
          );
        });
      });

      const req = new NextRequest(
        'http://localhost/api/media/export?ids=' + items.map((it) => it.id).join(',')
      );
      const res = await GET(req);
      const stream = (res as unknown as { bodyContent: ReadableStream<Uint8Array> }).bodyContent;
      const reader = stream.getReader();

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(capturedSignals).toHaveLength(8);
      expect(capturedSignals.every((sig) => !sig.aborted)).toBe(true);

      await reader.cancel('User cancelled download');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(capturedSignals.every((sig) => sig.aborted)).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledTimes(8);
    });

    test('supports preflight readiness checks and sanitized .zip filenames across GET, JSON POST, and form POST', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: 'https://cdn.example.com/one.jpg', altText: 'One' },
        { id: 'm2', url: 'https://cdn.example.com/two.png', altText: 'Two' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      // 1. GET preflight returns JSON without fetching remote blobs
      const getPreflightReq = new NextRequest(
        'http://localhost/api/media/export?ids=m1,m2&preflight=1&filename=guest-photos.zip'
      );
      const getPreflightRes = await GET(getPreflightReq);
      expect(getPreflightRes.status).toBe(200);
      expect(await getPreflightRes.json()).toEqual({
        success: true,
        data: { ready: true, count: 2, filename: 'guest-photos.zip' },
      });
      expect(mockSafeFetch).not.toHaveBeenCalled();

      // 2. JSON POST preflight sanitizes traversal/header characters in filename
      const postPreflightReq = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({
          ids: ['m1', 'm2'],
          filename: '../../selected"\r\nmedia.zip',
          preflight: true,
        }),
      });
      const postPreflightRes = await POST(postPreflightReq);
      expect(postPreflightRes.status).toBe(200);
      expect(await postPreflightRes.json()).toEqual({
        success: true,
        data: { ready: true, count: 2, filename: 'selected---media.zip' },
      });
      expect(mockSafeFetch).not.toHaveBeenCalled();

      // 3. application/x-www-form-urlencoded POST streams ZIP with sanitized Content-Disposition
      mockSafeFetch.mockImplementation(async (url: string) => {
        return new Response(Buffer.from(`img:${url}`), { status: 200 });
      });

      const formBody = new URLSearchParams();
      formBody.append('ids', 'm1');
      formBody.append('ids', 'm2');
      formBody.append('filename', 'selected-media.zip');

      const formPostReq = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: formBody.toString(),
      });
      const formPostRes = await POST(formPostReq);
      expect(formPostRes.status).toBe(200);
      expect(formPostRes.headers.get('content-disposition')).toBe(
        'attachment; filename="selected-media.zip"'
      );

      const entries = parseZipArchive(await readStream(formPostRes));
      expect(entries.map((e) => e.name)).toEqual(['One.jpg', 'Two.png']);
    });

    test('enforces Origin and Sec-Fetch-Site validation on POST /api/media/export', async () => {
      mockPrisma.media.findMany.mockResolvedValue([
        { id: 'm1', url: '/uploads/m1.jpg', altText: 'One' },
      ]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);

      const crossSiteFetchReq = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: 'ids=m1&filename=selected-media.zip',
      });
      const crossSiteRes = await POST(crossSiteFetchReq);
      expect(crossSiteRes.status).toBe(403);

      const crossOriginReq = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://evil.example',
        },
        body: 'ids=m1&filename=selected-media.zip',
      });
      const crossOriginRes = await POST(crossOriginReq);
      expect(crossOriginRes.status).toBe(403);

      const nullOriginReq = new NextRequest('http://localhost/api/media/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'null',
        },
        body: 'ids=m1&filename=selected-media.zip',
      });
      const nullOriginRes = await POST(nullOriginReq);
      expect(nullOriginRes.status).toBe(403);
    });
  });
});
