/** @jest-environment node */

import {
  LocalStorageProvider,
  S3StorageProvider,
  getStorageProvider,
  resetStorageProvider,
} from '../storage';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFile } from 'fs/promises';
import path from 'path';

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
}));

describe('Hybrid Storage Provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    resetStorageProvider();
    // Reset process.env to pristine state
    process.env = { ...originalEnv };
    // Remove any S3 variables
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
      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it('returns S3StorageProvider when S3 environment variables are fully populated', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY_ID = 'test-access-key';
      process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

      const provider = getStorageProvider();
      expect(provider).toBeInstanceOf(S3StorageProvider);
    });
  });

  describe('LocalStorageProvider', () => {
    it('writes the uploaded file to the local directory and returns a local URL', async () => {
      const provider = new LocalStorageProvider();
      
      const file = {
        name: 'test-image.png',
        size: 1024,
        type: 'image/png',
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as File;

      const result = await provider.uploadFile(file);

      expect(result.url).toMatch(/^\/uploads\/[a-f0-9]{16}\.png$/);
      expect(writeFile).toHaveBeenCalledTimes(1);
      
      const [filePath, buffer] = (writeFile as jest.Mock).mock.calls[0];
      expect(filePath).toContain(path.join('public', 'uploads'));
      expect(filePath).toMatch(/[a-f0-9]{16}\.png$/);
      expect(buffer).toEqual(Buffer.from([1, 2, 3]));
    });
  });

  describe('S3StorageProvider configuration and urls', () => {
    it('initializes with correct AWS S3 endpoint and public URL when S3_ENDPOINT and S3_PUBLIC_URL are absent', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-west-2';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';

      const provider = new S3StorageProvider();
      expect(provider.getBucket()).toBe('test-bucket');
      expect(provider.getPublicUrl()).toBe('https://test-bucket.s3.us-west-2.amazonaws.com');
    });

    it('initializes with custom endpoint and endpoint-based public URL fallback', () => {
      process.env.S3_BUCKET = 'my-bucket';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint';

      const provider = new S3StorageProvider();
      expect(provider.getPublicUrl()).toBe('https://custom.r2.endpoint/my-bucket');
    });

    it('initializes with custom endpoint and S3_PUBLIC_URL when both are provided', () => {
      process.env.S3_BUCKET = 'my-bucket';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.S3_ENDPOINT = 'https://custom.r2.endpoint';
      process.env.S3_PUBLIC_URL = 'https://pub-domain.com';

      const provider = new S3StorageProvider();
      expect(provider.getPublicUrl()).toBe('https://pub-domain.com');
    });
  });

  describe('S3StorageProvider upload', () => {
    it('uploads file to S3 and returns public URL', async () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'us-east-1';
      process.env.S3_ACCESS_KEY_ID = 'access';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';

      const provider = new S3StorageProvider();
      
      const file = {
        name: 'hello.jpg',
        size: 500,
        type: 'image/jpeg',
        arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
      } as unknown as File;

      const mockSend = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as any);

      const result = await provider.uploadFile(file);

      expect(result.url).toMatch(/^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/uploads\/[a-f0-9]{16}\.jpg$/);
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      const command = mockSend.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('test-bucket');
      expect(command.input.Key).toMatch(/^uploads\/[a-f0-9]{16}\.jpg$/);
      expect(command.input.ContentType).toBe('image/jpeg');
      expect(command.input.Body).toEqual(Buffer.from([4, 5, 6]));

      mockSend.mockRestore();
    });
  });

  describe('Incomplete cloud credentials', () => {
    it('throws error when creating S3StorageProvider with missing credentials', () => {
      process.env.S3_BUCKET = 'test-bucket';
      // Missing region, access key, secret key

      expect(() => new S3StorageProvider()).toThrow('S3 Storage Provider requires all credentials to be configured.');
    });
  });
});
