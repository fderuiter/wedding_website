/** @jest-environment node */

import { GET, POST } from '../export/route';
import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
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
  });
});
