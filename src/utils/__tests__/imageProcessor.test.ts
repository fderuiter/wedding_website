import sharp from 'sharp';
import { sanitizeImage } from '../imageProcessor';
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
});
