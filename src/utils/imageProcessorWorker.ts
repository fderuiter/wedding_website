import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

interface HeicDecodedFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface HeicDecodableFrame {
  width: number;
  height: number;
  decode(): Promise<HeicDecodedFrame>;
}

interface HeicDecodableImages extends Array<HeicDecodableFrame> {
  dispose?: () => void;
}

interface HeicDecoder {
  all(_input: { buffer: Uint8Array }): Promise<HeicDecodableImages>;
}

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
  maxBytes?: number;
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
export const MAX_ISOBMFF_BOX_DEPTH = 6;

let cachedHeicDecoderPromise: Promise<HeicDecoder> | null = null;
let heicDecoderLoaded = false;

function getHeicDecoder(): Promise<HeicDecoder> {
  if (!cachedHeicDecoderPromise) {
    cachedHeicDecoderPromise = import('heic-decode')
      .then((heicDecodeModule) => {
        heicDecoderLoaded = true;
        const candidate = heicDecodeModule as unknown as {
          all?: HeicDecoder['all'];
          default?: { all?: HeicDecoder['all'] };
        };
        if (typeof candidate.all === 'function') {
          return { all: candidate.all.bind(candidate) };
        }
        if (candidate.default && typeof candidate.default.all === 'function') {
          return { all: candidate.default.all.bind(candidate.default) };
        }
        throw new Error('HEIC decoder is missing all() frame inspection support');
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
  if (depth > MAX_ISOBMFF_BOX_DEPTH) {
    throw new Error(
      `ISOBMFF box nesting depth (${depth}) exceeds maximum allowed limit (${MAX_ISOBMFF_BOX_DEPTH})`
    );
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

    const heicDecoder = await getHeicDecoder();
    const images = await heicDecoder.all({ buffer: uint8View });
    let decoded: HeicDecodedFrame;
    try {
      if (!Array.isArray(images) || images.length === 0) {
        throw new Error('Failed to decode primary HEIC frame');
      }
      for (const frame of images) {
        assertWithinImageDimensionLimits(frame?.width ?? 0, frame?.height ?? 0, 'HEIC frame');
      }
      const primaryFrame = images[0];
      if (!primaryFrame || typeof primaryFrame.decode !== 'function') {
        throw new Error('Failed to decode primary HEIC frame');
      }
      decoded = await primaryFrame.decode();
    } finally {
      if (typeof images?.dispose === 'function') {
        images.dispose();
      }
    }

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
        maxBytes: typeof task.maxBytes === 'number' ? task.maxBytes : undefined,
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
      const legacyData = workerData as {
        buffer: Uint8Array;
        expectHeic?: boolean;
        maxBytes?: number;
      };
      const sanitized = await processImageWorkerBuffer(legacyData.buffer, {
        expectHeic: Boolean(legacyData.expectHeic),
        maxBytes: typeof legacyData.maxBytes === 'number' ? legacyData.maxBytes : undefined,
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
