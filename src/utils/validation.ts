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

export const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'];

export const AdminUploadSchema = z.object({
  file: z.any()
    .refine((val) => val !== null && val !== undefined, { message: 'No file provided' })
    .refine((file) => file?.size <= MAX_UPLOAD_SIZE, { message: 'File size exceeds 5MB limit' })
    .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file?.type), { message: 'Invalid file format. Only JPG, PNG, and ICO are supported' })
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
  weddingPartyMember: z.array(z.any()).optional(),
  attraction: z.array(z.any()).optional(),
  registryItem: z.array(z.any()).optional(),
  contributor: z.array(z.any()).optional(),
});

export const createLaxUrlSchema = (fieldName = 'URL') =>
  z.string()
    .max(2000, `${fieldName} must be under 2000 characters`)
    .optional()
    .nullable()
    .or(z.literal(''));

export const safeUrlSchema = createLaxUrlSchema('URL');
export const safeImageUrlSchema = createLaxUrlSchema('Image URL');

