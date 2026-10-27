# Asset Storage System

This document outlines the architecture, usage, security policies, and configuration options for the application-level Asset Storage system.

---

## Overview

The asset storage system provides a provider-neutral abstraction layer (`StorageProvider`) that isolates application feature logic from vendor-specific storage SDKs.

It supports seamless dynamic switching between local filesystem storage (for development and testing) and S3-compatible cloud object storage (for production deployments across providers such as AWS S3, Cloudflare R2, MinIO, Backblaze B2, and DigitalOcean Spaces).

---

## Storage Interface

All storage operations are exposed via the `StorageProvider` interface defined in [src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts):

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
- Used when S3 credentials are not defined in environment variables (see [src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts#L384-L399)).
- Stores assets in the local directory under `public/uploads/` (or configured directory).
- Serves static files directly via relative public paths (e.g. `/uploads/abcd1234ef56789a.png`).

> ⚠️ **WARNING: Ephemeral Container Local Storage Hazard**
>
> Files uploaded when using `LocalStorageProvider` are saved directly to `public/uploads/` inside the local application container filesystem. Inside containerized environments (such as Docker or Kubernetes), this writable layer is **ephemeral**. If a container is restarted, updated, or recreated, all files stored in `public/uploads/` will be **permanently lost**.
>
> **Production Requirement:** When S3 object storage credentials are not configured in production environments, deployers **must** configure a persistent Docker volume mount pointing to `public/uploads/` (e.g., `-v /var/lib/wedding/uploads:/app/public/uploads` or a Docker Compose persistent volume definition) to ensure asset durability.

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

The application defines distinct file size and format validation rules for administrative asset uploads versus guest photo submissions:

#### Administrative Upload Constraints
- **Maximum File Size**: 5 MB (`MAX_UPLOAD_SIZE = 5 * 1024 * 1024`), defined in [src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts#L35).
- **Allowed MIME Types**: JPEG (`image/jpeg`), PNG (`image/png`), ICO (`image/x-icon`, `image/vnd.microsoft.icon`).
- **Allowed Extensions**: `.jpg`, `.jpeg`, `.png`, `.ico`.
- **Extension & MIME Consistency**: Uploaded file extensions must match declared MIME types.

#### Guest Photo Upload Constraints
- **Maximum File Size**: 10 MB (`MAX_GUEST_PHOTO_SIZE = 10 * 1024 * 1024`), defined in [src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts#L60-L63).
- **Allowed MIME Types**: JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`).
- **Allowed Extensions**: `.jpg`, `.jpeg`, `.png`, `.webp`.
- **Format & Size Differences**: Guest photo uploads support WebP and larger 10MB file payloads to accommodate high-resolution mobile device uploads, but exclude ICO support.

### 2. Image Sanitization & Processing Pipeline

All uploaded image files undergo server-side sanitization prior to persistence using `sharp` in [src/utils/imageProcessor.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessor.ts#L90-L103):
- **EXIF Metadata Stripping**: Strips all embedded EXIF metadata, GPS geotags, camera model identifiers, and timestamps to protect guest and administrator privacy.
- **Auto-Rotation**: Automatically rotates images based on embedded EXIF orientation tags (`.rotate()`) prior to metadata stripping so photos render with correct orientation.
- **Format Handling**: Sharp sanitization processes standard JPEG, PNG, and WebP image formats. Non-Sharp image formats (such as ICO) skip sanitization safely without error.

### 3. Worker Thread Offloading & Timeout Handling

To protect the main Node.js event loop from CPU-heavy image processing tasks, sanitization is offloaded to background worker threads using `offloadSanitizeToWorker` in [src/utils/imageProcessor.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessor.ts#L22-L42):
- **Worker Thread Execution**: Image buffer processing is executed inside a separate Node.js worker thread (`imageProcessorWorker.ts`).
- **Default 10-Second Worker Timeout**: A strict 10-second timeout (`timeoutMs = 10000`) is enforced per sanitization job.
- **Timeout & Error Behavior**: If worker execution exceeds 10 seconds or encounters unrecoverable corruption, worker execution is terminated (`worker.terminate()`) and an HTTP 400 error response is returned (`ApiError(400, 'Image sanitization failed. Worker thread timed out.')`).

### 4. Credential Safety
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
