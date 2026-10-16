import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';
import type { WorkerResult } from './imageProcessorWorker';

function getWorkerPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const tsPath = path.join(currentDir, 'imageProcessorWorker.ts');
  const jsPath = path.join(currentDir, 'imageProcessorWorker.js');
  const mjsPath = path.join(currentDir, 'imageProcessorWorker.mjs');

  if (fs.existsSync(tsPath)) return tsPath;
  if (fs.existsSync(jsPath)) return jsPath;
  if (fs.existsSync(mjsPath)) return mjsPath;

  return tsPath;
}

function offloadSanitizeToWorker(buffer: Uint8Array, timeoutMs = 10000): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const workerPath = getWorkerPath();
      const execArgv = workerPath.endsWith('.ts') ? ['--experimental-strip-types'] : undefined;

      const worker = new Worker(workerPath, {
        workerData: { buffer },
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
        reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
      });

      worker.on('exit', (code) => {
        if (settled) return;
        cleanup();
        if (code !== 0) {
          reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
        }
      });
    } catch {
      reject(new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.'));
    }
  });
}

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * and preserving their original format (e.g. JPEG, PNG) and dimensions.
 * Offloads Sharp processing to a Node.js worker thread.
 * Skips sanitization for non-Sharp image formats (such as ICO).
 * Throws an error if sanitization fails for supported formats.
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;

  // Only process standard JPEG, PNG, and WebP files.
  // Skip unsupported formats like ICO.
  if (
    fileType !== 'image/jpeg' &&
    fileType !== 'image/jpg' &&
    fileType !== 'image/png' &&
    fileType !== 'image/webp'
  ) {
    logger.debug(`Skipping sanitization for non-supported format: ${fileType}`);
    return file;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const sanitizedBuffer = await offloadSanitizeToWorker(buffer);

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
