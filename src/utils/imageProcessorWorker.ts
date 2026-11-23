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
  maxBytes?: number;
}

export interface HeicSpatialExtent {
  width: number;
  height: number;
}

// Matches MAX_GUEST_PHOTO_SIZE (10 MB) in src/utils/validationPrimitives.ts without relative TS imports
// so Node.js --experimental-strip-types can execute this module directly in Jest worker threads.
export const MAX_WORKER_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 64000000;
export const MAX_IMAGE_DIMENSION = 12000;

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

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) >>> 0) +
    ((bytes[offset + 2] << 8) >>> 0) +
    (bytes[offset + 3] >>> 0)
  );
}

function readRawFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function readAsciiFourCC(bytes: Uint8Array, offset: number): string {
  return readRawFourCC(bytes, offset)
    .replace(/\0/g, ' ')
    .trim();
}

function assertWithinImageDimensionLimits(width: number, height: number, label = 'Image'): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      `${label} dimensions (${width}x${height}) exceed maximum allowed limits (${MAX_IMAGE_DIMENSION}px max side, ${MAX_IMAGE_PIXELS} pixels)`
    );
  }
}

function collectIsobmffIspeExtents(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  extents: HeicSpatialExtent[]
): void {
  if (depth > 6) {
    return;
  }

  let pos = start;
  while (pos + 8 <= end) {
    const rawSize = readUint32BE(bytes, pos);
    const boxType = readRawFourCC(bytes, pos + 4);
    let headerLen = 8;
    let boxSize = rawSize;

    if (rawSize === 1) {
      if (pos + 16 > end) {
        throw new Error('Malformed ISOBMFF extended box header');
      }
      const hi = readUint32BE(bytes, pos + 8);
      const lo = readUint32BE(bytes, pos + 12);
      if (hi > 0x1fffff) {
        throw new Error('ISOBMFF box size exceeds safe integer bounds');
      }
      boxSize = hi * 0x100000000 + lo;
      headerLen = 16;
    } else if (rawSize === 0) {
      boxSize = end - pos;
    }

    if (boxSize < headerLen || pos + boxSize > end) {
      throw new Error(`Malformed ISOBMFF box bounds for "${boxType}"`);
    }

    const payloadStart = pos + headerLen;
    const boxEnd = pos + boxSize;

    if (boxType === 'meta') {
      if (payloadStart + 8 <= boxEnd && readRawFourCC(bytes, payloadStart + 4) === 'hdlr') {
        collectIsobmffIspeExtents(bytes, payloadStart, boxEnd, depth + 1, extents);
      } else if (payloadStart + 4 <= boxEnd) {
        collectIsobmffIspeExtents(bytes, payloadStart + 4, boxEnd, depth + 1, extents);
      } else {
        throw new Error('Malformed ISOBMFF meta box');
      }
    } else if (boxType === 'iprp' || boxType === 'ipco' || boxType === 'moov') {
      collectIsobmffIspeExtents(bytes, payloadStart, boxEnd, depth + 1, extents);
    } else if (boxType === 'ispe') {
      if (boxEnd - payloadStart < 12) {
        throw new Error('Malformed HEIC spatial extents (ispe) box');
      }
      const version = bytes[payloadStart];
      if (version !== 0) {
        throw new Error(`Unsupported HEIC spatial extents (ispe) version: ${version}`);
      }
      const width = readUint32BE(bytes, payloadStart + 4);
      const height = readUint32BE(bytes, payloadStart + 8);
      extents.push({ width, height });
    }

    pos = boxEnd;
  }
}

/**
 * Parses ISOBMFF ImageSpatialExtentsProperty (`ispe`) boxes inside HEIC/HEIF containers.
 */
export function parseHeicSpatialExtents(
  input: Uint8Array | ArrayBuffer | Buffer
): HeicSpatialExtent[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const extents: HeicSpatialExtent[] = [];
  collectIsobmffIspeExtents(bytes, 0, bytes.byteLength, 0, extents);
  return extents;
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

  const rawBoxSize = readUint32BE(bytes, 0);
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
  const maxBytes = options?.maxBytes ?? MAX_WORKER_INPUT_BYTES;
  if (inputBuffer.byteLength > maxBytes) {
    throw new Error(
      `Image buffer size (${inputBuffer.byteLength} bytes) exceeds maximum allowed limit (${maxBytes} bytes)`
    );
  }

  const buffer = Buffer.isBuffer(inputBuffer)
    ? inputBuffer
    : Buffer.from(inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer));

  const heicDetected = isHeicBuffer(buffer);
  if (options?.expectHeic && !heicDetected) {
    throw new Error('Invalid HEIC/HEIF file header');
  }

  if (heicDetected) {
    const uint8View = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const spatialExtents = parseHeicSpatialExtents(uint8View);
    if (spatialExtents.length === 0) {
      throw new Error('Missing HEIC spatial extents (ispe) metadata');
    }
    for (const extent of spatialExtents) {
      assertWithinImageDimensionLimits(extent.width, extent.height, 'HEIC image');
    }

    const decoded = await decodeHeic({ buffer: uint8View });
    if (
      !decoded ||
      !decoded.width ||
      !decoded.height ||
      !decoded.data
    ) {
      throw new Error('Failed to decode primary HEIC frame');
    }

    assertWithinImageDimensionLimits(decoded.width, decoded.height, 'Decoded HEIC image');
    if (decoded.data.byteLength < decoded.width * decoded.height * 4) {
      throw new Error('Failed to decode primary HEIC frame');
    }

    const rawRgba = Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength
    );
    const jpegBuffer = await sharp(rawRgba, {
      limitInputPixels: MAX_IMAGE_PIXELS,
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

  const metadata = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  assertWithinImageDimensionLimits(metadata.width ?? 0, metadata.height ?? 0, 'Raster image');

  const sanitizedBuffer = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
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
        maxBytes: typeof workerData.maxBytes === 'number' ? workerData.maxBytes : undefined,
      });
      parentPort?.postMessage({ success: true, buffer: sanitized } as WorkerSuccessResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ success: false, error: errorMessage } as WorkerErrorResult);
    }
  })();
}
