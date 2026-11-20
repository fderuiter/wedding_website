/** @jest-environment node */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '../[...path]/route';
import { resetStorageProvider } from '@/utils/storage';

describe('Standalone Uploads Streaming Route (/api/uploads/[...path])', () => {
  const uploadsRoot = path.join(process.cwd(), 'public', 'uploads');
  const testSubdirName = `__test_stream_${crypto.randomBytes(6).toString('hex')}`;
  const testSubdirPath = path.join(uploadsRoot, testSubdirName);
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetStorageProvider();
    process.env = { ...originalEnv };
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    fs.mkdirSync(testSubdirPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testSubdirPath, { recursive: true, force: true });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('streams newly written PNG, WebP, and ICO files dynamically with X-Content-Type-Options: nosniff', async () => {
    const pngPayload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webpPayload = Buffer.from('RIFF\x0c\x00\x00\x00WEBP', 'binary');
    const icoPayload = Buffer.from([0x00, 0x00, 0x01, 0x00]);

    fs.writeFileSync(path.join(testSubdirPath, 'fresh.png'), pngPayload);
    fs.writeFileSync(path.join(testSubdirPath, 'gallery.webp'), webpPayload);
    fs.writeFileSync(path.join(testSubdirPath, 'favicon.ico'), icoPayload);

    const pngRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/fresh.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'fresh.png'] }) }
    );
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers.get('Content-Type')).toBe('image/png');
    expect(pngRes.headers.get('Content-Length')).toBe(String(pngPayload.length));
    expect(pngRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await pngRes.arrayBuffer())).toEqual(pngPayload);

    const webpRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/gallery.webp`),
      { params: Promise.resolve({ path: [testSubdirName, 'gallery.webp'] }) }
    );
    expect(webpRes.status).toBe(200);
    expect(webpRes.headers.get('Content-Type')).toBe('image/webp');
    expect(webpRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await webpRes.arrayBuffer())).toEqual(webpPayload);

    const headRes = await HEAD(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/favicon.ico`, { method: 'HEAD' }),
      { params: Promise.resolve({ path: [testSubdirName, 'favicon.ico'] }) }
    );
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get('Content-Type')).toBe('image/x-icon');
    expect(headRes.headers.get('Content-Length')).toBe(String(icoPayload.length));
    expect(headRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await headRes.arrayBuffer()).byteLength).toBe(0);
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
      const res = await GET(new NextRequest(testCase.rawUrl), {
        params: Promise.resolve({ path: testCase.segments }),
      });
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
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/escape-pkg.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'escape-pkg.png'] }) }
    );
    expect(escapeRes.status).toBe(400);
    expect(escapeRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const internalRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/alias.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'alias.png'] }) }
    );
    expect(internalRes.status).toBe(400);
    expect(internalRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('returns HTTP 404 with X-Content-Type-Options: nosniff for missing files and directories', async () => {
    const missingRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}/does-not-exist.png`),
      { params: Promise.resolve({ path: [testSubdirName, 'does-not-exist.png'] }) }
    );
    expect(missingRes.status).toBe(404);
    expect(missingRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const dirRes = await GET(
      new NextRequest(`http://localhost:3000/uploads/${testSubdirName}`),
      { params: Promise.resolve({ path: [testSubdirName] }) }
    );
    expect(dirRes.status).toBe(404);
    expect(dirRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
