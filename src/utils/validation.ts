import { z } from 'zod';

export function formatZodError(error: z.ZodError): string {
  return error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
}

export const coordinateSchema = z.union([z.number(), z.string()]).superRefine((val, ctx) => {
  if (typeof val === 'number') return;
  const parsed = parseFloat(val);
  if (!isNaN(parsed)) return;

  if (!/^[A-Z_]+$/.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid coordinate format. Must be a numeric value or a placeholder.',
    });
  }
}).transform((val) => {
  if (typeof val === 'number') return val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
});

export const AdminLoginSchema = z.object({
  password: z.string({ message: 'Password is required' }).min(1, 'Password cannot be empty')
});

export const GuestLoginSchema = z.object({
  passcode: z.string({ message: 'Passcode is required' }).min(1, 'Passcode cannot be empty')
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
  'image/x-icon': ['.ico'],
  'image/vnd.microsoft.icon': ['.ico'],
};

export const MIME_TO_NORMALIZED_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

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

export const AdminUploadSchema = z.object({
  file: z.any()
    .refine((val) => val !== null && val !== undefined, { message: 'No file provided' })
    .refine((file) => file?.size <= MAX_UPLOAD_SIZE, { message: 'File size exceeds 5MB limit' })
    .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file?.type), { message: 'Invalid file format. Only JPG, PNG, and ICO are supported' })
    .refine((file) => {
      const ext = getFileExtension(file?.name);
      return ALLOWED_EXTENSIONS.includes(ext);
    }, { message: 'Invalid file extension. Only JPG, PNG, and ICO are supported' })
    .refine((file) => {
      const ext = getFileExtension(file?.name);
      const allowedExts = MIME_TO_EXTENSIONS[file?.type] || [];
      return allowedExts.includes(ext);
    }, { message: 'File extension does not match the declared MIME type' })
});

export const AdminLogoutSchema = z.object({});

export const AdminEntityCreateSchema = z.record(z.string(), z.any());

export const AdminEntityUpdateSchema = z.record(z.string(), z.any());

export const AdminEntityReorderSchema = z.object({
  action: z.literal('reorder'),
  orderedIds: z.array(z.string())
});

export const ScrapeUrlSchema = z.object({
  url: z.string({ message: 'URL is required' }).min(1, 'URL is required').url('Invalid URL format')
});

export const UpdateFeaturesSchema = z.object({
  features: z.array(z.any())
});

export const ImportBackupSchema = z.object({
  appConfig: z.array(z.any()).optional(),
  contentNode: z.array(z.any()).optional(),
  media: z.array(z.any()).optional(),
  weddingPartyMember: z.array(z.any()).optional(),
  attraction: z.array(z.any()).optional(),
  registryItem: z.array(z.any()).optional(),
  contributor: z.array(z.any()).optional(),
});

/**
 * @internal
 */
export const createLaxUrlSchema = (fieldName = 'URL') =>
  z.string()
    .max(2000, `${fieldName} must be under 2000 characters`)
    .optional()
    .nullable()
    .or(z.literal(''));

export const safeUrlSchema = createLaxUrlSchema('URL');
export const safeImageUrlSchema = createLaxUrlSchema('Image URL');

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


