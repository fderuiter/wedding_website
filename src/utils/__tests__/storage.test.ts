/** @jest-environment node */

import {
  getStorageProvider,
  resetStorageProvider,
  StorageUploadInputObject,
} from '../storage';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { writeFile, unlink, stat } from 'fs/promises';
import path from 'path';

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
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

      const result = await provider.upload(file, { folder: 'photos', metadata: { author: 'Alice' } });

      expect(result.key).toMatch(/^photos\/[a-f0-9]{16}\.png$/);
      expect(result.url).toBe(`/${result.key}`);
      expect(result.size).toBe(3);
      expect(result.mimeType).toBe('image/png');
      expect(result.metadata).toEqual({ author: 'Alice' });

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [filePath, buffer] = (writeFile as jest.Mock).mock.calls[0];
      expect(filePath).toContain(path.join(process.cwd(), 'public', 'photos'));
      expect(buffer).toEqual(Buffer.from([1, 2, 3]));
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

    it('supports backward-compatible uploadFile', async () => {
      const provider = getStorageProvider();
      const file = {
        name: 'legacy.png',
        size: 512,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      } as unknown as File;

      const result = await provider.uploadFile(file);
      expect(result.url).toMatch(/^\/uploads\/[a-f0-9]{16}\.png$/);
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

    it('fetches metadata for an existing file', async () => {
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
    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-west-2';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
    });

    it('initializes with correct AWS S3 endpoint and public URL when S3_ENDPOINT and S3_PUBLIC_URL are absent', () => {
      const provider = getStorageProvider() as any;
      expect(provider.getBucket()).toBe('test-bucket');
      expect(provider.getPublicUrl('uploads/test.png')).toBe(
        'https://test-bucket.s3.us-west-2.amazonaws.com/uploads/test.png'
      );
    });

    it('initializes with custom endpoint and endpoint-based public URL fallback', () => {
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint';

      const provider = getStorageProvider() as any;
      expect(provider.getPublicUrl('uploads/test.png')).toBe('https://custom.r2.endpoint/test-bucket/uploads/test.png');
    });

    it('initializes with custom endpoint and S3_PUBLIC_URL when both are provided', () => {
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint';
      process.env.S3_PUBLIC_URL = 'https://pub-domain.com';

      const provider = getStorageProvider() as any;
      expect(provider.getPublicUrl('uploads/test.png')).toBe('https://pub-domain.com/uploads/test.png');
    });
  });

  describe('S3StorageProvider upload, delete, metadata, and validation via getStorageProvider', () => {
    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY_ID = 'access-123';
      process.env.S3_SECRET_ACCESS_KEY = 'secret-456';
    });

    it('uploads file and returns StorageObject', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

      const file = {
        name: 'cloud.png',
        size: 500,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
      } as unknown as File;

      const result = await provider.upload(file, { folder: 'avatars', metadata: { userId: '123' } });

      expect(result.key).toMatch(/^avatars\/[a-f0-9]{16}\.png$/);
      expect(result.url).toBe(`https://test-bucket.s3.us-east-1.amazonaws.com/${result.key}`);
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

    it('fetches metadata using HeadObjectCommand', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
        ContentLength: 4096,
        ContentType: 'image/jpeg',
        Metadata: { owner: 'admin' },
        ETag: '"etag-123"',
        LastModified: new Date('2026-05-01'),
      } as never);

      const meta = await provider.getMetadata('uploads/banner.jpg');

      expect(meta).toEqual({
        key: 'uploads/banner.jpg',
        url: 'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/banner.jpg',
        size: 4096,
        mimeType: 'image/jpeg',
        metadata: { owner: 'admin' },
        etag: '"etag-123"',
        updatedAt: new Date('2026-05-01'),
      });

      mockSend.mockRestore();
    });

    it('returns null when HeadObjectCommand throws error', async () => {
      const provider = getStorageProvider();
      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('NotFound'));

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
  });
});
