import sharp from 'sharp';
import { logger } from '@/lib/logger';
import { ApiError } from '@/utils/ApiError';

/**
 * Sanitizes image files by auto-rotating them based on their EXIF orientation tag,
 * stripping all sensitive EXIF metadata (GPS, camera model, timestamps, etc.),
 * and preserving their original format (e.g. JPEG, PNG) and dimensions.
 * Skips sanitization for non-Sharp image formats (such as ICO).
 * Throws an error if sanitization fails for supported formats.
 */
export async function sanitizeImage(file: File): Promise<File> {
  const fileType = file.type;

  // Only process standard JPEG and PNG files.
  // Skip unsupported formats like ICO.
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
    logger.error('Failed to sanitize image:', error);
    throw new ApiError(400, 'Image sanitization failed. The file may be corrupt or invalid.');
  }
}
