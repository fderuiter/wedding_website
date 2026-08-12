import sharp from 'sharp';
import { sanitizeImage } from '../imageProcessor';

// Helper to create a File object with polyfilled arrayBuffer() for environments where it is missing (like Jest's JSDOM/Node environment).
function createTestFile(buffer: Uint8Array, name: string, type: string): File {
  const file = new File([buffer], name, { type });
  if (typeof file.arrayBuffer !== 'function') {
    file.arrayBuffer = async () => {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    };
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
    reader.readAsArrayBuffer(file as any);
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

  it('should fallback gracefully to original file if sharp throws an error', async () => {
    // Passing a corrupt or empty JPEG buffer that would cause sharp to throw an error
    const corruptBytes = new Uint8Array([255, 216, 255, 224, 0, 0, 0]);
    const originalFile = createTestFile(corruptBytes, 'photo.jpg', 'image/jpeg');

    const sanitizedFile = await sanitizeImage(originalFile);

    // It should fallback to the original file
    expect(sanitizedFile).toBe(originalFile);
    const bytes = new Uint8Array(await getFileArrayBuffer(sanitizedFile));
    expect(bytes).toEqual(corruptBytes);
  });
});
