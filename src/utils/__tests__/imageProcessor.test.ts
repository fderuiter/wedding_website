import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';
import { MAX_GUEST_PHOTO_SIZE, MAX_UPLOAD_SIZE } from '../validationPrimitives';
import {
  getImageWorkerPoolStats,
  MAX_CONCURRENT_HEIC_WORKERS,
  offloadSanitizeToWorker,
  resetImageWorkerPool,
  sanitizeImage,
  WORKER_RESOURCE_LIMITS,
  type ImageWorkerPoolStats,
} from '../imageProcessor';
import {
  isHeicBuffer,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_ISOBMFF_BOX_DEPTH,
  MAX_WORKER_INPUT_BYTES,
  parseHeicSpatialExtents,
  processImageWorkerBuffer,
  type HeicSpatialExtent,
} from '../imageProcessorWorker';

// Real 16x16 HEIC (ISOBMFF ftyp=heic, HEVC primary frame)
const VALID_HEIC_BUFFER = Buffer.from(
  'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADUAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAAEAAAAAEAAAAQAAAAAf///9AAAAAC////0AAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAPW1kYXQAAAAxKAGvBPIWZzRxZNLf+Cv///V4+y/SYUEm1Qjs/VLEYCa/deugZMTNE6ls0CgrqKdepg==',
  'base64'
);

// Helper to create a File object with polyfilled arrayBuffer() for environments where it is missing (like Jest's JSDOM/Node environment).
function createTestFile(buffer: Uint8Array, name: string, type: string): File {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const file = new File([arrayBuffer], name, { type });
  if (typeof file.arrayBuffer !== 'function') {
    file.arrayBuffer = async () => arrayBuffer;
  }
  return file;
}

// Helper to read arrayBuffer from a File object
async function getFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  // Fallback
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file as unknown as Blob);
  });
}

describe('imageProcessor - sanitizeImage', () => {
  afterAll(async () => {
    await resetImageWorkerPool();
  });

  it('should strip EXIF metadata and physically rotate a JPEG image', async () => {
    // 1. Create a 100x50 JPEG image with sideways orientation metadata (orientation: 6)
    const originalBuffer = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .withMetadata({
        orientation: 6, // 90 degrees CW
      })
      .toBuffer();

    // Verify original image has orientation 6, and dimensions 100x50
    const originalMeta = await sharp(originalBuffer).metadata();
    expect(originalMeta.width).toBe(100);
    expect(originalMeta.height).toBe(50);
    expect(originalMeta.orientation).toBe(6);
    expect(originalMeta.exif).toBeDefined();

    const originalFile = createTestFile(new Uint8Array(originalBuffer), 'photo.jpg', 'image/jpeg');

    // 2. Sanitize the image
    const sanitizedFile = await sanitizeImage(originalFile);

    // Get sanitized buffer
    const sanitizedArrayBuffer = await getFileArrayBuffer(sanitizedFile);
    const sanitizedBuffer = Buffer.from(sanitizedArrayBuffer);

    // 3. Verify sanitized image
    const sanitizedMeta = await sharp(sanitizedBuffer).metadata();

    // The image should be physically rotated, so dimensions are swapped: 100x50 -> 50x100
    expect(sanitizedMeta.width).toBe(50);
    expect(sanitizedMeta.height).toBe(100);

    // The EXIF orientation tag and all other EXIF metadata should be completely stripped
    expect(sanitizedMeta.orientation).toBeUndefined();
    expect(sanitizedMeta.exif).toBeUndefined();
  });

  it('should strip metadata from PNG images', async () => {
    const originalBuffer = await sharp({
      create: {
        width: 40,
        height: 40,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const originalFile = createTestFile(new Uint8Array(originalBuffer), 'avatar.png', 'image/png');

    const sanitizedFile = await sanitizeImage(originalFile);
    const sanitizedBuffer = Buffer.from(await getFileArrayBuffer(sanitizedFile));
    const sanitizedMeta = await sharp(sanitizedBuffer).metadata();

    expect(sanitizedMeta.width).toBe(40);
    expect(sanitizedMeta.height).toBe(40);
    expect(sanitizedMeta.exif).toBeUndefined();
  });

  it('should sanitize WebP images', async () => {
    const originalBuffer = await sharp({
      create: {
        width: 60,
        height: 60,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();

    const originalFile = createTestFile(new Uint8Array(originalBuffer), 'photo.webp', 'image/webp');

    const sanitizedFile = await sanitizeImage(originalFile);
    const sanitizedBuffer = Buffer.from(await getFileArrayBuffer(sanitizedFile));
    const sanitizedMeta = await sharp(sanitizedBuffer).metadata();

    expect(sanitizedMeta.width).toBe(60);
    expect(sanitizedMeta.height).toBe(60);
    expect(sanitizedMeta.format).toBe('webp');
  });

  it('should ignore and bypass ICO files without modification', async () => {
    // Create a dummy buffer for ICO file
    const dummyIcoBytes = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
    const originalFile = createTestFile(dummyIcoBytes, 'favicon.ico', 'image/x-icon');

    const sanitizedFile = await sanitizeImage(originalFile);

    // Verify it is the exact same file object
    expect(sanitizedFile).toBe(originalFile);
    const bytes = new Uint8Array(await getFileArrayBuffer(sanitizedFile));
    expect(bytes).toEqual(dummyIcoBytes);
  });

  it('should throw an error if sharp fails to sanitize image', async () => {
    // Passing a corrupt or empty JPEG buffer that would cause sharp to throw an error
    const corruptBytes = new Uint8Array([255, 216, 255, 224, 0, 0, 0]);
    const originalFile = createTestFile(corruptBytes, 'photo.jpg', 'image/jpeg');

    await expect(sanitizeImage(originalFile)).rejects.toThrow('Image sanitization failed');
  });

  it('should transcode HEIC files (including empty MIME type) into EXIF-stripped JPEG files with .jpg extension', async () => {
    expect(isHeicBuffer(VALID_HEIC_BUFFER)).toBe(true);
    expect(isHeicBuffer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);

    const heicFile = createTestFile(new Uint8Array(VALID_HEIC_BUFFER), 'IMG_1234.HEIC', 'image/heic');
    const sanitizedFile = await sanitizeImage(heicFile);

    expect(sanitizedFile.name).toBe('IMG_1234.jpg');
    expect(sanitizedFile.type).toBe('image/jpeg');

    const sanitizedBuffer = Buffer.from(await getFileArrayBuffer(sanitizedFile));
    const sanitizedMeta = await sharp(sanitizedBuffer).metadata();
    expect(sanitizedMeta.format).toBe('jpeg');
    expect(sanitizedMeta.width).toBe(16);
    expect(sanitizedMeta.height).toBe(16);
    expect(sanitizedMeta.exif).toBeUndefined();

    // Empty MIME type fallback (common on iOS Safari / desktop drag-and-drop)
    const emptyMimeHeicFile = createTestFile(new Uint8Array(VALID_HEIC_BUFFER), 'IMG_9999.heif', '');
    const sanitizedEmptyMime = await sanitizeImage(emptyMimeHeicFile);
    expect(sanitizedEmptyMime.name).toBe('IMG_9999.jpg');
    expect(sanitizedEmptyMime.type).toBe('image/jpeg');
  });

  it('should throw an error when a corrupt or spoofed HEIC file is passed', async () => {
    const spoofedHeic = createTestFile(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 1, 2, 3, 4]), 'corrupt.heic', 'image/heic');
    await expect(sanitizeImage(spoofedHeic)).rejects.toThrow('Image sanitization failed');

    const nonHeicMagicWithHeicExt = createTestFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'spoof.heic', '');
    await expect(sanitizeImage(nonHeicMagicWithHeicExt)).rejects.toThrow('Image sanitization failed');
  });

  describe('imageProcessorWorker module', () => {
    it('should process image buffer in worker module directly', async () => {
      const originalBuffer = await sharp({
        create: {
          width: 30,
          height: 30,
          channels: 3,
          background: { r: 100, g: 100, b: 100 },
        },
      })
        .png()
        .toBuffer();

      const resultUint8Array = await processImageWorkerBuffer(originalBuffer);
      const meta = await sharp(Buffer.from(resultUint8Array)).metadata();
      expect(meta.width).toBe(30);
      expect(meta.height).toBe(30);
    });

    it('should keep worker input byte limit aligned with MAX_GUEST_PHOTO_SIZE and parse ISOBMFF ispe extents', () => {
      expect(MAX_WORKER_INPUT_BYTES).toBe(MAX_GUEST_PHOTO_SIZE);

      const extents: HeicSpatialExtent[] = parseHeicSpatialExtents(VALID_HEIC_BUFFER);
      expect(extents).toEqual([{ width: 64, height: 64 }]);

      // 64-bit largesize ISOBMFF meta box containing iprp -> ipco -> ispe (4032x3024)
      const ispeBox = Buffer.alloc(20);
      ispeBox.writeUInt32BE(20, 0);
      ispeBox.write('ispe', 4, 'ascii');
      ispeBox.writeUInt32BE(0, 8); // version=0, flags=0
      ispeBox.writeUInt32BE(4032, 12);
      ispeBox.writeUInt32BE(3024, 16);

      const ipcoBox = Buffer.alloc(8 + ispeBox.length);
      ipcoBox.writeUInt32BE(ipcoBox.length, 0);
      ipcoBox.write('ipco', 4, 'ascii');
      ispeBox.copy(ipcoBox, 8);

      const iprpBox = Buffer.alloc(8 + ipcoBox.length);
      iprpBox.writeUInt32BE(iprpBox.length, 0);
      iprpBox.write('iprp', 4, 'ascii');
      ipcoBox.copy(iprpBox, 8);

      const metaBox = Buffer.alloc(16 + 4 + iprpBox.length);
      metaBox.writeUInt32BE(1, 0); // largesize marker
      metaBox.write('meta', 4, 'ascii');
      metaBox.writeBigUInt64BE(BigInt(metaBox.length), 8);
      metaBox.writeUInt32BE(0, 16); // FullBox version/flags
      iprpBox.copy(metaBox, 20);

      expect(parseHeicSpatialExtents(metaBox)).toEqual([{ width: 4032, height: 3024 }]);
    });
  });

  describe('pre-decode byte and dimension guards', () => {
    afterEach(async () => {
      await resetImageWorkerPool();
    });

    it('should reject oversized files before reading file.arrayBuffer() while allowing exact 5 MB uploads', async () => {
      const arrayBufferSpy = jest.fn(async () => new ArrayBuffer(0));
      const oversizedFile = {
        name: 'oversized.jpg',
        type: 'image/jpeg',
        size: MAX_GUEST_PHOTO_SIZE + 1,
        arrayBuffer: arrayBufferSpy,
      } as unknown as File;

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        await expect(sanitizeImage(oversizedFile)).rejects.toMatchObject({
          statusCode: 400,
          message: expect.stringContaining('Image sanitization failed'),
        });
        expect(arrayBufferSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }

      // Also reject inside processImageWorkerBuffer when passed an oversized Uint8Array directly
      const oversizedRaw = new Uint8Array(MAX_GUEST_PHOTO_SIZE + 1);
      await expect(processImageWorkerBuffer(oversizedRaw)).rejects.toThrow(/exceeds maximum allowed limit/);

      // Preserve exact 5 MB admin upload limit (MAX_UPLOAD_SIZE <= MAX_GUEST_PHOTO_SIZE)
      const validPng = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .png()
        .toBuffer();
      const exactAdminFile = {
        name: 'admin-banner.png',
        type: 'image/png',
        size: MAX_UPLOAD_SIZE,
        arrayBuffer: async () =>
          validPng.buffer.slice(validPng.byteOffset, validPng.byteOffset + validPng.byteLength),
      } as unknown as File;

      const sanitizedAdmin = await sanitizeImage(exactAdminFile);
      expect(sanitizedAdmin.type).toBe('image/png');
    });

    it('should reject HEIC buffers whose ISOBMFF ispe extents exceed max side or pixel limits before decoding', async () => {
      await resetImageWorkerPool({ maxPoolSize: 1 });

      const cloneHeicWithIspe = (width: number, height: number): Buffer => {
        const mutated = Buffer.from(VALID_HEIC_BUFFER);
        // VALID_HEIC_BUFFER has 'ispe' at offset 308 (8-byte header + 4-byte FullBox + width + height)
        const ispeOffset = mutated.indexOf(Buffer.from('ispe', 'ascii')) - 4;
        expect(ispeOffset).toBe(308);
        mutated.writeUInt32BE(width, ispeOffset + 12);
        mutated.writeUInt32BE(height, ispeOffset + 16);
        return mutated;
      };

      const wideHeic = cloneHeicWithIspe(MAX_IMAGE_DIMENSION + 1, 64);
      await expect(processImageWorkerBuffer(wideHeic)).rejects.toThrow(/exceed maximum allowed limits/);

      const highPixelHeic = cloneHeicWithIspe(9000, 8000); // 72,000,000 > MAX_IMAGE_PIXELS (64,000,000)
      expect(9000 * 8000).toBeGreaterThan(MAX_IMAGE_PIXELS);
      await expect(processImageWorkerBuffer(highPixelHeic)).rejects.toThrow(/exceed maximum allowed limits/);

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        const wideHeicFile = createTestFile(new Uint8Array(wideHeic), 'bomb.heic', 'image/heic');
        await expect(sanitizeImage(wideHeicFile)).rejects.toBeInstanceOf(ApiError);
        expect(errorSpy).toHaveBeenCalled();
        // Pre-decode ispe guard rejects before lazy heic-decode WASM import runs
        expect(getImageWorkerPoolStats().heicLoadedWorkerIds).toEqual([]);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('should fail closed on depth-7 ISOBMFF boxes instead of returning early before loading heic-decode', async () => {
      await resetImageWorkerPool({ maxPoolSize: 1 });
      expect(MAX_ISOBMFF_BOX_DEPTH).toBe(6);

      const makeIspeBox = (width: number, height: number): Buffer => {
        const box = Buffer.alloc(20);
        box.writeUInt32BE(20, 0);
        box.write('ispe', 4, 'ascii');
        box.writeUInt32BE(0, 8);
        box.writeUInt32BE(width, 12);
        box.writeUInt32BE(height, 16);
        return box;
      };

      const wrapContainerBoxes = (inner: Buffer, count: number): Buffer => {
        let current = inner;
        for (let i = 0; i < count; i += 1) {
          const wrapped = Buffer.alloc(8 + current.length);
          wrapped.writeUInt32BE(wrapped.length, 0);
          wrapped.write('moov', 4, 'ascii');
          current.copy(wrapped, 8);
          current = wrapped;
        }
        return current;
      };

      // Depth 6 (6 nested container boxes wrapping ispe) remains permitted
      const depth6Container = wrapContainerBoxes(makeIspeBox(32, 32), MAX_ISOBMFF_BOX_DEPTH);
      expect(parseHeicSpatialExtents(depth6Container)).toEqual([{ width: 32, height: 32 }]);

      // Depth 7 (7 nested container boxes wrapping oversized ispe alongside a valid shallow ispe) must throw
      const ftypHeader = VALID_HEIC_BUFFER.subarray(0, 28);
      const shallowValidContainer = wrapContainerBoxes(makeIspeBox(64, 64), 2);
      const depth7BombContainer = wrapContainerBoxes(
        makeIspeBox(MAX_IMAGE_DIMENSION + 5000, MAX_IMAGE_DIMENSION + 5000),
        MAX_ISOBMFF_BOX_DEPTH + 1
      );
      const depth7Heic = Buffer.concat([ftypHeader, shallowValidContainer, depth7HeicTail(depth7BombContainer)]);

      function depth7HeicTail(box: Buffer): Buffer {
        return box;
      }

      expect(() => parseHeicSpatialExtents(depth7Heic)).toThrow(
        /ISOBMFF box nesting depth \(7\) exceeds maximum allowed limit \(6\)/
      );
      await expect(processImageWorkerBuffer(depth7Heic)).rejects.toThrow(
        /ISOBMFF box nesting depth \(7\) exceeds maximum allowed limit \(6\)/
      );

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        const depth7File = createTestFile(new Uint8Array(depth7Heic), 'nested.heic', 'image/heic');
        await expect(sanitizeImage(depth7File)).rejects.toBeInstanceOf(ApiError);
        expect(getImageWorkerPoolStats().heicLoadedWorkerIds).toEqual([]);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('should reject oversized HEIF grid and derived frame canvases via heic-decode all() before decode() and always call dispose()', async () => {
      // 1. Real WASM integration check: ispe remains 64x64 while clap derived canvas header is 16000x16000
      const oversizedDerivedHeic = Buffer.from(VALID_HEIC_BUFFER);
      const clapOffset = oversizedDerivedHeic.indexOf(Buffer.from('clap', 'ascii')) - 4;
      expect(clapOffset).toBeGreaterThan(0);
      oversizedDerivedHeic.writeUInt32BE(16000, clapOffset + 8);
      oversizedDerivedHeic.writeUInt32BE(1, clapOffset + 12);
      oversizedDerivedHeic.writeUInt32BE(16000, clapOffset + 16);
      oversizedDerivedHeic.writeUInt32BE(1, clapOffset + 20);

      expect(parseHeicSpatialExtents(oversizedDerivedHeic)).toEqual([{ width: 64, height: 64 }]);
      await expect(processImageWorkerBuffer(oversizedDerivedHeic)).rejects.toThrow(
        /HEIC frame dimensions \(16000x16000\) exceed maximum allowed limits/
      );

      // 2. Isolated unit check for multi-frame HEIF grid containers and finally { images.dispose() } cleanup
      await jest.isolateModulesAsync(async () => {
        const primaryDecodeSpy = jest.fn();
        const gridDecodeSpy = jest.fn();
        const disposeSpy = jest.fn();
        let mode: 'oversized-grid-frame' | 'decode-throws' = 'oversized-grid-frame';

        const mockAll = jest.fn(async () => {
          const frames =
            mode === 'oversized-grid-frame'
              ? [
                { width: 512, height: 512, decode: primaryDecodeSpy },
                { width: 16384, height: 16384, decode: gridDecodeSpy },
              ]
              : [
                {
                  width: 64,
                  height: 64,
                  decode: async () => {
                    primaryDecodeSpy();
                    throw new Error('Simulated libheif decode failure');
                  },
                },
              ];
          return Object.defineProperty(frames, 'dispose', {
            enumerable: false,
            value: disposeSpy,
          });
        });

        jest.doMock('heic-decode', () => ({
          all: mockAll,
          default: Object.assign(jest.fn(), { all: mockAll }),
        }));

        const { processImageWorkerBuffer: isolatedProcessBuffer } = await import(
          '../imageProcessorWorker'
        );

        await expect(isolatedProcessBuffer(VALID_HEIC_BUFFER)).rejects.toThrow(
          /HEIC frame dimensions \(16384x16384\) exceed maximum allowed limits/
        );
        expect(mockAll).toHaveBeenCalledTimes(1);
        expect(primaryDecodeSpy).not.toHaveBeenCalled();
        expect(gridDecodeSpy).not.toHaveBeenCalled();
        expect(disposeSpy).toHaveBeenCalledTimes(1);

        disposeSpy.mockClear();
        mode = 'decode-throws';
        await expect(isolatedProcessBuffer(VALID_HEIC_BUFFER)).rejects.toThrow(
          'Simulated libheif decode failure'
        );
        expect(primaryDecodeSpy).toHaveBeenCalledTimes(1);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
      });
    });

    it('should reject oversized raster images exceeding max side (12000) or pixel limit (64000000)', async () => {
      const widePng = await sharp({
        create: {
          width: MAX_IMAGE_DIMENSION + 1,
          height: 1,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();

      await expect(processImageWorkerBuffer(widePng)).rejects.toThrow(/exceed maximum allowed limits/);

      const hugePixelPng = await sharp({
        create: {
          width: 9000,
          height: 8000,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();

      await expect(processImageWorkerBuffer(hugePixelPng)).rejects.toThrow(/pixel limit|exceed maximum allowed limits/i);

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        const wideFile = createTestFile(new Uint8Array(widePng), 'wide.png', 'image/png');
        await expect(sanitizeImage(wideFile)).rejects.toMatchObject({
          statusCode: 400,
          message: 'Image sanitization failed. The file may be corrupt or invalid.',
        });
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('worker lifecycle, timeout termination, and fail-closed error logging', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      jest.useRealTimers();
      jest.resetModules();
      jest.restoreAllMocks();
    });

    it('should bind static URL worker in non-test NODE_ENV and strip-types worker path in test NODE_ENV', async () => {
      const validPng = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();

      const constructedArgs: Array<{ script: unknown; options: Record<string, unknown> | undefined }> = [];

      await jest.isolateModulesAsync(async () => {
        jest.doMock('node:worker_threads', () => ({
          Worker: jest.fn().mockImplementation((script: unknown, options?: Record<string, unknown>) => {
            constructedArgs.push({ script, options });
            const emitter = new EventEmitter() as EventEmitter & {
              ref: jest.Mock;
              unref: jest.Mock;
              postMessage: jest.Mock;
              terminate: jest.Mock;
            };
            emitter.ref = jest.fn();
            emitter.unref = jest.fn();
            emitter.terminate = jest.fn().mockResolvedValue(1);
            emitter.postMessage = jest.fn((task: { id: number }) => {
              queueMicrotask(() => {
                emitter.emit('message', {
                  id: task.id,
                  success: true,
                  buffer: new Uint8Array(validPng),
                });
              });
            });
            queueMicrotask(() => {
              emitter.emit('message', { type: 'ready' });
            });
            return emitter;
          }),
        }));

        const {
          sanitizeImage: isolatedSanitize,
          resetImageWorkerPool: isolatedResetPool,
        } = await import('../imageProcessor');

        try {
          // 1. Test branch: path.resolve(..., 'src', 'utils', 'imageProcessorWorker.ts') + --experimental-strip-types
          (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
          await isolatedSanitize(createTestFile(new Uint8Array(validPng), 'worker-check-1.png', 'image/png'));
          expect(constructedArgs[0]?.script).toBe(
            path.resolve(process.cwd(), 'src', 'utils', 'imageProcessorWorker.ts')
          );
          expect(constructedArgs[0]?.options?.execArgv).toEqual(['--experimental-strip-types']);
          expect(constructedArgs[0]?.options?.workerData).toEqual({ isImageProcessorPoolWorker: true });

          await isolatedResetPool();

          // 2. Production/standalone branch: static URL('./imageProcessorWorker.ts', import.meta.url) without execArgv
          (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
          await isolatedSanitize(createTestFile(new Uint8Array(validPng), 'worker-check-2.png', 'image/png'));
          expect(constructedArgs[1]?.script).toBeInstanceOf(URL);
          expect((constructedArgs[1]?.script as URL).pathname).toMatch(/\/imageProcessorWorker\.ts$/);
          expect(constructedArgs[1]?.options?.execArgv).toBeUndefined();
          expect(constructedArgs[1]?.options?.workerData).toEqual({ isImageProcessorPoolWorker: true });
        } finally {
          await isolatedResetPool();
        }
      });
    });

    it('should terminate worker after 10000 ms timeout, log error, and reject with 400 without main-thread fallback', async () => {
      const validPng = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();
      const inputFile = createTestFile(new Uint8Array(validPng), 'hung.png', 'image/png');

      jest.useFakeTimers();

      await jest.isolateModulesAsync(async () => {
        const terminateMock = jest.fn().mockResolvedValue(1);
        const mainThreadFallbackSpy = jest.fn();

        jest.doMock('node:worker_threads', () => ({
          Worker: jest.fn().mockImplementation(() => {
            const emitter = new EventEmitter() as EventEmitter & {
              ref: jest.Mock;
              unref: jest.Mock;
              postMessage: jest.Mock;
              terminate: jest.Mock;
            };
            emitter.ref = jest.fn();
            emitter.unref = jest.fn();
            emitter.postMessage = jest.fn();
            emitter.terminate = terminateMock;
            return emitter;
          }),
        }));

        jest.doMock('../imageProcessorWorker', () => {
          const actual = jest.requireActual('../imageProcessorWorker');
          return {
            ...actual,
            processImageWorkerBuffer: mainThreadFallbackSpy,
          };
        });

        const { logger: isolatedLogger } = await import('@/lib/logger');
        const errorSpy = jest.spyOn(isolatedLogger, 'error').mockImplementation(() => {});
        const {
          sanitizeImage: isolatedSanitize,
          resetImageWorkerPool: isolatedResetPool,
        } = await import('../imageProcessor');

        try {
          let settledError: unknown = null;
          const promise = isolatedSanitize(inputFile).catch((err) => {
            settledError = err;
          });

          await jest.advanceTimersByTimeAsync(9999);
          expect(terminateMock).not.toHaveBeenCalled();
          expect(settledError).toBeNull();

          await jest.advanceTimersByTimeAsync(1);
          await promise;

          expect(terminateMock).toHaveBeenCalledTimes(1);
          expect(mainThreadFallbackSpy).not.toHaveBeenCalled();
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Image processor worker timed out after 10000ms')
          );
          expect(settledError).toMatchObject({
            statusCode: 400,
            message: 'Image sanitization failed. Worker thread timed out.',
          });
        } finally {
          await isolatedResetPool();
        }
      });
    });

    it('should log worker initialization, error, and non-zero exit failures and fail closed without main-thread fallback', async () => {
      const validPng = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();

      type FailureScenario = 'init-throw' | 'error-event' | 'nonzero-exit';
      let currentScenario: FailureScenario = 'init-throw';
      const mainThreadFallbackSpy = jest.fn();
      const terminateMock = jest.fn().mockResolvedValue(1);

      await jest.isolateModulesAsync(async () => {
        jest.doMock('node:worker_threads', () => ({
          Worker: jest.fn().mockImplementation(() => {
            if (currentScenario === 'init-throw') {
              const err = new Error("Cannot find module '/app/src/utils/imageProcessorWorker.ts'");
              (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
              throw err;
            }
            const emitter = new EventEmitter() as EventEmitter & {
              ref: jest.Mock;
              unref: jest.Mock;
              postMessage: jest.Mock;
              terminate: jest.Mock;
            };
            emitter.ref = jest.fn();
            emitter.unref = jest.fn();
            emitter.postMessage = jest.fn();
            emitter.terminate = terminateMock;
            queueMicrotask(() => {
              if (currentScenario === 'error-event') {
                emitter.emit('error', new Error('Simulated worker runtime crash'));
              } else {
                emitter.emit('exit', 2);
              }
            });
            return emitter;
          }),
        }));

        jest.doMock('../imageProcessorWorker', () => {
          const actual = jest.requireActual('../imageProcessorWorker');
          return {
            ...actual,
            processImageWorkerBuffer: mainThreadFallbackSpy,
          };
        });

        const { logger: isolatedLogger } = await import('@/lib/logger');
        const errorSpy = jest.spyOn(isolatedLogger, 'error').mockImplementation(() => {});
        const {
          sanitizeImage: isolatedSanitize,
          resetImageWorkerPool: isolatedResetPool,
        } = await import('../imageProcessor');

        try {
          // Scenario 1: Synchronous Worker constructor initialization error
          currentScenario = 'init-throw';
          await expect(
            isolatedSanitize(createTestFile(new Uint8Array(validPng), 'fail-1.png', 'image/png'))
          ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Image sanitization failed. The file may be corrupt or invalid.',
          });
          expect(errorSpy).toHaveBeenCalledWith(
            'Failed to initialize image processor worker:',
            expect.any(Error)
          );

          // Scenario 2: Worker 'error' event
          errorSpy.mockClear();
          currentScenario = 'error-event';
          await expect(
            isolatedSanitize(createTestFile(new Uint8Array(validPng), 'fail-2.png', 'image/png'))
          ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Image sanitization failed. The file may be corrupt or invalid.',
          });
          expect(errorSpy).toHaveBeenCalledWith(
            'Image processor worker emitted an error:',
            expect.any(Error)
          );

          // Scenario 3: Worker non-zero 'exit' event
          errorSpy.mockClear();
          currentScenario = 'nonzero-exit';
          await expect(
            isolatedSanitize(createTestFile(new Uint8Array(validPng), 'fail-3.png', 'image/png'))
          ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Image sanitization failed. The file may be corrupt or invalid.',
          });
          expect(errorSpy).toHaveBeenCalledWith(
            'Image processor worker exited unexpectedly with code 2'
          );

          // Confirm main-thread processImageWorkerBuffer fallback was NEVER called in any scenario
          expect(mainThreadFallbackSpy).not.toHaveBeenCalled();
        } finally {
          await isolatedResetPool();
        }
      });
    });

    it('should pass V8 resourceLimits to Worker in test and production modes and evict worker on heap OOM', async () => {
      expect(WORKER_RESOURCE_LIMITS).toEqual({
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      });

      const validPng = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 8, b: 7 } },
      })
        .png()
        .toBuffer();

      const constructedOptions: Array<Record<string, unknown> | undefined> = [];
      const terminateMock = jest.fn().mockResolvedValue(1);
      let triggerOomOnNextTask = false;

      await jest.isolateModulesAsync(async () => {
        jest.doMock('node:worker_threads', () => ({
          Worker: jest.fn().mockImplementation((_script: unknown, options?: Record<string, unknown>) => {
            constructedOptions.push(options);
            const emitter = new EventEmitter() as EventEmitter & {
              ref: jest.Mock;
              unref: jest.Mock;
              postMessage: jest.Mock;
              terminate: jest.Mock;
            };
            emitter.ref = jest.fn();
            emitter.unref = jest.fn();
            emitter.terminate = terminateMock;
            emitter.postMessage = jest.fn((task: { id: number }) => {
              queueMicrotask(() => {
                if (triggerOomOnNextTask) {
                  triggerOomOnNextTask = false;
                  const oomErr = new Error('Worker terminated due to reaching memory limit: JS heap out of memory');
                  (oomErr as NodeJS.ErrnoException).code = 'ERR_WORKER_OUT_OF_MEMORY';
                  emitter.emit('error', oomErr);
                  return;
                }
                emitter.emit('message', {
                  id: task.id,
                  success: true,
                  buffer: new Uint8Array(validPng),
                });
              });
            });
            queueMicrotask(() => {
              emitter.emit('message', { type: 'ready' });
            });
            return emitter;
          }),
        }));

        const { logger: isolatedLogger } = await import('@/lib/logger');
        const errorSpy = jest.spyOn(isolatedLogger, 'error').mockImplementation(() => {});
        const {
          sanitizeImage: isolatedSanitize,
          getImageWorkerPoolStats: isolatedStats,
          resetImageWorkerPool: isolatedResetPool,
        } = await import('../imageProcessor');

        try {
          (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
          await isolatedSanitize(createTestFile(new Uint8Array(validPng), 'limits-test.png', 'image/png'));
          expect(constructedOptions[0]?.resourceLimits).toEqual(WORKER_RESOURCE_LIMITS);
          const firstWorkerId = isolatedStats().workerIds[0];

          // Trigger V8 resourceLimits OOM error and verify failAndEvictWorkerSlot evicts the worker
          triggerOomOnNextTask = true;
          await expect(
            isolatedSanitize(createTestFile(new Uint8Array(validPng), 'oom.png', 'image/png'))
          ).rejects.toMatchObject({
            statusCode: 400,
            message: 'Image sanitization failed. The file may be corrupt or invalid.',
          });
          expect(terminateMock).toHaveBeenCalledTimes(1);
          expect(isolatedStats().workerIds).not.toContain(firstWorkerId);
          expect(errorSpy).toHaveBeenCalled();

          await isolatedResetPool();

          (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
          await isolatedSanitize(createTestFile(new Uint8Array(validPng), 'limits-prod.png', 'image/png'));
          expect(constructedOptions[constructedOptions.length - 1]?.resourceLimits).toEqual(
            WORKER_RESOURCE_LIMITS
          );
        } finally {
          await isolatedResetPool();
        }
      });
    });
  });

  describe('warm worker pool, lazy HEIC loading, and fault isolation', () => {
    afterEach(async () => {
      await resetImageWorkerPool();
    });

    it('reuses warm workers across sequential uploads and avoids loading heic-decode on raster formats', async () => {
      await resetImageWorkerPool({ maxPoolSize: 2 });

      const jpegBuf = await sharp({
        create: { width: 24, height: 24, channels: 3, background: { r: 200, g: 50, b: 50 } },
      }).jpeg().toBuffer();
      const pngBuf = await sharp({
        create: { width: 24, height: 24, channels: 4, background: { r: 50, g: 200, b: 50, alpha: 1 } },
      }).png().toBuffer();
      const webpBuf = await sharp({
        create: { width: 24, height: 24, channels: 4, background: { r: 50, g: 50, b: 200, alpha: 1 } },
      }).webp().toBuffer();

      await sanitizeImage(createTestFile(new Uint8Array(jpegBuf), 'one.jpg', 'image/jpeg'));
      const statsAfterFirst: ImageWorkerPoolStats = getImageWorkerPoolStats();
      expect(statsAfterFirst.poolSize).toBe(1);
      expect(statsAfterFirst.readyWorkers).toBe(1);
      expect(statsAfterFirst.busyWorkers).toBe(0);
      expect(statsAfterFirst.heicLoadedWorkerIds).toEqual([]);
      const firstWorkerId = statsAfterFirst.workerIds[0];

      await sanitizeImage(createTestFile(new Uint8Array(pngBuf), 'two.png', 'image/png'));
      await sanitizeImage(createTestFile(new Uint8Array(webpBuf), 'three.webp', 'image/webp'));

      // Spoofed HEIC header should fail before importing heic-decode
      const spoofedHeader = createTestFile(
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
        'spoof.heic',
        'image/heic'
      );
      await expect(sanitizeImage(spoofedHeader)).rejects.toThrow('Image sanitization failed');

      const statsAfterRaster = getImageWorkerPoolStats();
      expect(statsAfterRaster.workerIds).toEqual([firstWorkerId]);
      expect(statsAfterRaster.heicLoadedWorkerIds).toEqual([]);

      // Valid HEIC upload lazily loads heic-decode in the warm worker isolate
      const validHeic = createTestFile(new Uint8Array(VALID_HEIC_BUFFER), 'IMG_0001.HEIC', 'image/heic');
      const transcoded = await sanitizeImage(validHeic);
      expect(transcoded.name).toBe('IMG_0001.jpg');
      expect(transcoded.type).toBe('image/jpeg');

      const statsAfterHeic = getImageWorkerPoolStats();
      expect(statsAfterHeic.workerIds).toEqual([firstWorkerId]);
      expect(statsAfterHeic.heicLoadedWorkerIds).toEqual([firstWorkerId]);
    });

    it('bounds concurrent worker threads and queues excess tasks cleanly', async () => {
      await resetImageWorkerPool({ maxPoolSize: 2 });

      const pngBuf = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
      }).png().toBuffer();

      const files = Array.from({ length: 6 }, (_, idx) =>
        createTestFile(new Uint8Array(pngBuf), `batch-${idx}.png`, 'image/png')
      );

      const sanitized = await Promise.all(files.map((file) => sanitizeImage(file)));
      expect(sanitized).toHaveLength(6);

      const stats = getImageWorkerPoolStats();
      expect(stats.poolSize).toBeLessThanOrEqual(2);
      expect(stats.busyWorkers).toBe(0);
      expect(stats.queuedTasks).toBe(0);
    });

    it('verifies worker readiness before transferring ArrayBuffer and fails closed without detaching input bytes on startup error', async () => {
      const missingWorkerPath = path.join(os.tmpdir(), `nonexistent-worker-${Date.now()}.mjs`);
      await resetImageWorkerPool({ workerPathOverride: missingWorkerPath, maxPoolSize: 2 });

      const pngBuf = await sharp({
        create: { width: 28, height: 18, channels: 3, background: { r: 120, g: 80, b: 40 } },
      }).png().toBuffer();

      // Unshared ArrayBuffer view that would detach to byteLength 0 if transferred prematurely
      const unsharedInput = new Uint8Array(pngBuf);
      expect(unsharedInput.byteLength).toBeGreaterThan(0);

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        await expect(offloadSanitizeToWorker(unsharedInput, 2000)).rejects.toEqual(
          expect.objectContaining({
            statusCode: 400,
            message: 'Image sanitization failed. The file may be corrupt or invalid.',
          })
        );
        expect(unsharedInput.byteLength).toBe(pngBuf.byteLength);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('isolates timed-out and crashed tasks, evicts broken workers, and spawns clean replacements', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'img-worker-pool-test-'));
      const tempWorkerPath = path.join(tempDir, 'mockPoolWorker.mjs');

      await fs.writeFile(
        tempWorkerPath,
        [
          "import { parentPort } from 'node:worker_threads';",
          'parentPort.on("message", (task) => {',
          '  const marker = task.buffer[0];',
          '  if (marker === 0xde) {',
          '    // Simulate stalled worker: never respond',
          '    return;',
          '  }',
          '  if (marker === 0xcf) {',
          '    // Simulate mid-task worker crash',
          '    process.exit(1);',
          '  }',
          '  setTimeout(() => {',
          '    const out = new Uint8Array([marker, task.buffer.byteLength]);',
          '    parentPort.postMessage({ id: task.id, success: true, buffer: out }, [out.buffer]);',
          '  }, 20);',
          '});',
          'parentPort.postMessage({ type: "ready" });',
        ].join('\n'),
        'utf8'
      );

      try {
        await resetImageWorkerPool({ workerPathOverride: tempWorkerPath, maxPoolSize: 2 });

        // Warm both pool slots first
        await Promise.all([
          offloadSanitizeToWorker(new Uint8Array([1, 2, 3]), 2000),
          offloadSanitizeToWorker(new Uint8Array([4, 5, 6]), 2000),
        ]);
        const initialWorkerIds = [...getImageWorkerPoolStats().workerIds];
        expect(initialWorkerIds).toHaveLength(2);

        const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
        try {
          // Dispatch 1 stalled task (80ms timeout), 1 healthy sibling task, and 1 queued task
          const stalledPromise = offloadSanitizeToWorker(new Uint8Array([0xde, 1]), 80);
          const siblingPromise = offloadSanitizeToWorker(new Uint8Array([0x11, 2, 3]), 2000);
          const queuedPromise = offloadSanitizeToWorker(new Uint8Array([0x22, 4, 5, 6]), 2000);

          await expect(stalledPromise).rejects.toEqual(
            expect.objectContaining({
              statusCode: 400,
              message: 'Image sanitization failed. Worker thread timed out.',
            })
          );
          await expect(stalledPromise).rejects.toBeInstanceOf(ApiError);

          const [siblingResult, queuedResult] = await Promise.all([siblingPromise, queuedPromise]);
          expect(Array.from(siblingResult)).toEqual([0x11, 3]);
          expect(Array.from(queuedResult)).toEqual([0x22, 4]);

          // Stalled worker was evicted; sibling worker remained healthy
          const afterTimeoutIds = getImageWorkerPoolStats().workerIds;
          expect(afterTimeoutIds).not.toContain(initialWorkerIds[0]);
          expect(afterTimeoutIds).toContain(initialWorkerIds[1]);

          // Dispatch a mid-task crash, verify ApiError(400) and clean replacement worker spawn later
          await expect(
            offloadSanitizeToWorker(new Uint8Array([0xcf, 9]), 2000)
          ).rejects.toEqual(
            expect.objectContaining({
              statusCode: 400,
              message: 'Image sanitization failed. The file may be corrupt or invalid.',
            })
          );

          // Now run two concurrent tasks to verify a clean replacement worker spawns up to maxPoolSize
          const [repA, repB] = await Promise.all([
            offloadSanitizeToWorker(new Uint8Array([0x33, 1]), 2000),
            offloadSanitizeToWorker(new Uint8Array([0x44, 1, 2]), 2000),
          ]);
          expect(Array.from(repA)).toEqual([0x33, 2]);
          expect(Array.from(repB)).toEqual([0x44, 3]);

          const finalStats = getImageWorkerPoolStats();
          expect(finalStats.poolSize).toBe(2);
          expect(finalStats.readyWorkers).toBe(2);
          expect(finalStats.busyWorkers).toBe(0);
        } finally {
          errorSpy.mockRestore();
        }
      } finally {
        await resetImageWorkerPool();
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('caps active HEIC tasks at 2 workers while keeping 4 workers available for raster images', async () => {
      expect(MAX_CONCURRENT_HEIC_WORKERS).toBe(2);

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'img-heic-cap-test-'));
      const tempWorkerPath = path.join(tempDir, 'mockHeicCapWorker.mjs');

      await fs.writeFile(
        tempWorkerPath,
        [
          "import { parentPort } from 'node:worker_threads';",
          'let heicLoaded = false;',
          'parentPort.on("message", (task) => {',
          '  const isHeic = Boolean(task.expectHeic);',
          '  if (isHeic) heicLoaded = true;',
          '  const delay = isHeic ? 90 : 50;',
          '  setTimeout(() => {',
          '    const out = new Uint8Array([isHeic ? 0xaa : 0xbb, task.id]);',
          '    parentPort.postMessage({ id: task.id, success: true, buffer: out, heicDecoderLoaded: heicLoaded }, [out.buffer]);',
          '  }, delay);',
          '});',
          'parentPort.postMessage({ type: "ready" });',
        ].join('\n'),
        'utf8'
      );

      try {
        await resetImageWorkerPool({ workerPathOverride: tempWorkerPath, maxPoolSize: 4 });

        // Dispatch 4 concurrent HEIC tasks: only 2 may run concurrently, queuing the other 2
        const heicPromises = Array.from({ length: 4 }, () =>
          offloadSanitizeToWorker(new Uint8Array(VALID_HEIC_BUFFER), 5000, { expectHeic: true })
        );

        await new Promise((resolve) => setTimeout(resolve, 25));
        const midHeicStats = getImageWorkerPoolStats();
        expect(midHeicStats.maxPoolSize).toBe(4);
        expect(midHeicStats.activeHeicWorkers).toBe(2);
        expect(midHeicStats.busyWorkers).toBe(2);
        expect(midHeicStats.queuedTasks).toBe(2);

        // Dispatch 2 raster tasks while 2 HEIC tasks are active and 2 HEIC tasks remain queued:
        // raster tasks bypass the queued HEIC tasks and scale the pool up to all 4 workers!
        const rasterPromises = [
          offloadSanitizeToWorker(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 5000, { expectHeic: false }),
          offloadSanitizeToWorker(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 5000, { expectHeic: false }),
        ];

        await new Promise((resolve) => setTimeout(resolve, 15));
        const mixedStats = getImageWorkerPoolStats();
        expect(mixedStats.poolSize).toBe(4);
        expect(mixedStats.busyWorkers).toBe(4);
        expect(mixedStats.activeHeicWorkers).toBe(2);
        expect(mixedStats.queuedTasks).toBe(2);

        const [heicResults, rasterResults] = await Promise.all([
          Promise.all(heicPromises),
          Promise.all(rasterPromises),
        ]);
        expect(heicResults).toHaveLength(4);
        expect(rasterResults).toHaveLength(2);

        const settledStats = getImageWorkerPoolStats();
        expect(settledStats.busyWorkers).toBe(0);
        expect(settledStats.activeHeicWorkers).toBe(0);
        expect(settledStats.queuedTasks).toBe(0);
        expect(settledStats.heicLoadedWorkerIds.length).toBeLessThanOrEqual(2);
      } finally {
        await resetImageWorkerPool();
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
