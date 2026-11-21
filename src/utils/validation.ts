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

const DISALLOWED_LOOKUP_TEXT_RE = /[<>]|\p{Cc}/u;

/**
 * Schema for guest self-service invitation lookup.
 * Requires both first and last names (at least two whitespace-separated tokens)
 * and supports optional email or postal/ZIP disambiguation when names collide.
 */
export const GuestLookupSchema = z.object({
  firstName: z.string().trim().max(80, 'First name must be 80 characters or fewer.').optional(),
  lastName: z.string().trim().max(80, 'Last name must be 80 characters or fewer.').optional(),
  query: z.string().trim().max(160, 'Name must be 160 characters or fewer.').optional(),
  name: z.string().trim().max(160, 'Name must be 160 characters or fewer.').optional(),
  email: z.string().trim().max(254, 'Email must be 254 characters or fewer.').optional(),
  zipCode: z.string().trim().max(20, 'ZIP or postal code must be 20 characters or fewer.').optional(),
}).superRefine((data, ctx) => {
  const firstName = data.firstName?.trim() || '';
  const lastName = data.lastName?.trim() || '';
  const rawName = data.name?.trim() || '';
  const rawQuery = data.query?.trim() || '';
  const email = data.email?.trim() || '';
  const zipCode = data.zipCode?.trim() || '';

  if (email) {
    const emailResult = z.email().safeParse(email);
    if (!emailResult.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Invalid email format.',
      });
      return;
    }
  }

  if (rawQuery.includes('@') && !firstName && !lastName && !rawName) {
    const queryEmailResult = z.email().safeParse(rawQuery);
    if (!queryEmailResult.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Invalid email format.',
      });
      return;
    }
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Please enter both your first and last name.',
    });
    return;
  }

  if (zipCode && (DISALLOWED_LOOKUP_TEXT_RE.test(zipCode) || !/^[A-Za-z0-9\s-]{2,20}$/.test(zipCode))) {
    ctx.addIssue({
      code: 'custom',
      path: ['zipCode'],
      message: 'Invalid ZIP or postal code format.',
    });
    return;
  }

  const hasStructuredInput = data.firstName !== undefined || data.lastName !== undefined;
  const combinedName = hasStructuredInput
    ? [firstName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    : (rawName || rawQuery).replace(/\s+/g, ' ').trim();

  if (!combinedName) {
    ctx.addIssue({
      code: 'custom',
      message: 'First and last name are required.',
    });
    return;
  }

  if (DISALLOWED_LOOKUP_TEXT_RE.test(combinedName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Name cannot contain HTML brackets or control characters.',
    });
    return;
  }

  if (combinedName.length < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Name must be at least 2 characters.',
    });
    return;
  }

  if (hasStructuredInput && (!firstName || !lastName)) {
    ctx.addIssue({
      code: 'custom',
      path: [!firstName ? 'firstName' : 'lastName'],
      message: 'Please enter both your first and last name.',
    });
    return;
  }

  const tokens = combinedName.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['name'],
      message: 'Please enter both your first and last name.',
    });
  }
});

export const GuestLookupAlertSchema = z.object({
  guestName: z
    .string({ message: 'Your full name is required.' })
    .refine((val) => !DISALLOWED_LOOKUP_TEXT_RE.test(val), {
      message: 'Name cannot contain HTML brackets or control characters.',
    })
    .trim()
    .min(2, 'Please enter your full name.')
    .max(120, 'Name must be 120 characters or fewer.'),
  guestEmail: z
    .string({ message: 'Your email address is required.' })
    .trim()
    .max(254, 'Email must be 254 characters or fewer.')
    .pipe(z.email('Please enter a valid email address.')),
  message: z
    .string()
    .refine((val) => !DISALLOWED_LOOKUP_TEXT_RE.test(val), {
      message: 'Message cannot contain HTML brackets or control characters.',
    })
    .trim()
    .max(500, 'Message must be 500 characters or fewer.')
    .optional()
    .or(z.literal('')),
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
  subdomain: z.string().nullable().optional(),
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
