import { z } from 'zod';
import {
  ACCEPTED_IMAGE_TYPES,
  ALLOWED_EXTENSIONS,
  FeatureSchema,
  GUEST_PHOTO_ACCEPTED_TYPES,
  GUEST_PHOTO_ALLOWED_EXTENSIONS,
  HEIC_EXTENSIONS,
  MAX_GUEST_PHOTO_SIZE,
  MAX_UPLOAD_SIZE,
  MIME_TO_EXTENSIONS,
  coordinateSchema,
  createLaxUrlSchema,
  decodeUrlPathSafely,
  deriveAdminInputSchema,
  formatZodError,
  getFileExtension,
  getNormalizedExtension,
  isHeicExtension,
  isSafeConfigAssetUrl,
  isSafeLocalPathUrl,
  isSafeMediaOrPhotoUrl,
  safeImageUrlSchema,
  safeUrlSchema,
  sanitizeUrl,
} from './validationPrimitives';

export {
  ACCEPTED_IMAGE_TYPES,
  ALLOWED_EXTENSIONS,
  GUEST_PHOTO_ACCEPTED_TYPES,
  GUEST_PHOTO_ALLOWED_EXTENSIONS,
  HEIC_EXTENSIONS,
  MAX_GUEST_PHOTO_SIZE,
  MAX_UPLOAD_SIZE,
  MIME_TO_EXTENSIONS,
  coordinateSchema,
  createLaxUrlSchema,
  decodeUrlPathSafely,
  deriveAdminInputSchema,
  formatZodError,
  getFileExtension,
  getNormalizedExtension,
  isHeicExtension,
  isSafeConfigAssetUrl,
  isSafeLocalPathUrl,
  isSafeMediaOrPhotoUrl,
  safeImageUrlSchema,
  safeUrlSchema,
  sanitizeUrl,
};

export const AdminLoginSchema = z.object({
  password: z.string({ message: 'Password is required' }).min(1, 'Password cannot be empty')
});

export const GuestLoginSchema = z.object({
  passcode: z.string({ message: 'Passcode is required' }).min(1, 'Passcode cannot be empty')
});

/**
 * Schema for guest self-service invitation lookup.
 * Note: Lookup route requires exact case-insensitive matching; partial substring queries are rejected with 404.
 */
export const GuestLookupSchema = z.object({
  query: z.string().trim().optional(),
  name: z.string().trim().optional(),
  email: z.string().trim().optional(),
}).superRefine((data, ctx) => {
  const query = data.query?.trim();
  const name = data.name?.trim();
  const email = data.email?.trim();

  if (!query && !name && !email) {
    ctx.addIssue({
      code: 'custom',
      message: 'Name or email is required.',
    });
    return;
  }

  if (email !== undefined && email !== '') {
    const emailResult = z.email().safeParse(email);
    if (!emailResult.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Invalid email format.',
      });
    }
  }

  if (name !== undefined && name !== '') {
    if (name.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'Name must be at least 2 characters.',
      });
    }
  }

  if (query !== undefined && query !== '') {
    if (query.includes('@')) {
      const emailResult = z.email().safeParse(query);
      if (!emailResult.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['query'],
          message: 'Invalid email format.',
        });
      }
    } else if (query.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Name must be at least 2 characters.',
      });
    }
  }
}).meta({
  description:
    'Guest self-service invitation lookup payload. Requires at least one of query (min 2 characters or valid email), name (min 2 characters), or email (valid email address).',
  anyOf: [
    {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2 },
      },
    },
    {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
      },
    },
    {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email', minLength: 3 },
      },
    },
  ],
});

export const SingleGuestPhotoSchema = z.any()
  .refine((val) => val !== null && val !== undefined, { message: 'No file provided' })
  .refine((file) => typeof file === 'object' && typeof file?.size === 'number' && file?.size <= MAX_GUEST_PHOTO_SIZE, { message: 'File size exceeds 10MB limit' })
  .refine((file) => {
    const ext = getFileExtension(file?.name);
    const mime = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
    if (isHeicExtension(ext) && (mime === '' || mime === 'application/octet-stream')) {
      return true;
    }
    return GUEST_PHOTO_ACCEPTED_TYPES.includes(mime);
  }, { message: 'Invalid file format. Only JPEG, PNG, WebP, and HEIC images are allowed' })
  .refine((file) => {
    const ext = getFileExtension(file?.name);
    return GUEST_PHOTO_ALLOWED_EXTENSIONS.includes(ext);
  }, { message: 'Invalid file extension. Only JPEG, PNG, WebP, and HEIC images are allowed' })
  .refine((file) => {
    const ext = getFileExtension(file?.name);
    const mime = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
    if (isHeicExtension(ext) && (mime === '' || mime === 'application/octet-stream')) {
      return true;
    }
    const allowedExts = MIME_TO_EXTENSIONS[mime] || [];
    return allowedExts.includes(ext);
  }, { message: 'File extension does not match the declared MIME type' });

function normalizeOptionalGuestText(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return raw;
}

export const GuestPhotoUploadSchema = z.preprocess(
  (val: any) => {
    if (!val) return { files: [] };
    if (Array.isArray(val)) return { files: val };
    if (typeof val === 'object') {
      const uploaderName = normalizeOptionalGuestText(val.uploaderName);
      const caption = normalizeOptionalGuestText(val.caption);
      const metadata = {
        ...(uploaderName !== undefined ? { uploaderName } : {}),
        ...(caption !== undefined ? { caption } : {}),
      };
      if (val.files !== undefined) {
        return {
          files: Array.isArray(val.files) ? val.files : (val.files ? [val.files] : []),
          ...metadata,
        };
      }
      if (val.file !== undefined) {
        return {
          files: val.file ? [val.file] : [],
          ...metadata,
        };
      }
      return {
        ...val,
        uploaderName,
        caption,
      };
    }
    return val;
  },
  z.object({
    files: z.array(SingleGuestPhotoSchema)
      .min(1, 'No file provided')
      .max(10, 'Maximum 10 photos allowed per upload'),
    uploaderName: z.string().trim().max(100, 'Uploader name must be 100 characters or fewer').optional(),
    caption: z.string().trim().max(500, 'Caption must be 500 characters or fewer').optional(),
  })
);

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

export const AdminEntityBatchUpdateSchema = z.object({
  ids: z.array(z.string().min(1, 'Record identifier cannot be empty')).min(1, 'At least one record identifier is required').max(100, 'Maximum of 100 record identifiers allowed per batch request'),
}).loose();

export const AdminEntityBatchDeleteSchema = z.object({
  ids: z.array(z.string().min(1, 'Record identifier cannot be empty')).min(1, 'At least one record identifier is required').max(100, 'Maximum of 100 record identifiers allowed per batch request'),
});

export const MediaExportSchema = z.object({
  ids: z.union([z.array(z.string()), z.string()]).optional(),
  tag: z.string().optional(),
  category: z.string().optional(),
  filename: z.string().optional(),
  preflight: z.union([z.boolean(), z.string()]).optional(),
});

export const AdminSetupSchema = z.object({
  password: z.string().optional(),
  sampleArchetype: z.enum(['classic', 'destination', 'romantic']).optional(),
  sampleModules: z.array(z.string()).optional(),
  partner1Name: z.string().optional(),
  partner2Name: z.string().optional(),
  brideName: z.string().optional(),
  groomName: z.string().optional(),
  weddingDate: z.string().optional(),
  baseUrl: z.string().optional(),
  contactEmail: z.string().optional(),
  venueName: z.string().optional(),
  venueAddress: z.string().optional(),
  venueCity: z.string().optional(),
  venueState: z.string().optional(),
  venueZip: z.string().optional(),
  latitude: z.union([z.number(), z.string()]).optional(),
  longitude: z.union([z.number(), z.string()]).optional(),
  storyText: z.string().optional(),
  venueDescription: z.string().optional(),
  travelAdvice: z.string().optional(),
  heroTitle: z.string().optional(),
  heroSubtitle: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  faviconUrl: z.string().optional(),
  ogImageUrl: z.string().optional(),
  brandMonogram: z.string().nullable().optional(),
  brandLogoUrl: z.string().nullable().optional(),
  brandLogoAlt: z.string().nullable().optional(),
  heroImageUrl: z.string().nullable().optional(),
  heroImageAlt: z.string().nullable().optional(),
  brandWatermarkUrl: z.string().nullable().optional(),
  brandWatermarkAlt: z.string().nullable().optional(),
  badgeGraphicUrl: z.string().nullable().optional(),
  badgeGraphicAlt: z.string().nullable().optional(),
  seoKeywords: z.string().optional(),
  colorPrimary: z.string().optional(),
  colorSecondary: z.string().optional(),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).optional(),
  themeTokens: z.record(z.string(), z.string()).optional(),
  layoutContainerMaxWidth: z.string().optional(),
  layoutGridGap: z.string().optional(),
  layoutCardPadding: z.string().optional(),
  layoutBorderRadius: z.string().optional(),
  timezone: z.string().optional(),
  showCountdown: z.boolean().optional(),
  showAddToCalendar: z.boolean().optional(),
  setupCompleted: z.boolean().optional(),
  subdomain: z.string().nullable().optional(),
}).meta({
  description:
    'First-run site setup and authenticated configuration payload. Requires either password (validated against ADMIN_PASSWORD_HASH or ADMIN_PASSWORD during step-1 setup authentication), setupCompleted (for authenticated wizard completion), or full site initialization fields (non-placeholder baseUrl plus partner1Name & partner2Name or legacy brideName & groomName; unauthenticated first-run requests must also include password).',
  anyOf: [
    {
      type: 'object',
      required: ['password'],
      properties: {
        password: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      required: ['setupCompleted'],
      properties: {
        setupCompleted: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      required: ['baseUrl', 'partner1Name', 'partner2Name'],
      properties: {
        baseUrl: { type: 'string', minLength: 1 },
        partner1Name: { type: 'string', minLength: 1 },
        partner2Name: { type: 'string', minLength: 1 },
      },
    },
    {
      type: 'object',
      required: ['baseUrl', 'brideName', 'groomName'],
      properties: {
        baseUrl: { type: 'string', minLength: 1 },
        brideName: { type: 'string', minLength: 1 },
        groomName: { type: 'string', minLength: 1 },
      },
    },
  ],
});

export const StripeWebhookEventSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  data: z.object({
    object: z.record(z.string(), z.any()),
  }).loose(),
}).loose();

export const AdminEntityReorderSchema = z.object({
  action: z.literal('reorder'),
  orderedIds: z.array(z.string())
});

export const ScrapeUrlSchema = z.object({
  url: z.url({
    abort: true,
    error: (issue) => typeof issue.input !== 'string' || issue.input.length === 0 ? 'URL is required' : 'Invalid URL format',
  }).min(1, 'URL is required')
});

export const UpdateFeaturesSchema = z.object({
  features: z.array(FeatureSchema)
});

export const ImportBackupSchema = z.object({
  version: z.string().optional(),
  schemaVersion: z.string().optional(),
  exportedAt: z.union([z.string(), z.date()]).optional(),
  appConfig: z.array(z.any()).optional(),
  contentNode: z.array(z.any()).optional(),
  media: z.array(z.any()).optional(),
  seatingTable: z.array(z.any()).optional(),
  invitationCode: z.array(z.any()).optional(),
  weddingPartyMember: z.array(z.any()).optional(),
  attraction: z.array(z.any()).optional(),
  registryItem: z.array(z.any()).optional(),
  contributor: z.array(z.any()).optional(),
  subEvent: z.array(z.any()).optional(),
  subEventAccess: z.array(z.any()).optional(),
  subEventRsvp: z.array(z.any()).optional(),
  broadcastMessage: z.array(z.any()).optional(),
  broadcastRecipient: z.array(z.any()).optional(),
  snapshotVersion: z.array(z.any()).optional(),
});
