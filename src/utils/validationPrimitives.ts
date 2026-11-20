import { z } from 'zod';

export function formatZodError(error: z.ZodError): string {
  return error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
}

/**
 * @internal
 */
export const FeatureSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  visible: z.boolean().default(true),
  content: z.string().optional(),
});

export const coordinateSchema = z.union([z.number(), z.string()]).superRefine((val, ctx) => {
  if (typeof val === 'number') return;
  const parsed = parseFloat(val);
  if (!isNaN(parsed)) return;

  if (!/^[A-Z_]+$/.test(val)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid coordinate format. Must be a numeric value or a placeholder.',
    });
  }
}).transform((val) => {
  if (typeof val === 'number') return val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
});

/**
 * @internal
 */
export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

/**
 * @internal
 */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'];

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.ico'];

export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic', '.heif'],
  'image/heif': ['.heic', '.heif'],
  'image/heic-sequence': ['.heic', '.heif'],
  'image/heif-sequence': ['.heic', '.heif'],
  'image/x-icon': ['.ico'],
  'image/vnd.microsoft.icon': ['.ico'],
};

const MIME_TO_NORMALIZED_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/heic-sequence': '.heic',
  'image/heif-sequence': '.heif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export const MAX_GUEST_PHOTO_SIZE = 10 * 1024 * 1024;
export const GUEST_PHOTO_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];
export const GUEST_PHOTO_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
export const HEIC_EXTENSIONS = ['.heic', '.heif'];

export function isHeicExtension(ext?: string | null): boolean {
  if (!ext || typeof ext !== 'string') return false;
  return HEIC_EXTENSIONS.includes(ext.toLowerCase());
}

export function getFileExtension(filename?: string | null): string {
  if (!filename || typeof filename !== 'string') return '';
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.substring(lastDot).toLowerCase();
}

export function getNormalizedExtension(mimeType: string, filename?: string | null): string {
  const allowed = MIME_TO_EXTENSIONS[mimeType];
  if (filename) {
    const ext = getFileExtension(filename);
    if (allowed && allowed.includes(ext)) {
      return ext;
    }
  }
  return MIME_TO_NORMALIZED_EXT[mimeType] || '.bin';
}

/**
 * Sanitizes a URL string for safe usage in HTML anchor href attributes.
 * Allows valid http://, https://, mailto:, and tel: URLs, safe relative paths, and non-URI strings.
 * Rejects dangerous URI schemes (javascript:, data:, vbscript:, etc.) and protocol-relative URLs (//)
 * to prevent XSS and unvalidated redirects.
 */
export function sanitizeUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  // Block protocol-relative URLs
  if (trimmed.startsWith('//')) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  // Block dangerous schemes explicitly
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return undefined;
  }

  // Allow safe relative paths starting with /, #, or ?
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return trimmed;
  }

  // Explicit check for allowed protocols
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:')
  ) {
    return trimmed;
  }

  return undefined;
}

/**
 * @internal
 */
export const createLaxUrlSchema = (fieldName = 'URL') =>
  z.string()
    .max(2000, `${fieldName} must be under 2000 characters`)
    .refine(
      (val) => {
        if (!val) return true;
        return sanitizeUrl(val) !== undefined;
      },
      { message: `${fieldName} must be a valid http, https, or relative URL` }
    )
    .optional()
    .nullable()
    .or(z.literal(''));

export const safeUrlSchema = createLaxUrlSchema('URL');
export const safeImageUrlSchema = createLaxUrlSchema('Image URL');

/**
 * Iteratively percent-decodes a URL path up to 3 rounds (including per-segment decoding
 * so malformed percent sequences in one segment cannot mask encoded traversal in another),
 * rejecting null bytes and backslashes in raw or decoded forms, as well as >3x multi-encoding.
 */
export function decodeUrlPathSafely(rawInput: string): string | null {
  if (typeof rawInput !== 'string' || rawInput.length === 0) {
    return null;
  }

  if (rawInput.includes('\0') || rawInput.includes('\\')) {
    return null;
  }

  const rawPath = rawInput.split('?')[0].split('#')[0];
  if (!rawPath) {
    return null;
  }

  if (/%(?:00|5c)/i.test(rawPath)) {
    return null;
  }

  let decoded = rawPath;
  let prev = '';
  let count = 0;

  while (decoded !== prev && count < 3) {
    prev = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      decoded = decoded
        .split('/')
        .map((segment) => {
          try {
            return decodeURIComponent(segment);
          } catch {
            return segment;
          }
        })
        .join('/');
    }

    if (decoded.includes('\0') || decoded.includes('\\') || /%(?:00|5c)/i.test(decoded)) {
      return null;
    }
    count++;
  }

  try {
    if (decodeURIComponent(decoded) !== decoded) {
      return null;
    }
  } catch {
    // Ignore URIError when decoded path legitimately contains a literal '%'
  }

  return decoded;
}

/**
 * Validates that a local URL path contains no parent traversal (`..`), empty/protocol-relative
 * double slashes (`//`), backslashes (`\`), or null bytes (`\0`) in raw or percent-decoded forms.
 */
export function isSafeLocalPathUrl(
  val: string,
  options: { requireLeadingSlash?: boolean } = {}
): boolean {
  if (typeof val !== 'string' || val.length === 0) {
    return false;
  }

  if (val.includes('\0') || val.includes('\\')) {
    return false;
  }

  const rawPath = val.split('?')[0].split('#')[0];
  if (!rawPath) {
    return false;
  }

  if (options.requireLeadingSlash && !rawPath.startsWith('/')) {
    return false;
  }

  if (rawPath.includes('//') || rawPath.includes('..') || /%(?:00|5c)/i.test(rawPath)) {
    return false;
  }

  const decoded = decodeUrlPathSafely(val);
  if (decoded === null) {
    return false;
  }

  if (options.requireLeadingSlash && !decoded.startsWith('/')) {
    return false;
  }

  if (decoded.includes('//') || decoded.includes('..')) {
    return false;
  }

  return true;
}

function isValidHttpOrHttpsUrl(val: string): boolean {
  if (val.includes('\0')) {
    return false;
  }
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(val);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Validates AppConfig branding/OpenGraph/favicon URLs:
 * allows empty string, valid http(s) URLs, or safe root-relative local URLs starting with '/'.
 */
export function isSafeConfigAssetUrl(val: string): boolean {
  if (val === '') {
    return true;
  }
  if (isValidHttpOrHttpsUrl(val)) {
    return true;
  }
  return isSafeLocalPathUrl(val, { requireLeadingSlash: true });
}

/**
 * Validates Media and Photo ContentNode URLs:
 * allows empty string, valid http(s) URLs, safe data:image/ URLs, or safe local URLs without '..', '//', '\', or '\0'.
 */
export function isSafeMediaOrPhotoUrl(val: string): boolean {
  if (val === '') {
    return true;
  }
  if (val.includes('\0')) {
    return false;
  }
  if (val.startsWith('http://') || val.startsWith('https://')) {
    return isValidHttpOrHttpsUrl(val);
  }
  if (val.startsWith('data:')) {
    return /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/.test(val);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(val)) {
    return false;
  }
  return isSafeLocalPathUrl(val, { requireLeadingSlash: false });
}

/**
 * Programmatically derives an administrative input/edit request validation schema from a base model schema.
 * Dynamically excludes system-generated metadata and sensitive identifiers (id, createdAt, updatedAt)
 * and makes remaining fields partial to support flexible creation and update payloads.
 */
export function deriveAdminInputSchema<T extends z.ZodRawShape>(
  baseSchema: z.ZodObject<T>,
  makePartial: boolean = true
) {
  const shape = baseSchema.shape;
  const omitKeys: any = {};
  if ('id' in shape) omitKeys.id = true;
  if ('createdAt' in shape) omitKeys.createdAt = true;
  if ('updatedAt' in shape) omitKeys.updatedAt = true;

  const omitted = baseSchema.omit(omitKeys);
  return makePartial ? omitted.partial() : omitted;
}
