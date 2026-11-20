import { parentPort, workerData } from 'node:worker_threads';
import heicDecodeModule from 'heic-decode';
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

export interface ProcessImageWorkerOptions {
  expectHeic?: boolean;
}

const decodeHeic: typeof heicDecodeModule =
  typeof heicDecodeModule === 'function'
    ? heicDecodeModule
    : (heicDecodeModule as { default: typeof heicDecodeModule }).default;

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

// When executed inside a Node.js worker thread
if (parentPort && workerData) {
  (async () => {
    try {
      const sanitized = await processImageWorkerBuffer(workerData.buffer, {
        expectHeic: Boolean(workerData.expectHeic),
      });
      parentPort?.postMessage({ success: true, buffer: sanitized } as WorkerSuccessResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ success: false, error: errorMessage } as WorkerErrorResult);
    }
  })();
}
