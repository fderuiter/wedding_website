import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

interface WorkerSuccessResult {
  success: true;
  buffer: Uint8Array;
}

interface WorkerErrorResult {
  success: false;
  error: string;
}

export type WorkerResult = WorkerSuccessResult | WorkerErrorResult;

/**
 * Sanitizes an image buffer in a worker thread by auto-rotating based on EXIF
 * orientation tag and stripping all EXIF metadata.
 */
export async function processImageWorkerBuffer(inputBuffer: Uint8Array | ArrayBuffer | Buffer): Promise<Uint8Array> {
  const buffer = Buffer.from(inputBuffer as ArrayBuffer);
  const sanitizedBuffer = await sharp(buffer)
    .rotate()
    .toBuffer();
  return new Uint8Array(sanitizedBuffer);
}

// When executed inside a Node.js worker thread
if (parentPort && workerData) {
  (async () => {
    try {
      const sanitized = await processImageWorkerBuffer(workerData.buffer);
      parentPort?.postMessage({ success: true, buffer: sanitized } as WorkerSuccessResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ success: false, error: errorMessage } as WorkerErrorResult);
    }
  })();
}
