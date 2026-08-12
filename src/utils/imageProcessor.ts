import sharp from 'sharp';
import { logger } from '@/lib/logger';

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * and preserving their original format (e.g. JPEG, PNG) and dimensions.
 * Gracefully falls back to the original file if any error occurs or if the file format
 * is not supported (such as ICO, SVG, etc.).
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;

  // Only process standard JPEG and PNG files.
  // Fall back / ignore unsupported formats like ICO, SVG, or other non-image files.
  if (
    fileType !== 'image/jpeg' &&
    fileType !== 'image/jpg' &&
    fileType !== 'image/png'
  ) {
    logger.debug(`Skipping sanitization for non-supported format: ${fileType}`);
    return file;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // sharp(buffer).rotate() auto-rotates the image according to its EXIF Orientation tag.
    // By default, Sharp strips all EXIF metadata (unless .withMetadata() is explicitly called).
    // This removes GPS, camera models, and timestamps, and discards the rotation tags.
    const sanitizedBuffer = await sharp(buffer)
      .rotate()
      .toBuffer();

    logger.info(`Successfully sanitized image of type ${fileType}`);
    return new File([new Uint8Array(sanitizedBuffer)], file.name, { type: fileType });
  } catch (error) {
    logger.error('Failed to sanitize image, falling back to original file:', error);
    return file;
  }
}
