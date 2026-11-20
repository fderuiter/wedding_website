import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import crypto from 'crypto';
import { getNormalizedExtension } from './validation';
import {
  PathContainmentError,
  resolveContainedExistingPath,
  resolveContainedWritePath,
} from './pathContainment';

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

export interface LocalUploadStreamResult {
  key: string;
  size: number;
  mimeType: string;
  updatedAt: Date;
  stream?: ReadableStream<Uint8Array>;
}

function getLocalUploadMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

/**
 * @internal Exported for direct containment testing with isolated publicDir directories.
 */
export class LocalStorageProvider implements StorageProvider {
  private publicDir: string;

  constructor(publicDir?: string) {
    this.publicDir = publicDir || path.join(process.cwd(), 'public');
  }

  private getUploadsRoot(): string {
    return path.join(this.publicDir, 'uploads');
  }

  private extractKey(keyOrUrl: string): string {
    if (typeof keyOrUrl !== 'string' || keyOrUrl.includes('\0') || keyOrUrl.includes('\\')) {
      throw new PathContainmentError('Key or URL contains disallowed characters');
    }
    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      const schemeEnd = keyOrUrl.indexOf('://');
      const slashIdx = keyOrUrl.indexOf('/', schemeEnd + 3);
      if (slashIdx !== -1) {
        return keyOrUrl.slice(slashIdx).split('?')[0].split('#')[0].replace(/^\/+/, '');
      }
      return '';
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
      if (options.key.includes('\0') || options.key.includes('\\')) {
        throw new PathContainmentError('Storage key contains disallowed characters');
      }
      key = options.key.replace(/^\/+/, '');
    } else {
      const folder = options?.folder ?? 'uploads';
      if (folder.includes('\0') || folder.includes('\\')) {
        throw new PathContainmentError('Storage folder contains disallowed characters');
      }
      const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = getNormalizedExtension(mimeType, filename);
      const fileWithExt = `${hash}${ext}`;
      key = cleanFolder ? `${cleanFolder}/${fileWithExt}` : fileWithExt;
    }

    const filePath = await resolveContainedWritePath(key, {
      baseDir: this.publicDir,
      containmentRoot: this.getUploadsRoot(),
    });
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, buffer);

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

  async delete(keyOrUrl: string): Promise<void> {
    const key = this.extractKey(keyOrUrl);
    const resolved = await resolveContainedExistingPath(key, {
      baseDir: this.publicDir,
      containmentRoot: this.getUploadsRoot(),
    });
    if (!resolved.exists) {
      return;
    }

    const fs = await import('fs/promises');
    if (typeof fs.lstat === 'function') {
      try {
        const st = await fs.lstat(resolved.realPath);
        if (st.isSymbolicLink() || !st.isFile()) {
          throw new PathContainmentError('Refusing to delete non-regular file');
        }
      } catch (err: unknown) {
        if (err instanceof PathContainmentError) {
          throw err;
        }
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'ENOENT') {
          return;
        }
        throw err;
      }
    }

    try {
      await fs.unlink(resolved.realPath);
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
    const resolved = await resolveContainedExistingPath(key, {
      baseDir: this.publicDir,
      containmentRoot: this.getUploadsRoot(),
    });
    if (!resolved.exists) {
      return null;
    }

    const fs = await import('fs/promises');
    try {
      const stats = await fs.stat(resolved.realPath);
      if (typeof stats.isFile === 'function' && !stats.isFile()) {
        return null;
      }
      const mimeType = getLocalUploadMimeType(resolved.realPath);

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

  async openReadStream(
    keyOrUrl: string,
    options?: { headOnly?: boolean }
  ): Promise<LocalUploadStreamResult | null> {
    const key = this.extractKey(keyOrUrl);
    const uploadsRoot = this.getUploadsRoot();
    const resolved = await resolveContainedExistingPath(key, {
      baseDir: this.publicDir,
      containmentRoot: uploadsRoot,
    });

    const fs = await import('fs/promises');
    if (typeof fs.lstat === 'function') {
      const relInsideUploads = key.replace(/^\/+/, '').replace(/^uploads\/?/, '');
      const segments = relInsideUploads.split('/').filter(Boolean);
      let currentPath = path.resolve(uploadsRoot);
      for (const seg of segments) {
        currentPath = path.join(currentPath, seg);
        try {
          const segStat = await fs.lstat(currentPath);
          if (segStat.isSymbolicLink()) {
            throw new PathContainmentError('Symbolic links are not permitted in uploads');
          }
        } catch (err: unknown) {
          if (err instanceof PathContainmentError) {
            throw err;
          }
          if (
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            ((err as { code: string }).code === 'ENOENT' || (err as { code: string }).code === 'ENOTDIR')
          ) {
            return null;
          }
          throw err;
        }
      }
    }

    if (!resolved.exists) {
      return null;
    }

    try {
      const stats = typeof fs.lstat === 'function'
        ? await fs.lstat(resolved.realPath)
        : await fs.stat(resolved.realPath);
      if (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink()) {
        throw new PathContainmentError('Symbolic links are not permitted in uploads');
      }
      if (typeof stats.isFile === 'function' && !stats.isFile()) {
        return null;
      }

      const mimeType = getLocalUploadMimeType(resolved.realPath);
      if (options?.headOnly) {
        return {
          key,
          size: stats.size,
          mimeType,
          updatedAt: stats.mtime,
        };
      }

      const nodeFs = await import('fs');
      const { Readable } = await import('stream');
      const nodeStream = nodeFs.createReadStream(resolved.realPath);
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

      return {
        key,
        size: stats.size,
        mimeType,
        updatedAt: stats.mtime,
        stream: webStream,
      };
    } catch (err: unknown) {
      if (err instanceof PathContainmentError) {
        throw err;
      }
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'ENOENT'
      ) {
        return null;
      }
      throw err;
    }
  }

  async validateConfig(): Promise<StorageValidationResult> {
    const fs = await import('fs/promises');
    try {
      await fs.mkdir(this.getUploadsRoot(), { recursive: true });
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

/**
 * @internal Reset cached storage provider instance for testing purposes only.
 */
export function resetStorageProvider(): void {
  storageProviderInstance = null;
}
