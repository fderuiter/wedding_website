/** @jest-environment node */

import {
  getStorageProvider,
  LocalStorageProvider,
  resetStorageProvider,
  StorageUploadInputObject,
} from '../storage';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { writeFile, unlink, stat } from 'fs/promises';
import path from 'path';

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
  realpath: jest.fn((p: string) => Promise.resolve(p)),
}));

describe('Hybrid Storage Provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    resetStorageProvider();
    process.env = { ...originalEnv };
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_PUBLIC_URL;
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  describe('getStorageProvider Dynamic Toggling', () => {
    it('returns LocalStorageProvider when S3 environment variables are absent', () => {
      const provider = getStorageProvider();
      expect(provider.constructor.name).toBe('LocalStorageProvider');
    });

    it('returns S3StorageProvider when S3 environment variables are fully populated', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY_ID = 'test-access-key';
      process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

      const provider = getStorageProvider();
      expect(provider.constructor.name).toBe('S3StorageProvider');
    });

    it('throws clear error when S3 configuration is partial', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      // Missing S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY

      expect(() => getStorageProvider()).toThrow(
        /Incomplete S3 credentials: Missing S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/
      );
    });
  });

  describe('LocalStorageProvider via getStorageProvider', () => {
    it('uploads a File input and returns StorageObject metadata', async () => {
      const provider = getStorageProvider();
      const file = {
        name: 'test-image.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as File;

      const result = await provider.upload(file, { folder: 'uploads/photos', metadata: { author: 'Alice' } });

      expect(result.key).toMatch(/^uploads\/photos\/[a-f0-9]{16}\.png$/);
      expect(result.url).toBe(`/${result.key}`);
      expect(result.size).toBe(3);
      expect(result.mimeType).toBe('image/png');
      expect(result.metadata).toEqual({ author: 'Alice' });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [filePath, buffer] = (writeFile as jest.Mock).mock.calls[0];
      expect(filePath).toContain(path.join(process.cwd(), 'public', 'uploads', 'photos'));
      expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    });

    it('rejects upload, delete, and getMetadata for keys outside public/uploads', async () => {
      const provider = getStorageProvider();
      const input: StorageUploadInputObject = {
        buffer: Buffer.from([1, 2, 3]),
        filename: 'evil.png',
        mimeType: 'image/png',
      };

      await expect(provider.upload(input, { folder: 'photos' })).rejects.toThrow();
      await expect(provider.upload(input, { key: '../canary.txt' })).rejects.toThrow();
      await expect(provider.upload(input, { key: 'images/placeholder.png' })).rejects.toThrow();
      expect(writeFile).not.toHaveBeenCalled();

      await expect(provider.delete('/../canary.txt')).rejects.toThrow();
      await expect(provider.delete('/%2e%2e/canary.txt')).rejects.toThrow();
      await expect(provider.delete('/images/placeholder.png')).rejects.toThrow();
      expect(unlink).not.toHaveBeenCalled();

      await expect(provider.getMetadata('/../canary.txt')).rejects.toThrow();
      await expect(provider.getMetadata('/images/placeholder.png')).rejects.toThrow();
      expect(stat).not.toHaveBeenCalled();
    });

    it('uploads a Buffer input with custom key', async () => {
      const provider = getStorageProvider();
      const input: StorageUploadInputObject = {
        buffer: Buffer.from([10, 20, 30]),
        filename: 'custom.jpg',
        mimeType: 'image/jpeg',
      };

      const result = await provider.upload(input, { key: 'uploads/custom-key.jpg' });

      expect(result.key).toBe('uploads/custom-key.jpg');
      expect(result.url).toBe('/uploads/custom-key.jpg');
      expect(result.size).toBe(3);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('deletes an asset by key or URL', async () => {
      const provider = getStorageProvider();
      await provider.delete('/uploads/test-file.png');
      expect(unlink).toHaveBeenCalledWith(path.join(process.cwd(), 'public', 'uploads', 'test-file.png'));
    });

    it('ignores ENOENT errors on delete', async () => {
      const provider = getStorageProvider();
      (unlink as jest.Mock).mockRejectedValueOnce({ code: 'ENOENT' });
      await expect(provider.delete('uploads/missing.png')).resolves.not.toThrow();
    });

    it('resolves public URLs correctly', () => {
      const provider = getStorageProvider();
      expect(provider.getPublicUrl('uploads/photo.jpg')).toBe('/uploads/photo.jpg');
      expect(provider.getPublicUrl('/uploads/photo.jpg')).toBe('/uploads/photo.jpg');
      expect(provider.getPublicUrl('https://cdn.com/uploads/photo.jpg')).toBe('https://cdn.com/uploads/photo.jpg');
    });

    it('fetches metadata for existing files across supported image extensions and falls back to application/octet-stream', async () => {
      const provider = getStorageProvider();
      (stat as jest.Mock).mockResolvedValueOnce({
        size: 2048,
        mtime: new Date('2026-01-01'),
      });

      const meta = await provider.getMetadata('/uploads/file.png');
      expect(meta).toEqual({
        key: 'uploads/file.png',
        url: '/uploads/file.png',
        size: 2048,
        mimeType: 'image/png',
        updatedAt: new Date('2026-01-01'),
      });

      (stat as jest.Mock).mockResolvedValueOnce({
        size: 1024,
        mtime: new Date('2026-01-02'),
      });
      const webpMeta = await provider.getMetadata('/uploads/photo.webp');
      expect(webpMeta?.mimeType).toBe('image/webp');

      (stat as jest.Mock).mockResolvedValueOnce({
        size: 512,
        mtime: new Date('2026-01-03'),
      });
      const icoMeta = await provider.getMetadata('/uploads/favicon.ico');
      expect(icoMeta?.mimeType).toBe('image/x-icon');

      (stat as jest.Mock).mockResolvedValueOnce({
        size: 768,
        mtime: new Date('2026-01-04'),
      });
      const unknownExtMeta = await provider.getMetadata('/uploads/vector.svg');
      expect(unknownExtMeta?.mimeType).toBe('application/octet-stream');
    });

    it('rejects openReadStream traversal keys outside public/uploads', async () => {
      const localProvider = new LocalStorageProvider();
      await expect(localProvider.openReadStream('/../canary.txt')).rejects.toThrow();
      await expect(localProvider.openReadStream('/images/placeholder.png')).rejects.toThrow();
    });

    it('returns null when metadata file is missing', async () => {
      const provider = getStorageProvider();
      (stat as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      const meta = await provider.getMetadata('uploads/nonexistent.png');
      expect(meta).toBeNull();
    });

    it('validates config successfully', async () => {
      const provider = getStorageProvider();
      const result = await provider.validateConfig();
      expect(result.valid).toBe(true);
    });
  });

  describe('S3StorageProvider configuration and urls via getStorageProvider', () => {
    let mockSend: jest.SpiedFunction<typeof S3Client.prototype.send>;
    let capturedForcePathStyle: boolean | undefined;

    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-west-2';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      capturedForcePathStyle = undefined;
      mockSend = jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation(function (this: S3Client) {
          capturedForcePathStyle = this.config.forcePathStyle;
          return Promise.resolve({} as never);
        });
    });

    afterEach(() => {
      mockSend.mockRestore();
    });

    it('initializes with correct AWS S3 endpoint, virtual-hosted style, and /uploads/* URL routing when S3_ENDPOINT and S3_PUBLIC_URL are absent', async () => {
      const provider = getStorageProvider();
      await provider.delete('uploads/test.png');

      const cmd = mockSend.mock.calls[0][0] as DeleteObjectCommand;
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(provider.getPublicUrl('uploads/test.png')).toBe('/uploads/test.png');
      expect(capturedForcePathStyle).toBe(false);
    });

    it('initializes with custom R2 endpoint, forcePathStyle enabled, and /uploads/* URL routing', async () => {
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint/';

      const provider = getStorageProvider();
      await provider.delete('https://custom.r2.endpoint/test-bucket/uploads/test.png');

      const cmd = mockSend.mock.calls[0][0] as DeleteObjectCommand;
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe('uploads/test.png');
      expect(capturedForcePathStyle).toBe(true);
      expect(provider.getPublicUrl('uploads/test.png')).toBe('/uploads/test.png');
    });

    it('initializes with custom endpoint, forcePathStyle enabled, S3_PUBLIC_URL legacy delete extraction, and /uploads/* URL routing', async () => {
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint';
      process.env.S3_PUBLIC_URL = 'https://pub-domain.com/';

      const provider = getStorageProvider();
      await provider.delete('https://pub-domain.com/uploads/test.png');

      const cmd = mockSend.mock.calls[0][0] as DeleteObjectCommand;
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe('uploads/test.png');
      expect(capturedForcePathStyle).toBe(true);
      expect(provider.getPublicUrl('uploads/test.png')).toBe('/uploads/test.png');
    });
  });

  describe('S3StorageProvider upload, delete, metadata, and validation via getStorageProvider', () => {
    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY_ID = 'access-123';
      process.env.S3_SECRET_ACCESS_KEY = 'secret-456';
    });

    it('uploads file normalized under uploads/* and returns /uploads/* StorageObject URL', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

      const file = {
        name: 'cloud.png',
        size: 500,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
      } as unknown as File;

      const result = await provider.upload(file, { folder: 'avatars', metadata: { userId: '123' } });

      expect(result.key).toMatch(/^uploads\/avatars\/[a-f0-9]{16}\.png$/);
      expect(result.url).toBe(`/${result.key}`);
      expect(result.metadata).toEqual({ userId: '123' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0] as PutObjectCommand;
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe(result.key);
      expect(cmd.input.ContentType).toBe('image/png');

      mockSend.mockRestore();
    });

    it('deletes object using DeleteObjectCommand', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

      await provider.delete('https://test-bucket.s3.us-east-1.amazonaws.com/uploads/item.png');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0] as DeleteObjectCommand;
      expect(cmd.input.Bucket).toBe('test-bucket');
      expect(cmd.input.Key).toBe('uploads/item.png');

      mockSend.mockRestore();
    });

    it('fetches metadata using HeadObjectCommand and derives mimeType from key extension instead of untrusted S3 ContentType', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
        ContentLength: 4096,
        ContentType: 'text/html',
        Metadata: { owner: 'admin' },
        ETag: '"etag-123"',
        LastModified: new Date('2026-05-01'),
      } as never);

      const meta = await provider.getMetadata('uploads/banner.jpg');

      expect(meta).toEqual({
        key: 'uploads/banner.jpg',
        url: '/uploads/banner.jpg',
        size: 4096,
        mimeType: 'image/jpeg',
        metadata: { owner: 'admin' },
        etag: '"etag-123"',
        updatedAt: new Date('2026-05-01'),
      });

      const unknownExtMeta = await provider.getMetadata('uploads/legacy.svg');
      expect(unknownExtMeta?.mimeType).toBe('application/octet-stream');

      mockSend.mockRestore();
    });

    it('streams S3 objects via openReadStream (GET & HEAD) and returns null on missing objects', async () => {
      const provider = getStorageProvider();
      const payloadBytes = new Uint8Array([1, 2, 3, 4]);
      const mockSend = jest
        .spyOn(S3Client.prototype, 'send')
        .mockImplementationOnce(async (cmd) => {
          expect(cmd).toBeInstanceOf(GetObjectCommand);
          return {
            ContentLength: payloadBytes.byteLength,
            ContentType: 'text/html',
            LastModified: new Date('2026-06-01T12:00:00Z'),
            Body: {
              transformToWebStream: () =>
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(payloadBytes);
                    controller.close();
                  },
                }),
            },
          } as never;
        })
        .mockImplementationOnce(async (cmd) => {
          expect(cmd).toBeInstanceOf(HeadObjectCommand);
          return {
            ContentLength: payloadBytes.byteLength,
            ContentType: 'text/html',
            LastModified: new Date('2026-06-01T12:00:00Z'),
          } as never;
        })
        .mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }) as never);

      const streamed = await provider.openReadStream('/uploads/photos/s3-item.jpg');
      expect(streamed).not.toBeNull();
      expect(streamed?.mimeType).toBe('image/jpeg');
      expect(streamed?.size).toBe(4);
      const chunks: Uint8Array[] = [];
      const reader = streamed!.stream!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(payloadBytes));

      const headMeta = await provider.openReadStream('uploads/photos/s3-item.jpg', {
        headOnly: true,
      });
      expect(headMeta?.stream).toBeUndefined();
      expect(headMeta?.size).toBe(4);

      const missing = await provider.openReadStream('uploads/photos/missing.jpg');
      expect(missing).toBeNull();

      await expect(provider.openReadStream('/../secret.txt')).rejects.toThrow();
      await expect(provider.openReadStream('images/static.jpg')).rejects.toThrow();

      mockSend.mockRestore();
    });

    it('returns null when HeadObjectCommand throws error', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('NotFound') as never);

      const meta = await provider.getMetadata('uploads/missing.jpg');
      expect(meta).toBeNull();

      mockSend.mockRestore();
    });

    it('validates configuration correctly', async () => {
      const provider = getStorageProvider();
      const result = await provider.validateConfig();
      expect(result.valid).toBe(true);
    });

    it('returns invalid configuration result when env vars are missing', async () => {
      const provider = getStorageProvider();
      delete process.env.S3_BUCKET;
      const result = await provider.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('S3_BUCKET');
    });

    it('strips outer quotes from S3_* env vars and rejects R2 S3_REGION=auto without S3_ENDPOINT or *.r2.cloudflarestorage.com without S3_PUBLIC_URL', async () => {
      process.env.S3_REGION = '"auto"';
      delete process.env.S3_ENDPOINT;
      expect(() => getStorageProvider()).toThrow(/S3_ENDPOINT/);

      resetStorageProvider();
      process.env.S3_ENDPOINT = '"https://acct123.r2.cloudflarestorage.com"';
      delete process.env.S3_PUBLIC_URL;
      expect(() => getStorageProvider()).toThrow(/S3_PUBLIC_URL/);

      resetStorageProvider();
      process.env.S3_BUCKET = '"quoted-bucket"';
      process.env.S3_PUBLIC_URL = '"https://assets.wedding.example.com/"';
      const provider = getStorageProvider();
      expect(provider.getPublicUrl('uploads/photo.jpg')).toBe('/uploads/photo.jpg');
      expect(await provider.validateConfig()).toEqual({ valid: true });

      delete process.env.S3_PUBLIC_URL;
      const missingPublicResult = await provider.validateConfig();
      expect(missingPublicResult.valid).toBe(false);
      expect(missingPublicResult.error).toContain('S3_PUBLIC_URL');

      delete process.env.S3_ENDPOINT;
      const missingEndpointResult = await provider.validateConfig();
      expect(missingEndpointResult.valid).toBe(false);
      expect(missingEndpointResult.error).toContain('S3_ENDPOINT');
    });
  });
});
