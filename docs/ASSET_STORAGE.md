# Asset Storage System

This document outlines the architecture, usage, security policies, media lifecycles, and configuration options for the application-level Asset Storage system.

---

## Overview

The asset storage system provides a provider-neutral abstraction layer (`StorageProvider`) that isolates application feature logic from vendor-specific storage SDKs.

It supports seamless dynamic switching between local filesystem storage (for development and persistent-volume deployments) and S3-compatible cloud object storage (for production deployments across providers such as AWS S3, Cloudflare R2, MinIO, Backblaze B2, and DigitalOcean Spaces).

---

## Storage Interface

All storage operations and shared types (`StorageObject`, `UploadOptions`, `StorageUploadInputObject`, `StorageUploadInput`, `StorageValidationResult`, and `StorageProvider`) are exposed via [src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts):

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
  key?: string;          // Specific object key to use (must stay within "uploads/" on LocalStorageProvider)
  folder?: string;       // Directory/prefix (default: "uploads"; LocalStorageProvider requires "uploads" or "uploads/*")
  metadata?: Record<string, string>; // Custom metadata
  contentType?: string;  // MIME type override
}

export interface StorageUploadInputObject {
  buffer: Buffer;        // Raw binary payload
  filename: string;      // Original or normalized filename
  mimeType: string;      // Declared MIME type
}

export type StorageUploadInput = File | StorageUploadInputObject;

export interface StorageValidationResult {
  valid: boolean;
  error?: string;
}

export interface StorageProvider {
  /** Upload file or buffer and receive full object metadata */
  upload(input: StorageUploadInput, options?: UploadOptions): Promise<StorageObject>;

  /** Delete an asset by key or public URL */
  delete(keyOrUrl: string): Promise<void>;

  /** Resolve public URL for a key or URL */
  getPublicUrl(keyOrUrl: string): string;

  /** Fetch object metadata if present */
  getMetadata(keyOrUrl: string): Promise<StorageObject | null>;

  /** Stream an uploaded object (or inspect metadata when headOnly is true) */
  openReadStream(
    keyOrUrl: string,
    options?: { headOnly?: boolean }
  ): Promise<LocalUploadStreamResult | null>;

  /** Validate provider configuration and health status */
  validateConfig(): Promise<StorageValidationResult>;
}
```

Both `LocalStorageProvider` and `S3StorageProvider` implement `openReadStream` returning `LocalUploadStreamResult` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) so authorized `/uploads/*` requests stream seamlessly through [src/app/api/uploads/[...path]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/uploads/%5B...path%5D/route.ts).

---

## Storage Adapters

### 1. Local Development & Persistent Volume Mode (`LocalStorageProvider`)
- Instantiated by `getStorageProvider` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) when S3 credentials are not defined in environment variables.
- **Strict `public/uploads` Containment**: Confines every `upload`, `delete`, `getMetadata`, and `openReadStream` method ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) to `public/uploads/` via `resolveContainedWritePath` and `resolveContainedExistingPath` ([src/utils/pathContainment.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/pathContainment.ts)). Both helpers enforce lexical `path.relative` bounds, canonical `fs.promises.realpath` checks across target and ancestor directories (accepting an optional pre-resolved `canonicalRoot` in `resolveContainedExistingPath` to avoid redundant root `realpath` syscalls during batch reads), null-byte and backslash rejection, and symbolic link rejection (`fs.lstat`). Passing a `key` or `folder` outside `public/uploads` (for example `{ folder: 'photos' }` or `{ key: 'images/logo.png' }`) throws `PathContainmentError` ([src/utils/pathContainment.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/pathContainment.ts)).
- **Extension-Based Local Metadata**: `LocalStorageProvider.getMetadata` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) resolves MIME types from file extensions via `getLocalUploadMimeType` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)), mapping `.png`, `.jpg`, `.jpeg`, `.webp`, and `.ico` to their image MIME types and returning `application/octet-stream` for any other extension (such as `.svg` or `.bin`). Custom `metadata` key-value pairs and `etag` values are not persisted on disk by `LocalStorageProvider`.
- Serves files dynamically at `/uploads/*` in Next.js standalone/server mode via `next.config.ts` server `rewrites()` to `GET` and `HEAD` in [src/app/api/uploads/[...path]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/uploads/%5B...path%5D/route.ts), which verifies path containment (`resolveContainedExistingPath`), rejects symlinks, enforces session and moderation checks (allowing unauthenticated reads only for `AppConfig.ogImageUrl` and `AppConfig.faviconUrl`), and attaches `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` for fallback `application/octet-stream` payloads (continuing to serve existing `.ico` files with `image/x-icon` under `sandbox`), `Vary: Cookie`, and `Cache-Control: private, no-cache` (`Cache-Control: private, no-store` for `PENDING` admin previews).

> ⚠️ **WARNING: Ephemeral Container Local Storage Hazard**
>
> Files uploaded when using `LocalStorageProvider` are saved directly to `public/uploads/` inside the local application container filesystem. Inside containerized environments (such as Docker or Kubernetes), this writable layer is **ephemeral** unless backed by a persistent volume. If an unmounted container is restarted, updated, or recreated, all files stored in `public/uploads/` will be **permanently lost**.
>
> **Production Requirement:** When S3 object storage credentials are not configured in production environments, deployers **must** mount a persistent volume at `/app/public/uploads` (such as the default `uploads_data:/app/public/uploads` named volume in `docker-compose.yml`, `-v /var/lib/wedding/uploads:/app/public/uploads`, or a Render Persistent Disk) to ensure asset durability.

### 2. S3-Compatible Production (`S3StorageProvider`)
- Used when all required S3 credentials are configured in environment variables via `getStorageProvider` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)).
- Built using AWS SDK v3 (`@aws-sdk/client-s3`); vendor SDK usage is strictly isolated inside adapter boundaries.
- **Path-Style Endpoints, `/uploads/*` Routing, Extension-Derived MIME Types, & Legacy URL Fallback**: When `S3_ENDPOINT` is set, `S3StorageProvider` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) automatically enables `forcePathStyle: true` on `S3Client`. Uploaded S3 keys normalize under `uploads/*` and `getPublicUrl` returns root-relative `/uploads/*` paths so reads pass through the session, moderation, and `default-src 'none'; sandbox` header gates in [src/app/api/uploads/[...path]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/uploads/%5B...path%5D/route.ts) via `S3StorageProvider.openReadStream` (both `S3StorageProvider.getMetadata` and `S3StorageProvider.openReadStream` derive `mimeType` strictly from `getLocalUploadMimeType` rather than untrusted S3 `ContentType` object metadata). For legacy external URL key extraction (`extractKey`), `S3StorageProvider` retains `S3_PUBLIC_URL` or falls back to `` `${endpoint}/${bucket}` `` (`` `${S3_ENDPOINT}/${S3_BUCKET}` ``) when `S3_ENDPOINT` is present, or `` `https://${bucket}.s3.${region}.amazonaws.com` `` otherwise.
- **Cloudflare R2 Endpoint & Public URL Validation**: Cloudflare R2 configurations setting `S3_REGION=auto` must also define `S3_ENDPOINT` (e.g., `` `https://{account_id}.r2.cloudflarestorage.com` ``). Because private R2 S3 API endpoints (`*.r2.cloudflarestorage.com`) require SigV4 authentication and are **not** publicly readable by browsers, both `src/env.ts` and `S3StorageProvider` reject `*.r2.cloudflarestorage.com` endpoints unless `S3_PUBLIC_URL` is configured (pointing to an R2 Custom Domain or public `https://pub-<id>.r2.dev` bucket URL).
- Supports any S3-compatible object storage vendor, including:
  - **AWS S3**: Default endpoint format (`` `https://{bucket}.s3.{region}.amazonaws.com` ``)
  - **Cloudflare R2**: Configured via `S3_ENDPOINT` (e.g., `` `https://{account_id}.r2.cloudflarestorage.com` ``) **plus** `S3_PUBLIC_URL` for public browser asset delivery
  - **MinIO / Self-Hosted**: Configured via `S3_ENDPOINT` (with `forcePathStyle: true`) and optional `S3_PUBLIC_URL`
  - **Backblaze B2**: Configured via `S3_ENDPOINT` and optional `S3_PUBLIC_URL`

---

## Environment Configuration

| Variable | Required for S3 | Description |
| :--- | :--- | :--- |
| `S3_BUCKET` | Yes | Target storage bucket name |
| `S3_REGION` | Yes | Storage region (e.g. `us-east-1` or `auto` for Cloudflare R2) |
| `S3_ACCESS_KEY_ID` | Yes | Storage access key ID |
| `S3_SECRET_ACCESS_KEY` | Yes | Storage secret access key |
| `S3_ENDPOINT` | Optional | Custom S3 API endpoint URL for non-AWS providers (enables `forcePathStyle: true`) |
| `S3_PUBLIC_URL` | Required for R2 public assets; Optional otherwise | Public CDN, R2 Custom Domain, or `r2.dev` URL prefix overriding the `` `${S3_ENDPOINT}/${S3_BUCKET}` `` fallback |

### Validation Behavior
- If **no** S3 variables are set, `getStorageProvider` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) automatically defaults to `LocalStorageProvider`.
- If **all** four core S3 variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are set, the system instantiates `S3StorageProvider`.
- If **partial/inconsistent** S3 variables are provided (e.g., `S3_BUCKET` is set without `S3_SECRET_ACCESS_KEY`), or if Cloudflare R2 is configured with `S3_REGION=auto` without `S3_ENDPOINT` or with a private `*.r2.cloudflarestorage.com` endpoint without `S3_PUBLIC_URL`, `getStorageProvider` throws a descriptive validation error.
- **Scope of `validateConfig()`**: `LocalStorageProvider.validateConfig` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) verifies filesystem write readiness by running `fs.mkdir(public/uploads, { recursive: true })`. By contrast, `S3StorageProvider.validateConfig` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) checks that the four `process.env` credential strings are non-empty and that Cloudflare R2 `S3_ENDPOINT` / `S3_PUBLIC_URL` invariants hold; it does **not** issue live network calls to S3 or verify that `S3_PUBLIC_URL` is publicly reachable over HTTP.

---

## Security Policies & Security Controls

### 1. File Type, Batch Count, and Size Validation

The application defines distinct file size, batch, and format validation rules for administrative asset uploads versus guest photo submissions:

#### Administrative Upload Constraints
- **Maximum File Size**: 5 MB (`MAX_UPLOAD_SIZE = 5 * 1024 * 1024`), exported as `MAX_UPLOAD_SIZE` in [src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts) and enforced by `AdminUploadSchema` in [src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts).
- **Allowed MIME Types**: JPEG (`image/jpeg`), PNG (`image/png`), ICO (`image/x-icon`, `image/vnd.microsoft.icon`).
- **Allowed Extensions**: `.jpg`, `.jpeg`, `.png`, `.ico`.
- **Extension & MIME Consistency**: Uploaded file extensions must match declared MIME types (`MIME_TO_EXTENSIONS`).

#### Guest Photo Upload Constraints
- **Maximum File Size**: 10 MB per file (`MAX_GUEST_PHOTO_SIZE = 10 * 1024 * 1024`), exported as `MAX_GUEST_PHOTO_SIZE` in [src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts) and enforced per file by `SingleGuestPhotoSchema` in [src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts).
- **Batch Upload Cap**: Maximum **10 photos per upload request** (`files: z.array(SingleGuestPhotoSchema).min(1).max(10)`), with optional `uploaderName` (`<= 100` chars) and `caption` (`<= 500` chars) validated in `GuestPhotoUploadSchema` ([src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts)).
- **Allowed MIME Types**: JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`), and HEIC/HEIF (`image/heic`, `image/heif`, `image/heic-sequence`, `image/heif-sequence`, or empty/`application/octet-stream` when paired with `.heic`/`.heif`).
- **Allowed Extensions**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif` (excluding `.ico`).

### 2. Asset & Path URL Guards

Persisted configuration, media, and local path URLs are validated by the URL guard primitives in [src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts) (re-exported via [src/utils/validation.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validation.ts)):
- **`decodeUrlPathSafely`** ([src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts)): Strips query/fragment suffixes and iteratively percent-decodes paths up to 3 rounds (including per-segment fallback decoding), returning `null` on null bytes (`\0` / `%00`), backslashes (`\` / `%5c`), or `>3x` multi-encoding.
- **`isSafeLocalPathUrl`** ([src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts)): Rejects parent traversal (`..`), protocol-relative or empty double slashes (`//`), backslashes, and null bytes across both raw and `decodeUrlPathSafely`-decoded forms.
- **`isSafeConfigAssetUrl`** ([src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts)): Guards `AppConfig` branding, Open Graph, and favicon fields; permits `''`, valid `http(s)://` URLs, or root-relative local paths (`requireLeadingSlash: true`).
- **`isSafeMediaOrPhotoUrl`** ([src/utils/validationPrimitives.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/validationPrimitives.ts)): Guards `Media` and `Photo` `ContentNode` URLs; permits `''`, valid `http(s)://` URLs, base64 `data:image/*` URIs, or safe local paths (`requireLeadingSlash: false`) while blocking dangerous schemes (`javascript:`, `vbscript:`, `file:`, etc.).

### 3. Image Sanitization & Processing Pipeline

All uploaded image files undergo server-side sanitization prior to persistence via `sanitizeImage` in [src/utils/imageProcessor.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessor.ts) and `processImageWorkerBuffer` in [src/utils/imageProcessorWorker.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessorWorker.ts):
- **Pre-Decode Byte & Dimension Guards**: Rejects inputs larger than `MAX_GUEST_PHOTO_SIZE` (`10 * 1024 * 1024`) prior to buffering/decoding, validates ISOBMFF `ispe` spatial extents via `parseHeicSpatialExtents` before lazy `heic-decode` WASM loading, and enforces `MAX_IMAGE_PIXELS` (`64000000` via Sharp `limitInputPixels`) and `MAX_IMAGE_DIMENSION` (`12000` max side).
- **EXIF Metadata Stripping**: Strips all embedded EXIF metadata, GPS geotags, camera model identifiers, and timestamps to protect guest and administrator privacy.
- **Auto-Rotation**: Automatically rotates images based on embedded EXIF orientation tags (`.rotate()`) prior to metadata stripping so photos render with correct orientation.
- **Format, HEIC, & `.ico` Transcoding (Fail-Closed)**: Sharp sanitization preserves JPEG, PNG, and WebP formats, transcodes HEIC/HEIF frames (lazily loaded `heic-decode` + Sharp) into sanitized `image/jpeg` files, parses `.ico` `ICONDIR` / `ICONDIRENTRY` headers (`parseIcoDirectoryEntries` in [src/utils/imageProcessorWorker.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessorWorker.ts)) to re-encode the largest frame to `image/png` (`.png` filename), and fails closed with `ApiError(400, ...)` in `sanitizeImage` ([src/utils/imageProcessor.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessor.ts)) whenever an unsupported or malformed format is encountered.

### 4. Worker Thread Offloading & Timeout Handling

To protect the main Node.js event loop from CPU-heavy image processing tasks, sanitization is offloaded to a bounded pool of warm background worker threads using `offloadSanitizeToWorker` in [src/utils/imageProcessor.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/imageProcessor.ts):
- **Worker Thread Execution**: Image buffer processing runs inside reusable Node.js worker threads (`new Worker(new URL('./imageProcessorWorker.ts', import.meta.url), { workerData: { isImageProcessorPoolWorker: true } })`, or `--experimental-strip-types` under `NODE_ENV === 'test'`) that `unref()` while idle, transfer `ArrayBuffer` payloads once ready, and never fall back to the main thread.
- **Default 10-Second Worker Timeout**: A strict 10-second timeout (`timeoutMs = 10000`) is enforced per sanitization job.
- **Timeout & Error Behavior**: If worker execution exceeds 10 seconds, emits an error, or exits unexpectedly, the failure is logged with `logger.error`, any stalled or crashed worker is evicted and terminated (`worker.terminate()`), and an HTTP 400 error response is returned (`ApiError(400, 'Image sanitization failed. Worker thread timed out.')` on timeout or `ApiError(400, ...)` on error/exit).

### 5. Credential Safety
- Cloud credentials (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) are exclusively accessible on the server side (Node.js runtime).
- Credentials are **never** prefixed with `NEXT_PUBLIC_` and are never bundled into client browser code.

---

## Media Persistence, Moderation, Export & Header Lifecycles

### 1. Upload Persistence: Admin vs. Guest Routes
- **Stateless Admin Upload (`POST /api/admin/upload`)**: `POST` in [src/app/api/admin/upload/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/admin/upload/route.ts) sanitizes a single image, writes it to the default `uploads` prefix via `getStorageProvider().upload(sanitizedFile)`, and returns `{ url }` without inserting `Media` or `ContentNode` database rows (callers persist the returned URL on `AppConfig` or entity payloads).
- **Stateful Guest Photo Upload (`POST /api/guest/photos/upload`)**: `POST` in [src/app/api/guest/photos/upload/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/guest/photos/upload/route.ts) sanitizes batch images concurrently before writing each sanitized image under `{ folder: 'uploads/photos' }` and persisting **both** a `Media` row (`mediaRepository.createMedia`) and a `Photo` `ContentNode` (`contentRepository.createNode` with tags `['gallery', 'guest-upload']`, `status: 'PENDING'` and `isVisible: false` for moderation by default, or `status: 'APPROVED'` and `isVisible: true` when `AppConfig.autoApproveGuestPhotos` is enabled, alongside `data.mediaId`). Response items omit `url` while `status` is `PENDING` so unapproved storage paths are not exposed before couple moderation.

### 2. Moderation Rejection & Direct Media Deletion Cleanup
- **Full Cleanup on Moderation Rejection**: Calling `ContentService.moderatePhoto` ([src/features/content/service.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/content/service.ts)) with `'reject'` (`ContentService.moderatePhoto(nodeId, 'reject')`) deletes unreferenced linked `Media` database records and underlying storage objects via `mediaRepository.deleteMedia(data.mediaId)` (preserving entity-bound `Media` rows, skipping redundant `this.repo.deleteNode(nodeId, author)` calls when `deleteMedia` already removed the linked `Photo` node, and falling back to `getStorageProvider().delete(data.url)` only when no `Media` row was removed so storage deletion is never duplicated) and ensures the `Photo` `ContentNode` (`this.repo.deleteNode(nodeId, author)`) is removed.
- **Set-Based Batch Moderation & Bounded Post-Commit Cleanup**: Calling `ContentService.moderatePhotosBatch` ([src/features/content/service.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/content/service.ts)) delegates batch approvals to `ContentRepository.approvePhotosBatch` and batch rejections to `ContentRepository.rejectPhotosBatch` ([src/features/content/repository.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/content/repository.ts)), executing a single interactive database transaction per batch with `MediaRepository.deleteMediaBatch` and unlinking deduplicated managed storage assets **after** transaction commit via `unlinkManagedStorageUrls` ([src/features/media/repository.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/media/repository.ts), capped at 8 concurrent workers).
- **Post-Commit Storage Cleanup on `DELETE /api/media/[id]`**: Calling `DELETE /api/media/[id]` ([src/app/api/media/[id]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/media/%5Bid%5D/route.ts)) invokes `MediaRepository.deleteMedia` ([src/features/media/repository.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/media/repository.ts)) via `mediaRepository.deleteMedia(id)`, which removes linked `Photo` `ContentNode` rows and the `Media` row inside a database transaction (preserving audit snapshots) and then calls `getStorageProvider().delete(deletedMedia.url)` **after** the transaction commits, preventing orphaned local or S3 blobs.

### 3. Streaming Bulk ZIP Export (`GET` & `POST /api/media/export`)
- `GET` and `POST` in [src/app/api/media/export/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/media/export/route.ts) stream sanitized `.zip` archives (defaulting to `Content-Disposition: attachment; filename="wedding-photos.zip"`) through `archiver` coupled to a pull-driven Web `ReadableStream` that pauses on consumer backpressure and aborts `archiver` plus pending `safeFetch` requests (`AbortSignal`) if the download stream is cancelled.
- **Zero-Recompression (`STORE`) Image Entries & Native Downloads**: Compressed image formats (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`, `.heic`, `.heif`) are written with `store: true` (ZIP method `0` / `STORE`), while non-image and diagnostic `.txt` notices fall back to `zlib` level `5` deflate. Supports lightweight `preflight` readiness checks (`GET` query or JSON/form `POST`) and `Origin`/`Sec-Fetch-Site`-validated `application/x-www-form-urlencoded` `POST` submissions so admin UIs trigger native `<a download>` or hidden `<form method="POST">` downloads without buffering `Response.blob()` in browser RAM.
- Processes export items in batches of **8** (`CONCURRENCY_LIMIT = 8`) and awaits batch drain before fetching the next batch: decodes `data:` URIs in memory, downloads remote `http(s)://` URLs via SSRF-guarded `safeFetch`, and resolves local paths inside `public/` via `resolveContainedExistingPath` (reusing a single canonical `public/` `realpath` and passing `fs.Stats` into `archive.file`). Missing local files, failed upstream fetches, or `PathContainmentError` violations emit per-item `missing_<filename>.txt` or `error_<filename>.txt` diagnostic entries rather than aborting the stream.

### 4. Local Image Header Parsing for Open Graph Metadata
- `getLocalImageDimensions` in [src/utils/image-metadata.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/image-metadata.ts) resolves root-relative local asset URLs under `public/` via `resolveContainedExistingPath` (`requireLeadingSlash: true`) and performs surgical byte-offset reads (`fs.promises.open`) on **PNG** (`IHDR` 24-byte header), **JPEG** (`SOF` marker scan), and **SVG** (`width`/`height` or `viewBox` within the first 4096 bytes) without loading full image buffers into memory.
- Invoked by `generateMetadata` at [src/app/metadata.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/metadata.ts) to populate Open Graph image dimensions; remote `http(s)://` URLs and unsupported local extensions (such as `.webp` or `.ico`) return `null` and fall back to `1200x630`.

---

## Business Logic Decoupling

Application components and API endpoints access storage solely through `getStorageProvider` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)):

```typescript
import { getStorageProvider } from '@/utils/storage';

const storage = getStorageProvider();
const object = await storage.upload(file, { folder: 'uploads/photos' });
```

**Portable Folder Prefix Contract:** Both `S3StorageProvider.upload` and `LocalStorageProvider.upload` ([src/utils/storage.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/utils/storage.ts)) normalize uploaded keys under `uploads/` (`LocalStorageProvider.upload` enforces strict filesystem containment under `public/uploads` and throws `PathContainmentError` for any `folder` or `key` outside `uploads`). Feature and route code should always omit `options.folder` (defaulting to `'uploads'`) or pass `'uploads/<subpath>'` so switching between `LocalStorageProvider`, AWS S3, Cloudflare R2, or MinIO requires zero code changes.
