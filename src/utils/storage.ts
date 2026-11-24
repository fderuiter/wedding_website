import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
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
   * Open a read stream (or metadata-only result when headOnly is true) for an uploaded asset.
   */
  openReadStream(
    keyOrUrl: string,
    options?: { headOnly?: boolean }
  ): Promise<LocalUploadStreamResult | null>;

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

function readNormalizedS3Env(key: string): string | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return unquoted.length > 0 ? unquoted : undefined;
}

function isCloudflareR2ApiEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'r2.cloudflarestorage.com' || host.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return /(?:^|\/\/|\.)r2\.cloudflarestorage\.com(?:[:/]|$)/i.test(endpoint);
  }
}

function getR2ConfigurationError(
  region: string | undefined,
  endpoint: string | undefined,
  publicUrl: string | undefined
): string | null {
  if (region?.toLowerCase() === 'auto' && !endpoint) {
    return 'Cloudflare R2 configurations with S3_REGION=auto must specify S3_ENDPOINT (for example, https://<ACCOUNT_ID>.r2.cloudflarestorage.com).';
  }
  if (endpoint && isCloudflareR2ApiEndpoint(endpoint) && !publicUrl) {
    return 'Cloudflare R2 private API endpoints (*.r2.cloudflarestorage.com) cannot serve public assets directly; configure S3_PUBLIC_URL.';
  }
  return null;
}

class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    const bucket = readNormalizedS3Env('S3_BUCKET');
    const region = readNormalizedS3Env('S3_REGION');
    const accessKeyId = readNormalizedS3Env('S3_ACCESS_KEY_ID');
    const secretAccessKey = readNormalizedS3Env('S3_SECRET_ACCESS_KEY');
    const endpoint = readNormalizedS3Env('S3_ENDPOINT');
    const publicUrl = readNormalizedS3Env('S3_PUBLIC_URL');

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 Storage Provider requires all credentials to be configured.');
    }

    const r2Error = getR2ConfigurationError(region, endpoint, publicUrl);
    if (r2Error) {
      throw new Error(r2Error);
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

  private normalizeUploadsKey(rawInput: string, ensureUploadsPrefix: boolean): string {
    if (
      typeof rawInput !== 'string' ||
      rawInput.includes('\0') ||
      rawInput.includes('\\') ||
      /%(?:00|2e|2f|5c)/i.test(rawInput)
    ) {
      throw new PathContainmentError('Key or URL contains disallowed characters');
    }

    const trimmed = rawInput.replace(/^\/+|\/+$/g, '');
    if (trimmed.includes('//')) {
      throw new PathContainmentError('Key or URL contains empty path segments');
    }

    const segments = trimmed ? trimmed.split('/') : [];
    for (const seg of segments) {
      if (seg === '.' || seg === '..') {
        throw new PathContainmentError('Path traversal segment is forbidden');
      }
    }

    if (!ensureUploadsPrefix) {
      return trimmed;
    }

    if (!trimmed || trimmed === 'uploads') {
      return 'uploads';
    }
    if (trimmed.startsWith('uploads/')) {
      return trimmed;
    }
    return `uploads/${trimmed}`;
  }

  private extractKey(keyOrUrl: string): string {
    if (
      typeof keyOrUrl !== 'string' ||
      keyOrUrl.includes('\0') ||
      keyOrUrl.includes('\\') ||
      /%(?:00|2e|2f|5c)/i.test(keyOrUrl)
    ) {
      throw new PathContainmentError('Key or URL contains disallowed characters');
    }

    if (this.publicUrl && keyOrUrl.startsWith(`${this.publicUrl}/`)) {
      const stripped = keyOrUrl.slice(this.publicUrl.length + 1).split('?')[0].split('#')[0];
      return this.normalizeUploadsKey(stripped, false);
    }

    if (keyOrUrl.startsWith('http://') || keyOrUrl.startsWith('https://')) {
      try {
        const parsed = new URL(keyOrUrl);
        let pathname = parsed.pathname.replace(/^\/+/, '');
        if (pathname.startsWith(`${this.bucket}/`)) {
          pathname = pathname.substring(this.bucket.length + 1);
        }
        return this.normalizeUploadsKey(pathname, false);
      } catch (err) {
        if (err instanceof PathContainmentError) {
          throw err;
        }
      }
    }

    const withoutQuery = keyOrUrl.split('?')[0].split('#')[0];
    return this.normalizeUploadsKey(withoutQuery, false);
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
      key = this.normalizeUploadsKey(options.key, true);
    } else {
      const folder = options?.folder ?? 'uploads';
      const cleanFolder = this.normalizeUploadsKey(folder, true);
      const hash = crypto.randomBytes(8).toString('hex');
      const ext = getNormalizedExtension(mimeType, filename);
      const fileWithExt = `${hash}${ext}`;
      key = `${cleanFolder}/${fileWithExt}`;
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
    if (!key) {
      throw new PathContainmentError('Storage key is required');
    }
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
    if (cleanKey === 'uploads' || cleanKey.startsWith('uploads/')) {
      return `/${cleanKey}`;
    }
    return cleanKey ? `/uploads/${cleanKey}` : '/uploads';
  }

  async getMetadata(keyOrUrl: string): Promise<StorageObject | null> {
    const key = this.extractKey(keyOrUrl);
    if (!key) {
      return null;
    }
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
        mimeType: response.ContentType ?? getLocalUploadMimeType(key),
        metadata: response.Metadata,
        etag: response.ETag,
        updatedAt: response.LastModified,
      };
    } catch {
      return null;
    }
  }

  private static isS3NotFoundError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }
    const candidate = err as {
      name?: string;
      Code?: string;
      code?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      candidate.name === 'NotFound' ||
      candidate.name === 'NoSuchKey' ||
      candidate.Code === 'NoSuchKey' ||
      candidate.Code === 'NotFound' ||
      candidate.code === 'ENOENT' ||
      candidate.$metadata?.httpStatusCode === 404
    );
  }

  async openReadStream(
    keyOrUrl: string,
    options?: { headOnly?: boolean }
  ): Promise<LocalUploadStreamResult | null> {
    const key = this.extractKey(keyOrUrl);
    if (!key.startsWith('uploads/') || key === 'uploads/') {
      throw new PathContainmentError('Upload key must stay within uploads/');
    }

    try {
      if (options?.headOnly) {
        const headRes = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: key,
          })
        );
        return {
          key,
          size: headRes.ContentLength ?? 0,
          mimeType: headRes.ContentType || getLocalUploadMimeType(key),
          updatedAt: headRes.LastModified ?? new Date(0),
        };
      }

      const getRes = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      const body = getRes.Body as
        | {
          transformToWebStream?: () => ReadableStream<Uint8Array>;
          pipe?: unknown;
        }
        | ReadableStream<Uint8Array>
        | Uint8Array
        | undefined;

      if (!body) {
        return null;
      }

      let webStream: ReadableStream<Uint8Array>;
      if (typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
        webStream = (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
      } else if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
        webStream = body;
      } else if (body instanceof Uint8Array) {
        const bytes = new Uint8Array(body);
        webStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      } else if (typeof (body as { pipe?: unknown }).pipe === 'function') {
        const { Readable } = await import('stream');
        webStream = Readable.toWeb(
          body as unknown as import('stream').Readable
        ) as unknown as ReadableStream<Uint8Array>;
      } else {
        return null;
      }

      return {
        key,
        size: getRes.ContentLength ?? 0,
        mimeType: getRes.ContentType || getLocalUploadMimeType(key),
        updatedAt: getRes.LastModified ?? new Date(0),
        stream: webStream,
      };
    } catch (err: unknown) {
      if (err instanceof PathContainmentError) {
        throw err;
      }
      if (S3StorageProvider.isS3NotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  async validateConfig(): Promise<StorageValidationResult> {
    const bucket = readNormalizedS3Env('S3_BUCKET');
    const region = readNormalizedS3Env('S3_REGION');
    const accessKeyId = readNormalizedS3Env('S3_ACCESS_KEY_ID');
    const secretAccessKey = readNormalizedS3Env('S3_SECRET_ACCESS_KEY');
    const endpoint = readNormalizedS3Env('S3_ENDPOINT');
    const publicUrl = readNormalizedS3Env('S3_PUBLIC_URL');

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

    const r2Error = getR2ConfigurationError(region, endpoint, publicUrl);
    if (r2Error) {
      return {
        valid: false,
        error: r2Error,
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
  const presentKeys = s3Keys.filter((key) => Boolean(readNormalizedS3Env(key)));

  if (presentKeys.length > 0 && presentKeys.length < s3Keys.length) {
    const missingKeys = s3Keys.filter((key) => !readNormalizedS3Env(key));
    throw new Error(`Incomplete S3 credentials: Missing ${missingKeys.join(', ')}`);
  }

  const r2Error = getR2ConfigurationError(
    readNormalizedS3Env('S3_REGION'),
    readNormalizedS3Env('S3_ENDPOINT'),
    readNormalizedS3Env('S3_PUBLIC_URL')
  );
  if (r2Error) {
    throw new Error(r2Error);
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
