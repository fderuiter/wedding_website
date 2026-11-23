import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

type HeicDecodeFn = typeof import('heic-decode');

interface WorkerSuccessResult {
  id?: number;
  success: true;
  buffer: Uint8Array;
  heicDecoderLoaded?: boolean;
}

interface WorkerErrorResult {
  id?: number;
  success: false;
  error: string;
}

export interface WorkerReadyMessage {
  type: 'ready';
}

export interface WorkerTaskMessage {
  id: number;
  buffer: Uint8Array;
  expectHeic?: boolean;
}

export type WorkerResult = WorkerSuccessResult | WorkerErrorResult;

export interface ProcessImageWorkerOptions {
  expectHeic?: boolean;
}

let cachedHeicDecoderPromise: Promise<HeicDecodeFn> | null = null;
let heicDecoderLoaded = false;

function getHeicDecoder(): Promise<HeicDecodeFn> {
  if (!cachedHeicDecoderPromise) {
    cachedHeicDecoderPromise = import('heic-decode')
      .then((heicDecodeModule) => {
        heicDecoderLoaded = true;
        const candidate = heicDecodeModule as unknown as HeicDecodeFn | { default: HeicDecodeFn };
        return typeof candidate === 'function' ? candidate : candidate.default;
      })
      .catch((err) => {
        cachedHeicDecoderPromise = null;
        throw err;
      });
  }
  return cachedHeicDecoderPromise;
}

const EXPLICIT_HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
]);

const CONTAINER_HEIF_BRANDS = new Set(['mif1', 'msf1']);

function readAsciiFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  )
    .replace(/\0/g, ' ')
    .trim();
}

/**
 * Checks ISO Base Media File Format (`ftyp`) magic bytes for HEIC/HEIF payloads.
 */
export function isHeicBuffer(input: Uint8Array | ArrayBuffer | Buffer): boolean {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  if (bytes.length < 12) {
    return false;
  }

  // Bytes 4..7 must equal 'ftyp'
  if (
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return false;
  }

  const majorBrand = readAsciiFourCC(bytes, 8);
  if (EXPLICIT_HEIC_BRANDS.has(majorBrand)) {
    return true;
  }

  if (!CONTAINER_HEIF_BRANDS.has(majorBrand)) {
    return false;
  }

  const rawBoxSize =
    ((bytes[0] << 24) >>> 0) +
    ((bytes[1] << 16) >>> 0) +
    ((bytes[2] << 8) >>> 0) +
    (bytes[3] >>> 0);
  const boxEnd = Math.min(bytes.length, Math.max(rawBoxSize, 16), 128);

  let hasAvifCompat = false;
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    const compat = readAsciiFourCC(bytes, offset);
    if (EXPLICIT_HEIC_BRANDS.has(compat)) {
      return true;
    }
    if (compat === 'avif' || compat === 'avis') {
      hasAvifCompat = true;
    }
  }

  return !hasAvifCompat;
}

/**
 * Sanitizes an image buffer in a worker thread by auto-rotating based on EXIF
 * orientation tag, stripping all EXIF metadata, and transcoding HEIC/HEIF
 * primary frames to sanitized JPEG images.
 */
export async function processImageWorkerBuffer(
  inputBuffer: Uint8Array | ArrayBuffer | Buffer,
  options?: ProcessImageWorkerOptions
): Promise<Uint8Array> {
  const buffer = Buffer.isBuffer(inputBuffer)
    ? inputBuffer
    : Buffer.from(inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer));

  const heicDetected = isHeicBuffer(buffer);
  if (options?.expectHeic && !heicDetected) {
    throw new Error('Invalid HEIC/HEIF file header');
  }

  if (heicDetected) {
    const decodeHeic = await getHeicDecoder();
    const uint8View = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const decoded = await decodeHeic({ buffer: uint8View });
    if (
      !decoded ||
      !decoded.width ||
      !decoded.height ||
      !decoded.data ||
      decoded.data.byteLength < decoded.width * decoded.height * 4
    ) {
      throw new Error('Failed to decode primary HEIC frame');
    }

    const rawRgba = Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength
    );
    const jpegBuffer = await sharp(rawRgba, {
      raw: {
        width: decoded.width,
        height: decoded.height,
        channels: 4,
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    return new Uint8Array(jpegBuffer);
  }

  const sanitizedBuffer = await sharp(buffer)
    .rotate()
    .toBuffer();
  return new Uint8Array(sanitizedBuffer);
}

function getTransferList(buffer: Uint8Array): ArrayBuffer[] {
  if (
    !Buffer.isBuffer(buffer) &&
    buffer.buffer instanceof ArrayBuffer &&
    buffer.byteOffset === 0 &&
    buffer.byteLength === buffer.buffer.byteLength
  ) {
    return [buffer.buffer];
  }
  return [];
}

const isPoolWorker =
  Boolean(parentPort) &&
  typeof workerData === 'object' &&
  workerData !== null &&
  (workerData as { isImageProcessorPoolWorker?: boolean }).isImageProcessorPoolWorker === true;

// Persistent pooled worker loop with correlation IDs
if (parentPort && isPoolWorker) {
  const port = parentPort;

  port.on('message', async (task: WorkerTaskMessage) => {
    const taskId = task?.id;
    try {
      const sanitized = await processImageWorkerBuffer(task.buffer, {
        expectHeic: Boolean(task.expectHeic),
      });
      const response: WorkerSuccessResult = {
        id: taskId,
        success: true,
        buffer: sanitized,
        heicDecoderLoaded,
      };
      port.postMessage(response, getTransferList(sanitized));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const response: WorkerErrorResult = {
        id: taskId,
        success: false,
        error: errorMessage,
      };
      port.postMessage(response);
    }
  });

  const readyMessage: WorkerReadyMessage = { type: 'ready' };
  port.postMessage(readyMessage);
} else if (
  parentPort &&
  typeof workerData === 'object' &&
  workerData !== null &&
  'buffer' in workerData
) {
  // Legacy single-shot workerData fallback
  (async () => {
    try {
      const legacyData = workerData as { buffer: Uint8Array; expectHeic?: boolean };
      const sanitized = await processImageWorkerBuffer(legacyData.buffer, {
        expectHeic: Boolean(legacyData.expectHeic),
      });
      parentPort?.postMessage(
        { success: true, buffer: sanitized, heicDecoderLoaded } satisfies WorkerSuccessResult,
        getTransferList(sanitized)
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ success: false, error: errorMessage } satisfies WorkerErrorResult);
    }
  })();
}
