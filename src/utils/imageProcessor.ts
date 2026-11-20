import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';
import { getFileExtension, isHeicExtension } from './validationPrimitives';
import {
  isHeicBuffer,
  processImageWorkerBuffer,
  type ProcessImageWorkerOptions,
  type WorkerResult,
} from './imageProcessorWorker';

function getWorkerPath(): string {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')) {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const tsPath = path.join(currentDir, 'imageProcessorWorker.ts');
      const jsPath = path.join(currentDir, 'imageProcessorWorker.js');
      const mjsPath = path.join(currentDir, 'imageProcessorWorker.mjs');

      if (fs.existsSync(tsPath)) return tsPath;
      if (fs.existsSync(jsPath)) return jsPath;
      if (fs.existsSync(mjsPath)) return mjsPath;
    }
  } catch {
    // Fall back to workspace path resolution below
  }

  return path.join(process.cwd(), 'src', 'utils', 'imageProcessorWorker.ts');
}

function offloadSanitizeToWorker(
  buffer: Uint8Array,
  timeoutMs = 10000,
  options?: ProcessImageWorkerOptions
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const workerPath = getWorkerPath();
      const execArgv = workerPath.endsWith('.ts') ? ['--experimental-strip-types'] : undefined;

      const worker = new Worker(workerPath, {
        workerData: { buffer, expectHeic: Boolean(options?.expectHeic) },
        execArgv,
      });

      let settled = false;

      let timer: NodeJS.Timeout | null = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        timer = null;
        worker.terminate();
        reject(new ApiError(400, 'Image sanitization failed. Worker thread timed out.'));
      }, timeoutMs);

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        settled = true;
        worker.terminate();
      };

      worker.on('message', (result: WorkerResult) => {
        if (settled) return;
        cleanup();
        if (result.success) {
          resolve(result.buffer);
        } else {
          reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
        }
      });

      worker.on('error', () => {
        if (settled) return;
        cleanup();
        processImageWorkerBuffer(buffer, options)
          .then(resolve)
          .catch(() => {
            reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
          });
      });

      worker.on('exit', (code) => {
        if (settled) return;
        cleanup();
        if (code !== 0) {
          processImageWorkerBuffer(buffer, options)
            .then(resolve)
            .catch(() => {
              reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
            });
        }
      });
    } catch {
      processImageWorkerBuffer(buffer, options)
        .then(resolve)
        .catch(() => {
          reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
        });
    }
  });
}

function isHeicMimeType(mime: string): boolean {
  return (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    mime === 'image/heic-sequence' ||
    mime === 'image/heif-sequence'
  );
}

function toNormalizedJpegFilename(filename: string): string {
  const trimmed = (filename || '').trim();
  if (!trimmed) {
    return 'guest-photo.jpg';
  }
  const replaced = trimmed.replace(/\.(heic|heif)$/i, '.jpg');
  if (replaced !== trimmed) {
    return replaced;
  }
  const lastDot = replaced.lastIndexOf('.');
  if (lastDot > 0) {
    return `${replaced.slice(0, lastDot)}.jpg`;
  }
  return `${replaced}.jpg`;
}

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * preserving JPEG/PNG/WebP formats, and transcoding HEIC/HEIF uploads into
 * browser-compatible JPEG files.
 * Offloads Sharp and HEIC decoding to a Node.js worker thread.
 * Skips sanitization for non-Sharp image formats (such as ICO).
 * Throws an error if sanitization fails for supported formats.
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;
  const normalizedMime = (fileType || '').toLowerCase();
  const ext = getFileExtension(file.name);
  const isHeicInput = isHeicMimeType(normalizedMime) || isHeicExtension(ext);
  const isStandardRaster =
    normalizedMime === 'image/jpeg' ||
    normalizedMime === 'image/jpg' ||
    normalizedMime === 'image/png' ||
    normalizedMime === 'image/webp';

  // Only process standard JPEG, PNG, WebP, and HEIC/HEIF files.
  // Skip unsupported formats like ICO.
  if (!isStandardRaster && !isHeicInput) {
    logger.debug(`Skipping sanitization for non-supported format: ${fileType}`);
    return file;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const transcodeToJpeg = isHeicInput || isHeicBuffer(buffer);

    const sanitizedBuffer = await offloadSanitizeToWorker(buffer, 10000, {
      expectHeic: isHeicInput,
    });

    if (transcodeToJpeg) {
      const normalizedFilename = toNormalizedJpegFilename(file.name);
      logger.info(`Successfully transcoded and sanitized HEIC/HEIF image to image/jpeg (${normalizedFilename})`);
      return new File([Buffer.from(sanitizedBuffer)], normalizedFilename, { type: 'image/jpeg' });
    }

    logger.info(`Successfully sanitized image of type ${fileType}`);
    return new File([Buffer.from(sanitizedBuffer)], file.name, { type: fileType });
  } catch (error) {
    logger.error('Failed to sanitize image:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.');
  }
}
