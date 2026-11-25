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
  expectIco?: boolean;
  maxBytes?: number;
}

export type WorkerResult = WorkerSuccessResult | WorkerErrorResult;

export interface ProcessImageWorkerOptions {
  expectHeic?: boolean;
  expectIco?: boolean;
  maxBytes?: number;
}

export interface HeicSpatialExtent {
  width: number;
  height: number;
}

export interface IcoDirectoryEntry {
  index: number;
  width: number;
  height: number;
  bitCount: number;
  bytesInRes: number;
  imageOffset: number;
  isPngFrame: boolean;
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

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const MAX_ICO_DIRECTORY_ENTRIES = 256;

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] >>> 0) +
    ((bytes[offset + 1] << 8) >>> 0) +
    ((bytes[offset + 2] << 16) >>> 0) +
    ((bytes[offset + 3] << 24) >>> 0)
  );
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function hasPngSignature(bytes: Uint8Array, offset: number, length: number): boolean {
  if (length < PNG_MAGIC_BYTES.length) {
    return false;
  }
  for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
    if (bytes[offset + i] !== PNG_MAGIC_BYTES[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether an input buffer starts with a structurally valid ICO ICONDIR header
 * and in-bounds directory table.
 */
export function isIcoBuffer(input: Uint8Array | ArrayBuffer | Buffer): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 22) {
    return false;
  }
  const reserved = readUint16LE(bytes, 0);
  const type = readUint16LE(bytes, 2);
  const count = readUint16LE(bytes, 4);
  if (reserved !== 0 || type !== 1 || count < 1 || count > MAX_ICO_DIRECTORY_ENTRIES) {
    return false;
  }
  const directoryEnd = 6 + count * 16;
  if (directoryEnd > bytes.byteLength) {
    return false;
  }
  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    if (bytes[entryOffset + 3] !== 0) {
      return false;
    }
    const bytesInRes = readUint32LE(bytes, entryOffset + 8);
    const imageOffset = readUint32LE(bytes, entryOffset + 12);
    if (
      bytesInRes < 8 ||
      imageOffset < directoryEnd ||
      imageOffset + bytesInRes > bytes.byteLength
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Parses and validates all ICONDIRENTRY records inside an ICO container, resolving
 * effective frame dimensions from embedded PNG IHDR or DIB BITMAPINFOHEADER headers.
 */
export function parseIcoDirectoryEntries(
  input: Uint8Array | ArrayBuffer | Buffer
): IcoDirectoryEntry[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 22) {
    throw new Error('Invalid ICO file header');
  }
  const reserved = readUint16LE(bytes, 0);
  const type = readUint16LE(bytes, 2);
  const count = readUint16LE(bytes, 4);
  if (reserved !== 0 || type !== 1 || count < 1 || count > MAX_ICO_DIRECTORY_ENTRIES) {
    throw new Error('Invalid ICO file header');
  }

  const directoryEnd = 6 + count * 16;
  if (directoryEnd > bytes.byteLength) {
    throw new Error('Truncated ICO directory table');
  }

  const entries: IcoDirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    const rawWidth = bytes[entryOffset];
    const rawHeight = bytes[entryOffset + 1];
    const entryReserved = bytes[entryOffset + 3];
    if (entryReserved !== 0) {
      throw new Error('Malformed ICO directory entry reserved byte');
    }

    const dirWidth = rawWidth === 0 ? 256 : rawWidth;
    const dirHeight = rawHeight === 0 ? 256 : rawHeight;
    const bitCount = readUint16LE(bytes, entryOffset + 6);
    const bytesInRes = readUint32LE(bytes, entryOffset + 8);
    const imageOffset = readUint32LE(bytes, entryOffset + 12);

    if (
      bytesInRes < 8 ||
      imageOffset < directoryEnd ||
      imageOffset + bytesInRes > bytes.byteLength
    ) {
      throw new Error('Out-of-bounds ICO frame payload');
    }

    assertWithinImageDimensionLimits(dirWidth, dirHeight, 'ICO directory entry');

    const isPngFrame = hasPngSignature(bytes, imageOffset, bytesInRes);
    let effectiveWidth = dirWidth;
    let effectiveHeight = dirHeight;
    let effectiveBitCount = bitCount;

    if (isPngFrame) {
      if (bytesInRes < 24 || readRawFourCC(bytes, imageOffset + 12) !== 'IHDR') {
        throw new Error('Malformed embedded PNG header in ICO frame');
      }
      effectiveWidth = readUint32BE(bytes, imageOffset + 16);
      effectiveHeight = readUint32BE(bytes, imageOffset + 20);
      assertWithinImageDimensionLimits(effectiveWidth, effectiveHeight, 'ICO PNG frame');
    } else {
      if (bytesInRes < 40) {
        throw new Error('Truncated ICO DIB frame header');
      }
      const dibHeaderSize = readUint32LE(bytes, imageOffset);
      if (dibHeaderSize < 40 || dibHeaderSize > bytesInRes) {
        throw new Error('Malformed ICO DIB header size');
      }
      const dibWidth = readInt32LE(bytes, imageOffset + 4);
      const dibCombinedHeight = readInt32LE(bytes, imageOffset + 8);
      const dibBpp = readUint16LE(bytes, imageOffset + 14);
      const dibHeight = Math.floor(Math.abs(dibCombinedHeight) / 2);
      assertWithinImageDimensionLimits(dibWidth, dibHeight, 'ICO DIB frame');
      effectiveWidth = dibWidth;
      effectiveHeight = dibHeight;
      if (dibBpp > 0) {
        effectiveBitCount = dibBpp;
      }
    }

    entries.push({
      index: i,
      width: effectiveWidth,
      height: effectiveHeight,
      bitCount: effectiveBitCount,
      bytesInRes,
      imageOffset,
      isPngFrame,
    });
  }

  return entries;
}

function selectLargestIcoEntry(entries: IcoDirectoryEntry[]): IcoDirectoryEntry {
  let best = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const candidate = entries[i];
    const bestArea = best.width * best.height;
    const candidateArea = candidate.width * candidate.height;
    if (
      candidateArea > bestArea ||
      (candidateArea === bestArea && candidate.bitCount > best.bitCount) ||
      (candidateArea === bestArea &&
        candidate.bitCount === best.bitCount &&
        candidate.bytesInRes > best.bytesInRes)
    ) {
      best = candidate;
    }
  }
  return best;
}

function decodeIcoDibFrameToRgba(frame: Uint8Array): {
  rgba: Buffer;
  width: number;
  height: number;
} {
  if (frame.byteLength < 40) {
    throw new Error('Truncated ICO DIB frame');
  }
  const headerSize = readUint32LE(frame, 0);
  if (headerSize < 40 || headerSize > frame.byteLength) {
    throw new Error('Invalid ICO DIB header size');
  }
  const width = readInt32LE(frame, 4);
  const combinedHeight = readInt32LE(frame, 8);
  const planes = readUint16LE(frame, 12);
  const bpp = readUint16LE(frame, 14);
  const compression = readUint32LE(frame, 16);
  const clrUsed = readUint32LE(frame, 32);

  if (planes !== 0 && planes !== 1) {
    throw new Error(`Unsupported ICO DIB color planes: ${planes}`);
  }
  if (compression !== 0) {
    throw new Error(`Unsupported ICO DIB compression mode: ${compression}`);
  }
  if (bpp !== 1 && bpp !== 4 && bpp !== 8 && bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported ICO DIB bit depth: ${bpp}`);
  }

  const height = Math.floor(Math.abs(combinedHeight) / 2);
  assertWithinImageDimensionLimits(width, height, 'ICO DIB frame');
  const topDown = combinedHeight < 0;

  let paletteEntries = 0;
  if (bpp <= 8) {
    const maxPalette = 1 << bpp;
    paletteEntries = clrUsed > 0 ? clrUsed : maxPalette;
    if (paletteEntries < 1 || paletteEntries > maxPalette) {
      throw new Error('Malformed ICO DIB palette count');
    }
  }

  const paletteBytes = paletteEntries * 4;
  const xorOffset = headerSize + paletteBytes;
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4;
  const xorByteLength = xorStride * height;
  if (xorOffset + xorByteLength > frame.byteLength) {
    throw new Error('Truncated ICO DIB pixel data');
  }

  const andOffset = xorOffset + xorByteLength;
  const andStride = Math.floor((width + 31) / 32) * 4;
  const hasAndMask = andOffset + andStride * height <= frame.byteLength;

  let hasExplicitAlpha = false;
  if (bpp === 32) {
    for (let row = 0; row < height && !hasExplicitAlpha; row++) {
      const rowBase = xorOffset + row * xorStride;
      for (let x = 0; x < width; x++) {
        if (frame[rowBase + x * 4 + 3] !== 0) {
          hasExplicitAlpha = true;
          break;
        }
      }
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const xorRowBase = xorOffset + srcRow * xorStride;
    const andRowBase = andOffset + srcRow * andStride;

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      const isMaskedOut =
        hasAndMask &&
        ((frame[andRowBase + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;

      if (bpp === 32) {
        const px = xorRowBase + x * 4;
        rgba[dstIdx] = frame[px + 2];
        rgba[dstIdx + 1] = frame[px + 1];
        rgba[dstIdx + 2] = frame[px];
        rgba[dstIdx + 3] = hasExplicitAlpha ? frame[px + 3] : (isMaskedOut ? 0 : 255);
      } else if (bpp === 24) {
        const px = xorRowBase + x * 3;
        rgba[dstIdx] = frame[px + 2];
        rgba[dstIdx + 1] = frame[px + 1];
        rgba[dstIdx + 2] = frame[px];
        rgba[dstIdx + 3] = isMaskedOut ? 0 : 255;
      } else {
        let paletteIdx = 0;
        if (bpp === 8) {
          paletteIdx = frame[xorRowBase + x];
        } else if (bpp === 4) {
          const byteVal = frame[xorRowBase + (x >> 1)];
          paletteIdx = (x & 1) === 0 ? (byteVal >> 4) & 0x0f : byteVal & 0x0f;
        } else {
          const byteVal = frame[xorRowBase + (x >> 3)];
          paletteIdx = (byteVal >> (7 - (x & 7))) & 1;
        }
        if (paletteIdx >= paletteEntries) {
          throw new Error('Out-of-range ICO DIB palette index');
        }
        const palBase = headerSize + paletteIdx * 4;
        rgba[dstIdx] = frame[palBase + 2];
        rgba[dstIdx + 1] = frame[palBase + 1];
        rgba[dstIdx + 2] = frame[palBase];
        rgba[dstIdx + 3] = isMaskedOut ? 0 : 255;
      }
    }
  }

  return { rgba, width, height };
}

/**
 * Sanitizes an image buffer in a worker thread by auto-rotating based on EXIF
 * orientation tag, stripping all EXIF metadata, transcoding HEIC/HEIF primary
 * frames to sanitized JPEG images, and transcoding the largest ICO frame to PNG.
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

  const uint8View = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const icoDetected = isIcoBuffer(uint8View);
  if (options?.expectIco && !icoDetected) {
    throw new Error('Invalid ICO file header');
  }

  if (icoDetected) {
    const entries = parseIcoDirectoryEntries(uint8View);
    const largestEntry = selectLargestIcoEntry(entries);
    const frameSlice = buffer.subarray(
      largestEntry.imageOffset,
      largestEntry.imageOffset + largestEntry.bytesInRes
    );

    if (largestEntry.isPngFrame) {
      const frameMeta = await sharp(frameSlice, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
      if (frameMeta.format !== 'png') {
        throw new Error('Invalid embedded PNG frame in ICO container');
      }
      assertWithinImageDimensionLimits(
        frameMeta.width ?? 0,
        frameMeta.height ?? 0,
        'ICO PNG frame'
      );
      const pngBuffer = await sharp(frameSlice, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .png()
        .toBuffer();
      return new Uint8Array(pngBuffer);
    }

    const decodedDib = decodeIcoDibFrameToRgba(
      new Uint8Array(frameSlice.buffer, frameSlice.byteOffset, frameSlice.byteLength)
    );
    const pngBuffer = await sharp(decodedDib.rgba, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      raw: {
        width: decodedDib.width,
        height: decodedDib.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
    return new Uint8Array(pngBuffer);
  }

  if (heicDetected) {
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
        expectIco: Boolean(task.expectIco),
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
        expectIco?: boolean;
        maxBytes?: number;
      };
      const sanitized = await processImageWorkerBuffer(legacyData.buffer, {
        expectHeic: Boolean(legacyData.expectHeic),
        expectIco: Boolean(legacyData.expectIco),
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
