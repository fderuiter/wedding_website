import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { writeFile, unlink, stat, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getNormalizedExtension } from './validation';

export interface StorageObject {
  key: string;
  url: string;
  size: number;
  mimeType: string;
  metadata?: Record<string, string>;
  etag?: string;
  updatedAt?: Date;
}

export interface UploadOptions {
  key?: string;
  folder?: string;
  metadata?: Record<string, string>;
  contentType?: string;
}

export interface StorageUploadInputObject {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export type StorageUploadInput = File | StorageUploadInputObject;

export interface StorageValidationResult {
  valid: boolean;
  error?: string;
}

export interface StorageProvider {
  /**
   * Upload an asset and receive complete storage metadata.
   */
  upload(input: StorageUploadInput, options?: UploadOptions): Promise<StorageObject>;

  /**
   * Backward-compatible helper method returning `{ url }`.
   */
  uploadFile(file: File): Promise<{ url: string }>;

  /**
   * Delete an asset by key or public URL.
   */
  delete(keyOrUrl: string): Promise<void>;

  /**
   * Resolve public URL for a key or URL.
   */
  getPublicUrl(keyOrUrl: string): string;

  /**
   * Fetch metadata for an asset if it exists.
   */
  getMetadata(keyOrUrl: string): Promise<StorageObject | null>;

  /**
   * Validate provider configuration and operational health.
   */
  validateConfig(): Promise<StorageValidationResult>;
}

class LocalStorageProvider implements StorageProvider {
  private publicDir: string;

  constructor(publicDir?: string) {
    this.publicDir = publicDir || path.join(process.cwd(), 'public');
  }

  private extractKey(keyOrUrl: string): string {
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      try {
        const parsed = new URL(keyOrUrl);
        return parsed.pathname.replace(/^\/+/, '');
      } catch {
        // Fallback if URL parsing fails
      }
    }
    return keyOrUrl.replace(/^\/+/, '');
  }

  async upload(input: StorageUploadInput, options?: UploadOptions): Promise<StorageObject> {
    let buffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (typeof (input as File).arrayBuffer === 'function') {
      const file = input as File;
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
      mimeType = options?.contentType || file.type || 'application/octet-stream';
    } else {
      const obj = input as StorageUploadInputObject;
      buffer = obj.buffer;
      filename = obj.filename;
      mimeType = options?.contentType || obj.mimeType || 'application/octet-stream';
    }

    let key: string;
    if (options?.key) {
      key = options.key.replace(/^\/+/, '');
    } else {
      const folder = options?.folder ?? 'uploads';
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = getNormalizedExtension(mimeType, filename);
      const fileWithExt = `${hash}${ext}`;
      key = folder ? `${folder}/${fileWithExt}` : fileWithExt;
    }

    const filePath = path.join(this.publicDir, ...key.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);

    const url = this.getPublicUrl(key);

    return {
      key,
      url,
      size: buffer.length,
      mimeType,
      metadata: options?.metadata,
      updatedAt: new Date(),
    };
  }

  async uploadFile(file: File): Promise<{ url: string }> {
    const result = await this.upload(file);
    return { url: result.url };
  }

  async delete(keyOrUrl: string): Promise<void> {
    const key = this.extractKey(keyOrUrl);
    const filePath = path.join(this.publicDir, ...key.split('/'));
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  getPublicUrl(keyOrUrl: string): string {
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      return keyOrUrl;
    }
    const cleanKey = keyOrUrl.replace(/^\/+/, '');
    return `/${cleanKey}`;
  }

  async getMetadata(keyOrUrl: string): Promise<StorageObject | null> {
    const key = this.extractKey(keyOrUrl);
    const filePath = path.join(this.publicDir, ...key.split('/'));
    try {
      const stats = await stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.ico') mimeType = 'image/x-icon';

      return {
        key,
        url: this.getPublicUrl(key),
        size: stats.size,
        mimeType,
        updatedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async validateConfig(): Promise<StorageValidationResult> {
    try {
      await mkdir(path.join(this.publicDir, 'uploads'), { recursive: true });
      return { valid: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Local storage directory unavailable: ${message}` };
    }
  }
}

class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.S3_ENDPOINT;
    const publicUrl = process.env.S3_PUBLIC_URL;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 Storage Provider requires all credentials to be configured.');
    }

    this.bucket = bucket;

    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      endpoint: endpoint || undefined,
      forcePathStyle: endpoint ? true : undefined,
    });

    if (publicUrl) {
      this.publicUrl = publicUrl.replace(/\/$/, '');
    } else if (endpoint) {
      this.publicUrl = `${endpoint.replace(/\/$/, '')}/${bucket}`;
    } else {
      this.publicUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
    }
  }

  getBucket(): string {
    return this.bucket;
  }

  getPublicUrlPrefix(): string {
    return this.publicUrl;
  }

  getClient(): S3Client {
    return this.client;
  }

  private extractKey(keyOrUrl: string): string {
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      try {
        const parsed = new URL(keyOrUrl);
        let pathname = parsed.pathname.replace(/^\/+/, '');
        if (pathname.startsWith(`${this.bucket}/`)) {
          pathname = pathname.substring(this.bucket.length + 1);
        }
        return pathname;
      } catch {
        // Fallback
      }
    }
    return keyOrUrl.replace(/^\/+/, '');
  }

  async upload(input: StorageUploadInput, options?: UploadOptions): Promise<StorageObject> {
    let buffer: Buffer;
    let filename: string;
    let mimeType: string;

    if (typeof (input as File).arrayBuffer === 'function') {
      const file = input as File;
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
      mimeType = options?.contentType || file.type || 'application/octet-stream';
    } else {
      const obj = input as StorageUploadInputObject;
      buffer = obj.buffer;
      filename = obj.filename;
      mimeType = options?.contentType || obj.mimeType || 'application/octet-stream';
    }

    let key: string;
    if (options?.key) {
      key = options.key.replace(/^\/+/, '');
    } else {
      const folder = options?.folder ?? 'uploads';
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = getNormalizedExtension(mimeType, filename);
      const fileWithExt = `${hash}${ext}`;
      key = folder ? `${folder}/${fileWithExt}` : fileWithExt;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        Metadata: options?.metadata,
      })
    );

    const url = this.getPublicUrl(key);

    return {
      key,
      url,
      size: buffer.length,
      mimeType,
      metadata: options?.metadata,
      updatedAt: new Date(),
    };
  }

  async uploadFile(file: File): Promise<{ url: string }> {
    const result = await this.upload(file);
    return { url: result.url };
  }

  async delete(keyOrUrl: string): Promise<void> {
    const key = this.extractKey(keyOrUrl);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  getPublicUrl(keyOrUrl: string): string {
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      return keyOrUrl;
    }
    const cleanKey = keyOrUrl.replace(/^\/+/, '');
    return `${this.publicUrl}/${cleanKey}`;
  }

  async getMetadata(keyOrUrl: string): Promise<StorageObject | null> {
    const key = this.extractKey(keyOrUrl);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return {
        key,
        url: this.getPublicUrl(key),
        size: response.ContentLength ?? 0,
        mimeType: response.ContentType ?? 'application/octet-stream',
        metadata: response.Metadata,
        etag: response.ETag,
        updatedAt: response.LastModified,
      };
    } catch {
      return null;
    }
  }

  async validateConfig(): Promise<StorageValidationResult> {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      const missing = [];
      if (!bucket) missing.push('S3_BUCKET');
      if (!region) missing.push('S3_REGION');
      if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID');
      if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');

      return {
        valid: false,
        error: `Incomplete S3 storage credentials: Missing ${missing.join(', ')}`,
      };
    }

    return { valid: true };
  }
}

let storageProviderInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageProviderInstance) {
    return storageProviderInstance;
  }

  const s3Keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const presentKeys = s3Keys.filter((key) => !!process.env[key]);

  if (presentKeys.length > 0 && presentKeys.length < s3Keys.length) {
    const missingKeys = s3Keys.filter((key) => !process.env[key]);
    throw new Error(`Incomplete S3 credentials: Missing ${missingKeys.join(', ')}`);
  }

  if (presentKeys.length === s3Keys.length) {
    storageProviderInstance = new S3StorageProvider();
  } else {
    storageProviderInstance = new LocalStorageProvider();
  }

  return storageProviderInstance;
}

export function resetStorageProvider(): void {
  storageProviderInstance = null;
}
