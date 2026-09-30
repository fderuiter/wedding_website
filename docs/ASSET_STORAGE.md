# Asset Storage System

This document outlines the architecture, usage, security policies, and configuration options for the application-level Asset Storage system.

---

## Overview

The asset storage system provides a provider-neutral abstraction layer (`StorageProvider`) that isolates application feature logic from vendor-specific storage SDKs.

It supports seamless dynamic switching between local filesystem storage (for development and testing) and S3-compatible cloud object storage (for production deployments across providers such as AWS S3, Cloudflare R2, MinIO, Backblaze B2, and DigitalOcean Spaces).

---

## Storage Interface

All storage operations are exposed via the `StorageProvider` interface defined in `src/utils/storage.ts`:

```typescript
export interface StorageObject {
  key: string;           // Key/path in bucket or relative path (e.g., "uploads/abcdef1234567890.png")
  url: string;           // Fully resolved public URL
  size: number;          // File size in bytes
  mimeType: string;      // MIME type (e.g., "image/png")
  metadata?: Record<string, string>; // Optional custom metadata key-value pairs
  etag?: string;         // Optional ETag / version tag
  updatedAt?: Date;      // Optional last modified date
}

export interface UploadOptions {
  key?: string;          // Specific object key to use
  folder?: string;       // Directory/prefix (default: "uploads")
  metadata?: Record<string, string>; // Custom metadata
  contentType?: string;  // MIME type override
}

export interface StorageProvider {
  /** Upload file or buffer and receive full object metadata */
  upload(input: File | StorageUploadInputObject, options?: UploadOptions): Promise<StorageObject>;

  /** Backward-compatible helper returning public URL */
  uploadFile(file: File): Promise<{ url: string }>;

  /** Delete an asset by key or public URL */
  delete(keyOrUrl: string): Promise<void>;

  /** Resolve public URL for a key or URL */
  getPublicUrl(keyOrUrl: string): string;

  /** Fetch object metadata if present */
  getMetadata(keyOrUrl: string): Promise<StorageObject | null>;

  /** Validate provider configuration and health status */
  validateConfig(): Promise<StorageValidationResult>;
}
```

---

## Storage Adapters

### 1. Local Development (`LocalStorageProvider`)
- Used when S3 credentials are not defined in environment variables.
- Stores assets in the local directory under `public/uploads/` (or configured directory).
- Serves static files directly via relative public paths (e.g. `/uploads/abcd1234ef56789a.png`).

### 2. S3-Compatible Production (`S3StorageProvider`)
- Used when all required S3 credentials are configured in environment variables.
- Built using AWS SDK v3 (`@aws-sdk/client-s3`).
- Vendor SDK usage is strictly restricted inside adapter boundaries.
- Supports any S3-compatible object storage vendor, including:
  - **AWS S3**: Default endpoint format (`https://{bucket}.s3.{region}.amazonaws.com`)
  - **Cloudflare R2**: Configured via `S3_ENDPOINT` (e.g., `https://{account_id}.r2.cloudflarestorage.com`)
  - **MinIO / Self-Hosted**: Configured via `S3_ENDPOINT`
  - **Backblaze B2**: Configured via `S3_ENDPOINT`

---

## Environment Configuration

| Variable | Required for S3 | Description |
| :--- | :--- | :--- |
| `S3_BUCKET` | Yes | Target storage bucket name |
| `S3_REGION` | Yes | Storage region (e.g. `us-east-1` or `auto` for Cloudflare R2) |
| `S3_ACCESS_KEY_ID` | Yes | Storage access key ID |
| `S3_SECRET_ACCESS_KEY` | Yes | Storage secret access key |
| `S3_ENDPOINT` | Optional | Custom S3 endpoint URL for non-AWS S3 providers (R2, MinIO, B2) |
| `S3_PUBLIC_URL` | Optional | Public CDN or custom domain URL prefix (e.g., `https://cdn.example.com`) |

### Validation Behavior
- If **no** S3 variables are set, the system automatically defaults to `LocalStorageProvider`.
- If **all** required S3 variables are set, the system instantiates `S3StorageProvider`.
- If **partial/inconsistent** S3 variables are provided (e.g., `S3_BUCKET` is set without `S3_SECRET_ACCESS_KEY`), initialization fails clearly with an error detailing the missing credentials.

---

## Security Policies & Security Controls

### 1. File Type and Size Validation
- **Maximum File Size**: 5 MB (`MAX_UPLOAD_SIZE = 5 * 1024 * 1024`).
- **Allowed MIME Types**: JPEG (`image/jpeg`), PNG (`image/png`), ICO (`image/x-icon`, `image/vnd.microsoft.icon`).
- **Extension & MIME Consistency**: Uploaded file extensions must match declared MIME types.

### 2. Image Sanitization
- All image uploads undergo server-side sanitization prior to storage using `sharp`.
- EXIF data, embedded metadata, and potential code payloads are stripped.

### 3. Credential Safety
- Cloud credentials (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are exclusively accessible on the server side (Node.js runtime).
- Credentials are **never** prefixed with `NEXT_PUBLIC_` and are never bundled into client browser code.

---

## Business Logic Decoupling

Application components and API endpoints access storage solely through the factory function:

```typescript
import { getStorageProvider } from '@/utils/storage';

const storage = getStorageProvider();
const object = await storage.upload(file);
```

Switching between local storage, AWS S3, Cloudflare R2, or MinIO requires zero changes to application feature or route code.
