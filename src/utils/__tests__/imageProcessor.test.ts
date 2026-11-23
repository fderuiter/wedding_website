import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError } from '../ApiError';
import {
  getImageWorkerPoolStats,
  offloadSanitizeToWorker,
  resetImageWorkerPool,
  sanitizeImage,
  type ImageWorkerPoolStats,
} from '../imageProcessor';
import { isHeicBuffer, processImageWorkerBuffer } from '../imageProcessorWorker';

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

    it('verifies worker readiness before transferring ArrayBuffer so startup fallback retains intact bytes', async () => {
      const missingWorkerPath = path.join(os.tmpdir(), `nonexistent-worker-${Date.now()}.mjs`);
      await resetImageWorkerPool({ workerPathOverride: missingWorkerPath, maxPoolSize: 2 });

      const pngBuf = await sharp({
        create: { width: 28, height: 18, channels: 3, background: { r: 120, g: 80, b: 40 } },
      }).png().toBuffer();

      // Unshared ArrayBuffer view that would detach to byteLength 0 if transferred prematurely
      const unsharedInput = new Uint8Array(pngBuf);
      expect(unsharedInput.byteLength).toBeGreaterThan(0);

      const sanitizedBytes = await offloadSanitizeToWorker(unsharedInput, 2000);
      expect(unsharedInput.byteLength).toBe(pngBuf.byteLength);

      const meta = await sharp(Buffer.from(sanitizedBytes)).metadata();
      expect(meta.width).toBe(28);
      expect(meta.height).toBe(18);
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
        await resetImageWorkerPool();
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
