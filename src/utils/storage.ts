import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface StorageProvider {
  uploadFile(file: File): Promise<{ url: string }>;
}

export class LocalStorageProvider implements StorageProvider {
  async uploadFile(file: File): Promise<{ url: string }> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.randomBytes(8).toString('hex');
    const ext = file.name.substring(file.name.lastIndexOf('.'));
    const filename = `${hash}${ext}`;

    const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
    await writeFile(filePath, buffer);

    return { url: `/uploads/${filename}` };
  }
}

export class S3StorageProvider implements StorageProvider {
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

  // Expose bucket and publicUrl for testing verification without module-level mocks
  getBucket(): string {
    return this.bucket;
  }

  getPublicUrl(): string {
    return this.publicUrl;
  }

  getClient(): S3Client {
    return this.client;
  }

  async uploadFile(file: File): Promise<{ url: string }> {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.randomBytes(8).toString('hex');
    const ext = file.name.substring(file.name.lastIndexOf('.'));
    const filename = `${hash}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `uploads/${filename}`,
        Body: buffer,
        ContentType: file.type,
      })
    );

    return { url: `${this.publicUrl}/uploads/${filename}` };
  }
}

let storageProviderInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageProviderInstance) {
    return storageProviderInstance;
  }

  const isS3Configured =
    process.env.S3_BUCKET &&
    process.env.S3_REGION &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY;

  if (isS3Configured) {
    storageProviderInstance = new S3StorageProvider();
  } else {
    storageProviderInstance = new LocalStorageProvider();
  }

  return storageProviderInstance;
}

export function resetStorageProvider(): void {
  storageProviderInstance = null;
}
