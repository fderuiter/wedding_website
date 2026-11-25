import { z } from 'zod';
import {
  FeatureSchema,
  coordinateSchema,
  isAllowedSmtpPort,
  isSafeConfigAssetUrl,
  isSafeMediaOrPhotoUrl,
  safeUrlSchema,
} from '@/utils/validationPrimitives';
import {
  ModuleConfigSchema,
  resolveModuleConfig,
  DEFAULT_MODULE_CONFIG,
} from '@/lib/modules';
import { APP_CONFIG_SECRET_KEYS, hasNonEmptySecret } from '@/lib/backupPersistence';
import {
  isValidRsvpDeadlineDate,
  isValidRsvpGracePeriodHours,
  sanitizeRsvpClosedMessage,
} from '@/utils/rsvpDeadline';

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;
export const layoutTokenSchema = z
  .string()
  .refine((val) => val === '' || layoutTokenRegex.test(val), {
    message: 'Invalid CSS length unit format.',
  });

export const cssTokenKeyRegex = /^--[a-zA-Z0-9_-]+$/;

const DISALLOWED_CSS_FUNCTION_OR_AT_RULE_REGEX =
  /(?:^|[^a-zA-Z0-9_-])(?:url|expression)\s*\(|@import/i;

export function isSafeHttpBaseUrl(val: string): boolean {
  if (val === '') return true;
  if (
    val !== val.trim() ||
    val.includes('\0') ||
    !safeUrlSchema.safeParse(val).success
  ) {
    return false;
  }
  try {
    const parsed = new URL(val);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function isValidCssTokenValue(val: string): boolean {
  if (typeof val !== 'string') return false;
  // Disallow CSS code injection characters, escape backslashes, external resource loads, and legacy script expressions
  if (/[;{}<>\\\r\n]|\/\*|\*\//.test(val)) return false;
  if (DISALLOWED_CSS_FUNCTION_OR_AT_RULE_REGEX.test(val)) return false;
  return true;
}

export const ThemeTokensSchema = z
  .record(
    z
      .string()
      .regex(
        cssTokenKeyRegex,
        'Invalid CSS token identifier format. Must start with "--" and contain alphanumeric characters, hyphens, or underscores.',
      ),
    z.string().refine((val) => isValidCssTokenValue(val), {
      message: 'Invalid CSS token value or contains disallowed characters.',
    }),
  )
  .default({});

const fontTokenRegex = /^[a-zA-Z0-9_\-\s,'"\(\)]*$/;
export const fontTokenSchema = z
  .string()
  .regex(
    fontTokenRegex,
    'Invalid font token format. Must only contain safe font-family characters.',
  )
  .nullable()
  .optional();

export const TypographyScaleSchema = z.object({
  fontSizeXs: layoutTokenSchema.optional().default('0.75rem'),
  fontSizeSm: layoutTokenSchema.optional().default('0.875rem'),
  fontSizeBase: layoutTokenSchema.optional().default('1rem'),
  fontSizeLg: layoutTokenSchema.optional().default('1.125rem'),
  fontSizeXl: layoutTokenSchema.optional().default('1.25rem'),
  fontSize2xl: layoutTokenSchema.optional().default('1.5rem'),
  fontWeightNormal: z.string().optional().default('400'),
  fontWeightMedium: z.string().optional().default('500'),
  fontWeightBold: z.string().optional().default('700'),
  lineHeightTight: z.string().optional().default('1.25'),
  lineHeightNormal: z.string().optional().default('1.5'),
  lineHeightRelaxed: z.string().optional().default('1.75'),
});

export const SpacingScaleSchema = z.object({
  spacingXs: layoutTokenSchema.optional().default('0.25rem'),
  spacingSm: layoutTokenSchema.optional().default('0.5rem'),
  spacingMd: layoutTokenSchema.optional().default('1rem'),
  spacingLg: layoutTokenSchema.optional().default('1.5rem'),
  spacingXl: layoutTokenSchema.optional().default('2rem'),
  spacing2xl: layoutTokenSchema.optional().default('3rem'),
  containerMaxWidth: layoutTokenSchema.optional().default('64rem'),
  gridGap: layoutTokenSchema.optional().default('1.5rem'),
  cardPadding: layoutTokenSchema.optional().default('2rem'),
});

export const BorderTreatmentSchema = z.object({
  borderRadiusSm: layoutTokenSchema.optional().default('0.25rem'),
  borderRadiusMd: layoutTokenSchema.optional().default('0.5rem'),
  borderRadiusLg: layoutTokenSchema.optional().default('1rem'),
  borderRadiusFull: z.string().optional().default('9999px'),
  borderWidthThin: layoutTokenSchema.optional().default('1px'),
  borderWidthMedium: layoutTokenSchema.optional().default('2px'),
  borderWidthThick: layoutTokenSchema.optional().default('4px'),
  borderStyleDefault: z.string().optional().default('solid'),
});

export const BrandDimensionsSchema = z.object({
  logoWidth: layoutTokenSchema.optional().default('120px'),
  logoHeight: layoutTokenSchema.optional().default('40px'),
  heroHeight: layoutTokenSchema.optional().default('400px'),
  watermarkWidth: layoutTokenSchema.optional().default('200px'),
  watermarkOpacity: z.string().optional().default('0.1'),
  badgeSize: layoutTokenSchema.optional().default('48px'),
});

function validateHexColorFields(
  val: Record<string, unknown>,
  ctx: z.RefinementCtx,
) {
  for (const [key, value] of Object.entries(val)) {
    if (
      typeof key === 'string' &&
      key.toLowerCase().includes('color') &&
      typeof value === 'string' &&
      value !== ''
    ) {
      if (!hexColorRegex.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Invalid hex color format for ${key}. Must be a valid hex code (e.g. #RRGGBB).`,
        });
      }
    }
  }
}

const rawUpdateAppConfigBaseSchema = z.object({
  partner1Name: z.string().optional(),
  partner2Name: z.string().optional(),
  brideName: z.string().optional(),
  groomName: z.string().optional(),
  subdomain: z.string().nullable().optional(),
  weddingDate: z
    .union([z.string(), z.date()])
    .refine(
      (val) => {
        const d = new Date(val);
        return !isNaN(d.getTime());
      },
      { message: 'Invalid chronological date format.' },
    )
    .transform((val) => new Date(val)),
  baseUrl: z
    .string()
    .refine(isSafeHttpBaseUrl, { message: 'Invalid URL format' }),
  venueName: z.string(),
  venueAddress: z.string(),
  venueCity: z.string(),
  venueState: z.string(),
  venueZip: z.string(),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  storyText: z.string(),
  venueDescription: z.string(),
  travelAdvice: z.string(),
  heroTitle: z.string(),
  heroSubtitle: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  contactEmail: z
    .string()
    .refine((val) => !val || val === '' || z.email().safeParse(val).success, {
      message: 'Invalid email address format',
    })
    .optional(),
  photoAlbumUrl: z
    .string()
    .refine((val) => !val || isSafeHttpBaseUrl(val), {
      message: 'Invalid URL format',
    })
    .optional(),
  autoApproveGuestPhotos: z.boolean().optional(),
  faviconUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }),
  ogImageUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }),
  brandMonogram: z.string().nullable().optional(),
  brandLogoUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' })
    .nullable()
    .optional(),
  brandLogoAlt: z.string().nullable().optional(),
  heroImageUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' })
    .nullable()
    .optional(),
  heroImageAlt: z.string().nullable().optional(),
  brandWatermarkUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' })
    .nullable()
    .optional(),
  brandWatermarkAlt: z.string().nullable().optional(),
  badgeGraphicUrl: z
    .string()
    .refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' })
    .nullable()
    .optional(),
  badgeGraphicAlt: z.string().nullable().optional(),
  seoKeywords: z.string(),
  colorPrimary: z.string().regex(hexColorRegex).optional(),
  colorSecondary: z.string().regex(hexColorRegex).optional(),
  themePreset: z
    .enum(['classic', 'modern', 'romantic', 'minimal', 'editorial'])
    .default('classic'),
  themeTokens: ThemeTokensSchema.optional().default({}),
  layoutContainerMaxWidth: layoutTokenSchema.optional(),
  layoutGridGap: layoutTokenSchema.optional(),
  layoutCardPadding: layoutTokenSchema.optional(),
  layoutBorderRadius: layoutTokenSchema.optional(),
  fontHeading: fontTokenSchema,
  fontBody: fontTokenSchema,
  fontMono: fontTokenSchema,
  showCountdown: z.boolean().optional(),
  showAddToCalendar: z.boolean().optional(),
  rsvpOpen: z.boolean().optional(),
  rsvpDeadlineDate: z
    .union([z.string(), z.null()])
    .refine(
      (val) =>
        val === null ||
        val.trim() === '' ||
        isValidRsvpDeadlineDate(val.trim()),
      { message: 'Invalid RSVP deadline date. Expected YYYY-MM-DD.' },
    )
    .transform((val) => (val === null ? '' : val.trim()))
    .optional(),
  rsvpGracePeriodHours: z
    .union([
      z.number(),
      z
        .string()
        .refine((v) => /^\d+$/.test(v.trim()), {
          message: 'Grace period must be 0, 12, 24, 48, 72, or 168 hours.',
        })
        .transform((v) => parseInt(v.trim(), 10)),
    ])
    .refine((val) => isValidRsvpGracePeriodHours(val), {
      message: 'Grace period must be 0, 12, 24, 48, 72, or 168 hours.',
    })
    .optional(),
  rsvpClosedMessage: z
    .union([z.string(), z.null()])
    .transform((val) => sanitizeRsvpClosedMessage(val))
    .optional(),
  emailProvider: z.string().optional().default('smtp'),
  smtpHost: z.string().nullable().optional().default(''),
  smtpPort: z
    .union([
      z.number(),
      z
        .string()
        .refine((v) => /^\d+$/.test(v.trim()), {
          message: 'SMTP port must be 25, 465, 587, or 2525.',
        })
        .transform((v) => parseInt(v.trim(), 10)),
    ])
    .refine((val) => isAllowedSmtpPort(val), {
      message: 'SMTP port must be 25, 465, 587, or 2525.',
    })
    .nullable()
    .optional()
    .default(587),
  smtpUser: z.string().nullable().optional().default(''),
  smtpPass: z.string().nullable().optional().default(''),
  smtpFrom: z.string().nullable().optional().default(''),
  smtpSecure: z.boolean().nullable().optional().default(false),
  resendApiKey: z.string().nullable().optional().default(''),
  resendFrom: z.string().nullable().optional().default(''),
  sendgridApiKey: z.string().nullable().optional().default(''),
  sendgridFrom: z.string().nullable().optional().default(''),
  smsProvider: z.string().nullable().optional().default('none'),
  twilioAccountSid: z.string().nullable().optional().default(''),
  twilioAuthToken: z.string().nullable().optional().default(''),
  twilioFromNumber: z.string().nullable().optional().default(''),
  broadcastBatchSize: z
    .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
    .optional()
    .default(50),
  broadcastBatchDelayMs: z
    .union([z.number(), z.string().transform((v) => parseInt(v, 10))])
    .optional()
    .default(500),
  shippingRecipientName: z
    .string()
    .trim()
    .max(255, 'Shipping recipient name must be under 255 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingAddressLine1: z
    .string()
    .trim()
    .max(255, 'Shipping street address must be under 255 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingAddressLine2: z
    .string()
    .trim()
    .max(255, 'Shipping address line 2 must be under 255 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingCity: z
    .string()
    .trim()
    .max(120, 'Shipping city must be under 120 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingState: z
    .string()
    .trim()
    .max(120, 'Shipping state/province must be under 120 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingZip: z
    .string()
    .trim()
    .max(40, 'Shipping postal code must be under 40 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingCountry: z
    .string()
    .trim()
    .max(120, 'Shipping country must be under 120 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingPhone: z
    .string()
    .trim()
    .max(60, 'Shipping phone number must be under 60 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  shippingDeliveryNotes: z
    .string()
    .trim()
    .max(1000, 'Shipping delivery notes must be under 1000 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  defaultPaymentHandleType: z
    .string()
    .trim()
    .max(100, 'Default payment service must be under 100 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  defaultPaymentHandle: z
    .string()
    .trim()
    .max(255, 'Default payment handle must be under 255 characters.')
    .nullable()
    .transform((val) => val ?? '')
    .optional(),
  registryGiftAccessTier: z
    .enum(['PASSCODE_GUESTS', 'INVITED_HOUSEHOLDS'])
    .optional(),
  shippingDisclosureTier: z
    .enum(['PASSCODE_GUESTS', 'INVITED_HOUSEHOLDS', 'POST_CLAIM_ONLY'])
    .optional(),
  maxPendingReservations: z
    .union([
      z.number(),
      z
        .string()
        .trim()
        .min(1, 'Maximum pending reservations must be between 1 and 100.')
        .transform((v) => Number(v)),
    ])
    .pipe(
      z
        .number({ message: 'Maximum pending reservations must be a valid integer.' })
        .int('Maximum pending reservations must be a whole number.')
        .min(1, 'Maximum pending reservations must be at least 1.')
        .max(100, 'Maximum pending reservations cannot exceed 100.'),
    )
    .optional(),
  setupCompleted: z.boolean().optional(),
  modules: ModuleConfigSchema.partial().optional(),
  timezone: z
    .string()
    .refine(
      (val) => {
        if (val === 'UTC' || val === 'GMT') return true;
        try {
          return Intl.supportedValuesOf('timeZone').includes(val);
        } catch {
          return false;
        }
      },
      { message: 'Invalid standard IANA timezone identifier.' },
    )
    .optional(),
});

export const RawUpdateAppConfigSchema = rawUpdateAppConfigBaseSchema
  .catchall(z.any())
  .superRefine(validateHexColorFields);

export const CreateAppConfigProfileSchema = rawUpdateAppConfigBaseSchema
  .partial()
  .extend({
    id: z.string().min(1).optional(),
  })
  .catchall(z.any())
  .superRefine(validateHexColorFields)
  .transform((data) => {
    const partner1Name = data.partner1Name || data.brideName || 'Partner 1';
    const partner2Name = data.partner2Name || data.groomName || 'Partner 2';
    return {
      ...data,
      partner1Name,
      partner2Name,
      brideName: partner1Name,
      groomName: partner2Name,
      weddingDate: data.weddingDate ?? new Date(),
      baseUrl: data.baseUrl ?? '',
      venueName: data.venueName ?? 'TBD Venue',
      venueAddress: data.venueAddress ?? '',
      venueCity: data.venueCity ?? '',
      venueState: data.venueState ?? '',
      venueZip: data.venueZip ?? '',
      latitude: data.latitude ?? 0,
      longitude: data.longitude ?? 0,
      storyText: data.storyText ?? '',
      venueDescription: data.venueDescription ?? '',
      travelAdvice: data.travelAdvice ?? '',
      heroTitle: data.heroTitle ?? '',
      heroSubtitle: data.heroSubtitle ?? '',
      seoTitle: data.seoTitle ?? '',
      seoDescription: data.seoDescription ?? '',
      contactEmail: data.contactEmail ?? '',
      photoAlbumUrl: data.photoAlbumUrl ?? '',
      faviconUrl: data.faviconUrl ?? '/assets/favicon.png',
      ogImageUrl: data.ogImageUrl ?? '/images/placeholder.png',
      seoKeywords: data.seoKeywords ?? '',
      colorPrimary: data.colorPrimary ?? '#B91C1C',
      colorSecondary: data.colorSecondary ?? '#B45309',
      themePreset: data.themePreset ?? 'classic',
      themeTokens: data.themeTokens ?? {},
      layoutContainerMaxWidth:
        !data.layoutContainerMaxWidth || data.layoutContainerMaxWidth === ''
          ? '64rem'
          : data.layoutContainerMaxWidth,
      layoutGridGap:
        !data.layoutGridGap || data.layoutGridGap === ''
          ? '1.5rem'
          : data.layoutGridGap,
      layoutCardPadding:
        !data.layoutCardPadding || data.layoutCardPadding === ''
          ? '2rem'
          : data.layoutCardPadding,
      layoutBorderRadius:
        !data.layoutBorderRadius || data.layoutBorderRadius === ''
          ? '1rem'
          : data.layoutBorderRadius,
      timezone: data.timezone ?? 'UTC',
      showCountdown:
        typeof data.modules?.countdown === 'boolean'
          ? data.modules.countdown
          : (data.showCountdown ?? true),
      showAddToCalendar:
        typeof data.modules?.addToCalendar === 'boolean'
          ? data.modules.addToCalendar
          : (data.showAddToCalendar ?? true),
      modules: resolveModuleConfig({
        ...(data.showCountdown !== undefined
          ? { countdown: data.showCountdown }
          : {}),
        ...(data.showAddToCalendar !== undefined
          ? { addToCalendar: data.showAddToCalendar }
          : {}),
        ...(data.modules ?? {}),
      }),
      emailProvider: data.emailProvider ?? 'smtp',
      smtpHost: data.smtpHost ?? '',
      smtpPort: data.smtpPort ?? 587,
      smtpUser: data.smtpUser ?? '',
      smtpPass: data.smtpPass ?? '',
      smtpFrom: data.smtpFrom ?? '',
      smtpSecure: data.smtpSecure ?? false,
      resendApiKey: data.resendApiKey ?? '',
      resendFrom: data.resendFrom ?? '',
      sendgridApiKey: data.sendgridApiKey ?? '',
      sendgridFrom: data.sendgridFrom ?? '',
      smsProvider: data.smsProvider ?? 'none',
      twilioAccountSid: data.twilioAccountSid ?? '',
      twilioAuthToken: data.twilioAuthToken ?? '',
      twilioFromNumber: data.twilioFromNumber ?? '',
      broadcastBatchSize: data.broadcastBatchSize ?? 50,
      broadcastBatchDelayMs: data.broadcastBatchDelayMs ?? 500,
      shippingRecipientName: data.shippingRecipientName ?? '',
      shippingAddressLine1: data.shippingAddressLine1 ?? '',
      shippingAddressLine2: data.shippingAddressLine2 ?? '',
      shippingCity: data.shippingCity ?? '',
      shippingState: data.shippingState ?? '',
      shippingZip: data.shippingZip ?? '',
      shippingCountry: data.shippingCountry ?? '',
      shippingPhone: data.shippingPhone ?? '',
      shippingDeliveryNotes: data.shippingDeliveryNotes ?? '',
      defaultPaymentHandleType: data.defaultPaymentHandleType ?? '',
      defaultPaymentHandle: data.defaultPaymentHandle ?? '',
      registryGiftAccessTier: data.registryGiftAccessTier ?? 'PASSCODE_GUESTS',
      shippingDisclosureTier: data.shippingDisclosureTier ?? 'PASSCODE_GUESTS',
      maxPendingReservations: data.maxPendingReservations ?? 5,
      autoApproveGuestPhotos: data.autoApproveGuestPhotos ?? false,
      setupCompleted: data.setupCompleted ?? true,
      subdomain: data.subdomain || null,
    };
  });

export const UpdateAppConfigSchema = RawUpdateAppConfigSchema.transform(
  (data) => {
    const partner1Name = data.partner1Name || data.brideName || '';
    const partner2Name = data.partner2Name || data.groomName || '';
    const hasCountdownModule = typeof data.modules?.countdown === 'boolean';
    const hasAddToCalendarModule =
      typeof data.modules?.addToCalendar === 'boolean';
    const syncedShowCountdown = hasCountdownModule
      ? data.modules!.countdown
      : data.showCountdown;
    const syncedShowAddToCalendar = hasAddToCalendarModule
      ? data.modules!.addToCalendar
      : data.showAddToCalendar;
    return {
      ...data,
      partner1Name,
      partner2Name,
      brideName: partner1Name,
      groomName: partner2Name,
      showCountdown: syncedShowCountdown,
      showAddToCalendar: syncedShowAddToCalendar,
      layoutContainerMaxWidth:
        !data.layoutContainerMaxWidth || data.layoutContainerMaxWidth === ''
          ? '64rem'
          : data.layoutContainerMaxWidth,
      layoutGridGap:
        !data.layoutGridGap || data.layoutGridGap === ''
          ? '1.5rem'
          : data.layoutGridGap,
      layoutCardPadding:
        !data.layoutCardPadding || data.layoutCardPadding === ''
          ? '2rem'
          : data.layoutCardPadding,
      layoutBorderRadius:
        !data.layoutBorderRadius || data.layoutBorderRadius === ''
          ? '1rem'
          : data.layoutBorderRadius,
    };
  },
);

/**
 * Map validated configuration data into the standard database payload structure for Prisma AppConfig operations.
 *
 * @param data - The validated data output from UpdateAppConfigSchema.
 * @returns Object formatted for Prisma appConfig create, update, and upsert operations.
 */
export function toAppConfigDbPayload(
  data: z.infer<typeof UpdateAppConfigSchema>,
) {
  const hasCountdownModule = typeof data.modules?.countdown === 'boolean';
  const hasAddToCalendarModule =
    typeof data.modules?.addToCalendar === 'boolean';
  const resolvedModules = resolveModuleConfig({
    ...(data.showCountdown !== undefined
      ? { countdown: data.showCountdown }
      : {}),
    ...(data.showAddToCalendar !== undefined
      ? { addToCalendar: data.showAddToCalendar }
      : {}),
    ...(data.modules ?? {}),
  });
  const resolvedShowCountdown = hasCountdownModule
    ? resolvedModules.countdown
    : data.showCountdown;
  const resolvedShowAddToCalendar = hasAddToCalendarModule
    ? resolvedModules.addToCalendar
    : data.showAddToCalendar;

  return {
    partner1Name: data.partner1Name,
    partner2Name: data.partner2Name,
    brideName: data.brideName,
    groomName: data.groomName,
    subdomain: data.subdomain || null,
    weddingDate: data.weddingDate,
    baseUrl: data.baseUrl,
    venueName: data.venueName,
    venueAddress: data.venueAddress,
    venueCity: data.venueCity,
    venueState: data.venueState,
    venueZip: data.venueZip,
    latitude: data.latitude,
    longitude: data.longitude,
    storyText: data.storyText,
    venueDescription: data.venueDescription,
    travelAdvice: data.travelAdvice,
    heroTitle: data.heroTitle,
    heroSubtitle: data.heroSubtitle,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
    contactEmail: data.contactEmail,
    photoAlbumUrl: data.photoAlbumUrl ?? '',
    ...(typeof data.autoApproveGuestPhotos === 'boolean'
      ? { autoApproveGuestPhotos: data.autoApproveGuestPhotos }
      : {}),
    faviconUrl: data.faviconUrl,
    ogImageUrl: data.ogImageUrl,
    brandMonogram: data.brandMonogram,
    brandLogoUrl: data.brandLogoUrl,
    brandLogoAlt: data.brandLogoAlt,
    heroImageUrl: data.heroImageUrl,
    heroImageAlt: data.heroImageAlt,
    brandWatermarkUrl: data.brandWatermarkUrl,
    brandWatermarkAlt: data.brandWatermarkAlt,
    badgeGraphicUrl: data.badgeGraphicUrl,
    badgeGraphicAlt: data.badgeGraphicAlt,
    seoKeywords: data.seoKeywords,
    colorPrimary: data.colorPrimary,
    colorSecondary: data.colorSecondary,
    themePreset: data.themePreset,
    themeTokens: data.themeTokens,
    layoutContainerMaxWidth: data.layoutContainerMaxWidth,
    layoutGridGap: data.layoutGridGap,
    layoutCardPadding: data.layoutCardPadding,
    layoutBorderRadius: data.layoutBorderRadius,
    modules: resolvedModules,
    timezone: data.timezone,
    showCountdown: resolvedShowCountdown,
    showAddToCalendar: resolvedShowAddToCalendar,
    rsvpOpen: data.rsvpOpen,
    rsvpDeadlineDate: data.rsvpDeadlineDate,
    rsvpGracePeriodHours: data.rsvpGracePeriodHours,
    rsvpClosedMessage: data.rsvpClosedMessage,
    emailProvider: data.emailProvider ?? 'smtp',
    smtpHost: data.smtpHost ?? '',
    smtpPort: data.smtpPort ?? 587,
    smtpUser: data.smtpUser ?? '',
    smtpPass: data.smtpPass ?? '',
    smtpFrom: data.smtpFrom ?? '',
    smtpSecure: data.smtpSecure ?? false,
    resendApiKey: data.resendApiKey ?? '',
    resendFrom: data.resendFrom ?? '',
    sendgridApiKey: data.sendgridApiKey ?? '',
    sendgridFrom: data.sendgridFrom ?? '',
    smsProvider: data.smsProvider ?? 'none',
    twilioAccountSid: data.twilioAccountSid ?? '',
    twilioAuthToken: data.twilioAuthToken ?? '',
    twilioFromNumber: data.twilioFromNumber ?? '',
    broadcastBatchSize: data.broadcastBatchSize ?? 50,
    broadcastBatchDelayMs: data.broadcastBatchDelayMs ?? 500,
    shippingRecipientName: data.shippingRecipientName,
    shippingAddressLine1: data.shippingAddressLine1,
    shippingAddressLine2: data.shippingAddressLine2,
    shippingCity: data.shippingCity,
    shippingState: data.shippingState,
    shippingZip: data.shippingZip,
    shippingCountry: data.shippingCountry,
    shippingPhone: data.shippingPhone,
    shippingDeliveryNotes: data.shippingDeliveryNotes,
    defaultPaymentHandleType: data.defaultPaymentHandleType,
    defaultPaymentHandle: data.defaultPaymentHandle,
    ...(data.registryGiftAccessTier !== undefined
      ? { registryGiftAccessTier: data.registryGiftAccessTier }
      : {}),
    ...(data.shippingDisclosureTier !== undefined
      ? { shippingDisclosureTier: data.shippingDisclosureTier }
      : {}),
    ...(typeof data.maxPendingReservations === 'number'
      ? { maxPendingReservations: data.maxPendingReservations }
      : {}),
    ...(typeof data.setupCompleted === 'boolean' ? { setupCompleted: data.setupCompleted } : {}),
  };
}

const BaseContentNode = z.object({
  id: z.string(),
  tags: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const isoTimestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const CategoryColorSchema = z.object({
  bg: z.string().optional(),
  text: z.string().optional(),
  border: z.string().optional(),
  accent: z.string().optional(),
  color: z.string().optional(),
});

const CategoryTagItemSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    bg: z.string().optional(),
    text: z.string().optional(),
    border: z.string().optional(),
    accent: z.string().optional(),
    color: z.string().optional(),
  }),
]);

export const ScheduleDataSchema = z
  .object({
    title: z.string().optional(),
    startTime: z
      .string()
      .nullish()
      .refine(
        (val) =>
          !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
        {
          message:
            'startTime must be a valid ISO timestamp format (e.g., YYYY-MM-DDTHH:mm:ssZ).',
        },
      )
      .optional(),
    endTime: z
      .string()
      .nullish()
      .refine(
        (val) =>
          !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
        {
          message:
            'endTime must be a valid ISO timestamp format (e.g., YYYY-MM-DDTHH:mm:ssZ).',
        },
      )
      .optional(),
    categoryColors: z.record(z.string(), CategoryColorSchema).optional(),
    categoryTags: z.array(CategoryTagItemSchema).optional().default([]),
    category: z.string().optional(),
    locationName: z.string().optional(),
    location: z.string().optional(),
    attireRules: z.string().optional(),
    attire: z.string().optional(),
    description: z.string().optional(),
  })
  .loose()
  .transform((data) => {
    const extractedColors: Record<
      string,
      z.infer<typeof CategoryColorSchema>
    > = {
      ...(data.categoryColors || {}),
    };
    const normalizedTags: string[] = [];

    if (Array.isArray(data.categoryTags)) {
      for (const tagItem of data.categoryTags) {
        if (typeof tagItem === 'string') {
          normalizedTags.push(tagItem);
        } else if (tagItem && typeof tagItem === 'object' && tagItem.name) {
          normalizedTags.push(tagItem.name);
          const { name, ...colorAttrs } = tagItem;
          extractedColors[name] = {
            ...extractedColors[name],
            ...colorAttrs,
          };
        }
      }
    }

    return {
      ...data,
      categoryTags: normalizedTags,
      categoryColors:
        Object.keys(extractedColors).length > 0
          ? extractedColors
          : data.categoryColors,
    };
  })
  .superRefine((val, ctx) => {
    if (val.startTime && val.endTime) {
      const start = new Date(val.startTime).getTime();
      const end = new Date(val.endTime).getTime();
      if (!isNaN(start) && !isNaN(end) && end < start) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message:
            'endTime must be chronologically equal to or after startTime.',
        });
      }
    }
  });

export const ScheduleNodeSchema = BaseContentNode.extend({
  type: z.literal('Schedule'),
  data: ScheduleDataSchema,
});

export const FAQNodeSchema = BaseContentNode.extend({
  type: z.literal('FAQ'),
  data: z
    .object({
      question: z.string().optional(),
      answer: z.string().optional(),
      category: z.string().optional(),
      categoryTags: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .transform((val) => {
          if (typeof val === 'string') {
            return val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
          return val;
        }),
      keywords: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .transform((val) => {
          if (typeof val === 'string') {
            return val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
          return val;
        }),
      displayOrder: z.number().int().min(0).optional(),
      isVisible: z.boolean().optional(),
      isSample: z.boolean().optional(),
    })
    .loose(),
});

export const LogisticsNodeSchema = BaseContentNode.extend({
  type: z.literal('Logistics'),
  data: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      ceremonyTitle: z.string().optional(),
      ceremonyTime: z.string().optional(),
      receptionTitle: z.string().optional(),
      receptionTime: z.string().optional(),
      receptionDetails: z.string().optional(),
      receptionAttire: z.string().optional(),
      startTime: z
        .string()
        .nullish()
        .refine(
          (val) =>
            !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
          { message: 'startTime must be a valid ISO timestamp.' },
        )
        .optional(),
      endTime: z
        .string()
        .nullish()
        .refine(
          (val) =>
            !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
          { message: 'endTime must be a valid ISO timestamp.' },
        )
        .optional(),
      categoryTags: z.array(z.string()).optional(),
      category: z.string().optional(),
      locationName: z.string().optional(),
      location: z.string().optional(),
      attireRules: z.string().optional(),
      attire: z.string().optional(),
    })
    .loose(),
});

export const PhotoDataSchema = z
  .object({
    url: z
      .string()
      .refine(isSafeMediaOrPhotoUrl, { message: 'Invalid photo URL format' })
      .optional(),
    title: z.string().optional(),
    altText: z.string().optional(),
    uploaderName: z.string().optional(),
    caption: z.string().optional(),
    originalFilename: z.string().optional(),
    status: z
      .enum(['PENDING', 'APPROVED', 'REJECTED'])
      .optional()
      .default('PENDING'),
    isVisible: z.boolean().optional().default(false),
    mediaId: z.string().optional(),
    publishToGallery: z.boolean().optional(),
  })
  .loose();

export const PhotoModerationSchema = z.object({
  id: z.string().optional(),
  nodeId: z.string().optional(),
  photoId: z.string().optional(),
  action: z.enum(['approve', 'reject', 'APPROVE', 'REJECT']).optional(),
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
  caption: z.string().max(500, 'Caption must be 500 characters or fewer').optional(),
  uploaderName: z.string().max(100, 'Uploader name must be 100 characters or fewer').optional(),
}).superRefine((data, ctx) => {
  if (!data.action && !data.status) {
    ctx.addIssue({
      code: 'custom',
      path: ['action'],
      message: "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required",
    });
  }
}).meta({
  description:
    "Single-photo moderation decision when the target photo ID is supplied in the URL path. Requires either action ('approve' | 'reject') or status ('APPROVED' | 'REJECTED').",
  anyOf: [
    { type: 'object', required: ['action'] },
    { type: 'object', required: ['status'] },
  ],
});

export const AdminPhotoQrUpdateSchema = z
  .object({
    action: z.enum(['rotate']).optional(),
    autoApproveGuestPhotos: z.boolean().optional(),
  })
  .refine(
    (data) => data.action === 'rotate' || typeof data.autoApproveGuestPhotos === 'boolean',
    { message: 'Provide action: "rotate" and/or a boolean autoApproveGuestPhotos flag.' }
  )
  .meta({
    description:
      'Admin guest photo QR settings update payload. Requires action ("rotate") and/or a boolean autoApproveGuestPhotos flag.',
    anyOf: [
      { type: 'object', required: ['action'] },
      { type: 'object', required: ['autoApproveGuestPhotos'] },
    ],
  });

export const QueuePhotoModerationSchema = z.object({
  id: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  photoId: z.string().min(1).optional(),
  action: z.enum(['approve', 'reject', 'APPROVE', 'REJECT']).optional(),
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
  caption: z.string().max(500, 'Caption must be 500 characters or fewer').optional(),
  uploaderName: z.string().max(100, 'Uploader name must be 100 characters or fewer').optional(),
}).superRefine((data, ctx) => {
  if (!data.id && !data.nodeId && !data.photoId) {
    ctx.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Photo ID (id or nodeId) is required',
    });
  }
  if (!data.action && !data.status) {
    ctx.addIssue({
      code: 'custom',
      path: ['action'],
      message: "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required",
    });
  }
}).meta({
  description:
    'Single-photo moderation payload for the moderation queue endpoint. Requires a target photo identifier (id, nodeId, or photoId) and a moderation decision (action or status).',
  allOf: [
    {
      anyOf: [
        { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
        { type: 'object', required: ['nodeId'], properties: { nodeId: { type: 'string', minLength: 1 } } },
        { type: 'object', required: ['photoId'], properties: { photoId: { type: 'string', minLength: 1 } } },
      ],
    },
    {
      anyOf: [
        { type: 'object', required: ['action'] },
        { type: 'object', required: ['status'] },
      ],
    },
  ],
});

export const BatchPhotoModerationSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    photoIds: z.array(z.string()).optional(),
    nodeIds: z.array(z.string()).optional(),
    action: z.enum(['approve', 'reject', 'APPROVE', 'REJECT']).optional(),
    status: z.enum(['APPROVED', 'REJECTED']).optional(),
    pendingEdits: z
      .record(
        z.string(),
        z.object({
          caption: z.string().max(500).optional(),
          uploaderName: z.string().max(100).optional(),
        }),
      )
      .optional(),
  })
  .loose()
  .superRefine((data, ctx) => {
    const idsList = data.ids || data.photoIds || data.nodeIds;
    if (!idsList || !Array.isArray(idsList) || idsList.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message:
          'At least one photo ID (ids, photoIds, or nodeIds) is required',
      });
    } else if (idsList.length > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'Maximum of 100 photos allowed per batch request',
      });
    }
    if (!data.action && !data.status) {
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message:
          "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required",
      });
    }
  })
  .meta({
    description:
      'Batch photo moderation payload requiring between 1 and 100 photo identifiers (in ids, photoIds, or nodeIds) and a moderation decision (action or status).',
    allOf: [
      {
        anyOf: [
          {
            type: 'object',
            required: ['ids'],
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                minItems: 1,
                maxItems: 100,
              },
            },
          },
          {
            type: 'object',
            required: ['photoIds'],
            properties: {
              photoIds: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                minItems: 1,
                maxItems: 100,
              },
            },
          },
          {
            type: 'object',
            required: ['nodeIds'],
            properties: {
              nodeIds: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                minItems: 1,
                maxItems: 100,
              },
            },
          },
        ],
      },
      {
        anyOf: [
          { type: 'object', required: ['action'] },
          { type: 'object', required: ['status'] },
        ],
      },
    ],
  });

export const PhotoNodeSchema = BaseContentNode.extend({
  type: z.literal('Photo'),
  data: PhotoDataSchema,
});

const TYPED_CONTENT_NODE_TYPES = new Set([
  'FAQ',
  'Logistics',
  'Schedule',
  'Photo',
]);

export const GenericNodeSchema = BaseContentNode.extend({
  type: z.string().refine((val) => !TYPED_CONTENT_NODE_TYPES.has(val), {
    message: 'Known content node types must conform to their specific schema.',
  }),
  data: z.record(z.string(), z.unknown()),
});

export const ContentNodeSchema = z.union([
  FAQNodeSchema,
  LogisticsNodeSchema,
  ScheduleNodeSchema,
  PhotoNodeSchema,
  GenericNodeSchema,
]);

export const ContentNodeInputSchema = z.union([
  FAQNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  LogisticsNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  ScheduleNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  PhotoNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  GenericNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }),
]);

export const ContentNodeUpdateInputSchema = z.union([
  FAQNodeSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial(),
  LogisticsNodeSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  }).partial(),
  ScheduleNodeSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  }).partial(),
  PhotoNodeSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  }).partial(),
  GenericNodeSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  }).partial(),
]);

export type ContentNodeDTO = z.infer<typeof ContentNodeSchema>;

export { FeatureSchema };

/**
 * Evaluates whether a ContentNode record is marked private via `data.isPrivate`.
 * Treats boolean `true` and case-insensitive `'true'` strings (such as dynamic
 * string fields serialized by the Admin Content Hub) as private, while keeping
 * `false`, `'false'`, and missing values public.
 */
export function isPrivateContentNode(
  node: { data?: unknown } | null | undefined,
): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const data = node.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const rawIsPrivate = (data as Record<string, unknown>).isPrivate;
  if (typeof rawIsPrivate === 'boolean') {
    return rawIsPrivate;
  }
  if (typeof rawIsPrivate === 'string') {
    return rawIsPrivate.trim().toLowerCase() === 'true';
  }
  return false;
}

/**
 * Evaluates whether an FAQ ContentNode (or FAQ data wrapper) is publicly visible.
 * Defaults to `true` when `data.isVisible` is omitted for backward compatibility,
 * and returns `false` when private (`isPrivateContentNode`) or when `data.isVisible`
 * is `false` or `'false'`.
 */
export function isFaqNodeVisible(
  node: { data?: unknown } | null | undefined
): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  if (isPrivateContentNode(node)) {
    return false;
  }
  const data = node.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return true;
  }
  const rawIsVisible = (data as Record<string, unknown>).isVisible;
  if (typeof rawIsVisible === 'boolean') {
    return rawIsVisible;
  }
  if (typeof rawIsVisible === 'string') {
    return rawIsVisible.trim().toLowerCase() !== 'false';
  }
  return true;
}

/**
 * Compares two FAQ ContentNodes by `data.displayOrder` ascending, falling back
 * to `createdAt` ascending when `displayOrder` is omitted or equal.
 */
export function compareFaqNodesByOrder(
  a: { data?: unknown; createdAt?: Date | string | null },
  b: { data?: unknown; createdAt?: Date | string | null }
): number {
  const getOrder = (item: { data?: unknown }): number => {
    const d = item.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return Infinity;
    }
    const rawOrder = (d as Record<string, unknown>).displayOrder;
    if (typeof rawOrder === 'number' && Number.isFinite(rawOrder)) {
      return rawOrder;
    }
    if (typeof rawOrder === 'string' && rawOrder.trim() !== '') {
      const parsed = Number(rawOrder);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return Infinity;
  };

  const orderA = getOrder(a);
  const orderB = getOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  const safeA = Number.isFinite(createdA) ? createdA : 0;
  const safeB = Number.isFinite(createdB) ? createdB : 0;
  return safeA - safeB;
}

export const AppConfigSchema = z.object({
  id: z.string().describe('Unique configuration profile identifier (defaults to "global" in single-site deployments).'),
  subdomain: z.string().nullable().optional().describe('Optional subdomain slug for AppConfig branding/profile routing when MULTISITE_ENABLED is active (the other 14 Prisma tables remain shared).'),
  multisiteEnabled: z.boolean().optional().describe('Runtime flag resolved from MULTISITE_ENABLED indicating whether subdomain AppConfig profile routing is active (14 other Prisma tables are shared).'),
  partner1Name: z.string().default('').describe('Primary display name for the first partner across headings, metadata, and monograms.'),
  partner2Name: z.string().default('').describe('Primary display name for the second partner across headings, metadata, and monograms.'),
  brideName: z.string().nullable().optional().describe('Legacy optional alias for the first partner name retained for backward compatibility.'),
  groomName: z.string().nullable().optional().describe('Legacy optional alias for the second partner name retained for backward compatibility.'),
  weddingDate: z.date().describe('Scheduled wedding ceremony date and timestamp used by countdowns and calendar exports.'),
  baseUrl: z.string().refine(isSafeHttpBaseUrl, { message: 'Invalid URL format' }).describe('Canonical public base URL of the deployed wedding website used for SEO and Open Graph tags.'),
  venueName: z.string().describe('Display name of the primary wedding ceremony or reception venue.'),
  venueAddress: z.string().describe('Street address of the primary wedding venue.'),
  venueCity: z.string().describe('City where the primary wedding venue is located.'),
  venueState: z.string().describe('State, province, or region of the primary wedding venue.'),
  venueZip: z.string().describe('Postal or ZIP code of the primary wedding venue.'),
  latitude: z.number().describe('Geographic latitude coordinate of the venue used for maps and live weather forecasts.'),
  longitude: z.number().describe('Geographic longitude coordinate of the venue used for maps and live weather forecasts.'),
  storyText: z.string().describe('Couple story narrative displayed on the homepage story section.'),
  venueDescription: z.string().describe('Descriptive overview of the wedding venue grounds, setting, and amenities.'),
  travelAdvice: z.string().describe('Travel, airport, parking, and local transit guidance for attending guests.'),
  heroTitle: z.string().describe('Main headline rendered inside the homepage hero banner.'),
  heroSubtitle: z.string().describe('Secondary tagline rendered beneath the homepage hero headline.'),
  seoTitle: z.string().describe('HTML document title and social preview title for search engines and link cards.'),
  seoDescription: z.string().describe('Meta description summarizing the wedding website for search engines and Open Graph previews.'),
  contactEmail: z.string().refine((val) => val === '' || z.email().safeParse(val).success, { message: 'Invalid email address format' }).default('').describe('Public host contact email address displayed for guest inquiries.'),
  photoAlbumUrl: z.string().refine(isSafeHttpBaseUrl, { message: 'Invalid URL format' }).default('').describe('Optional external shared photo album URL displayed on the public gallery page.'),
  autoApproveGuestPhotos: z.boolean().default(false).describe('Admin-only toggle controlling whether new guest photo uploads are automatically approved and published immediately without manual moderation; omitted from public DTOs.'),
  guestPhotoQrTokenVersion: z.number().int().min(1).default(1).describe('Admin-only monotonic version counter for rotating signed guest photo upload QR links and invalidating previously issued photo sessions; omitted from public DTOs.'),
  faviconUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).describe('Asset path or safe URL for the browser tab favicon icon.'),
  ogImageUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).describe('Default Open Graph social sharing preview image URL or asset path.'),
  brandMonogram: z.string().nullable().optional().describe('Custom monogram text overriding initials derived from partner names.'),
  brandLogoUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional().describe('Optional custom brand logo image URL or asset path rendered in navigation.'),
  brandLogoAlt: z.string().nullable().optional().describe('Accessible alt text describing the custom brand logo image.'),
  heroImageUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional().describe('Optional custom hero background or featured image URL on the homepage.'),
  heroImageAlt: z.string().nullable().optional().describe('Accessible alt text describing the homepage hero image.'),
  brandWatermarkUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional().describe('Optional decorative watermark graphic URL rendered in page backgrounds.'),
  brandWatermarkAlt: z.string().nullable().optional().describe('Accessible alt text for the brand watermark graphic when non-decorative.'),
  badgeGraphicUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional().describe('Optional emblem or badge graphic URL displayed in headers or footers.'),
  badgeGraphicAlt: z.string().nullable().optional().describe('Accessible alt text describing the custom badge graphic.'),
  seoKeywords: z.string().describe('Comma-separated SEO meta keywords template supporting partner and venue placeholders.'),
  colorPrimary: z.string().regex(hexColorRegex, 'Invalid hex color format').default('#B91C1C').describe('Primary brand hex color applied to accents, buttons, and interactive highlights.'),
  colorSecondary: z.string().regex(hexColorRegex, 'Invalid hex color format').default('#B45309').describe('Secondary brand hex color applied to complementary badges, borders, and highlights.'),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic').describe('Named visual theme preset controlling baseline palette and typographic styling.'),
  themeTokens: z.union([
    z.string().transform((str) => {
      try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : {};
      } catch {
        return {};
      }
    }),
    ThemeTokensSchema,
    z.record(z.string(), z.string())
  ]).pipe(ThemeTokensSchema).default({}).describe('Custom CSS custom property overrides (--* tokens) merged atop the active theme preset.'),
  typographyScale: TypographyScaleSchema.optional().default(() => TypographyScaleSchema.parse({})).describe('Virtual DTO typography scale tokens defining font sizes, weights, and line heights.'),
  spacingScale: SpacingScaleSchema.optional().default(() => SpacingScaleSchema.parse({})).describe('Virtual DTO spacing scale tokens defining rhythm units, container width, grid gap, and card padding.'),
  borderTreatment: BorderTreatmentSchema.optional().default(() => BorderTreatmentSchema.parse({})).describe('Virtual DTO border radius, width, and stroke style design tokens.'),
  brandDimensions: BrandDimensionsSchema.optional().default(() => BrandDimensionsSchema.parse({})).describe('Virtual DTO composite dimensions for brand logos, hero height, watermarks, and badges.'),
  brandLogoWidth: layoutTokenSchema.optional().default('120px').describe('Virtual DTO CSS width token for the header brand logo.'),
  brandLogoHeight: layoutTokenSchema.optional().default('40px').describe('Virtual DTO CSS height token for the header brand logo.'),
  brandHeroHeight: layoutTokenSchema.optional().default('400px').describe('Virtual DTO CSS height token for the homepage hero banner.'),
  brandWatermarkWidth: layoutTokenSchema.optional().default('200px').describe('Virtual DTO CSS width token for background watermark graphics.'),
  brandWatermarkOpacity: z.string().optional().default('0.1').describe('Virtual DTO CSS opacity value (0 to 1) applied to brand watermark graphics.'),
  brandBadgeSize: layoutTokenSchema.optional().default('48px').describe('Virtual DTO CSS size token for decorative brand badge graphics.'),
  layoutContainerMaxWidth: layoutTokenSchema.optional().default('64rem').describe('Maximum CSS width token for primary page content containers.'),
  layoutGridGap: layoutTokenSchema.optional().default('1.5rem').describe('Default CSS gap token between multi-column layout grid items.'),
  layoutCardPadding: layoutTokenSchema.optional().default('2rem').describe('Default internal CSS padding token for surface cards and panels.'),
  layoutBorderRadius: layoutTokenSchema.optional().default('1rem').describe('Default CSS border-radius token applied to cards, inputs, and dialogs.'),
  fontHeading: fontTokenSchema.describe('Virtual DTO CSS font-family token used for display headings and titles.'),
  fontBody: fontTokenSchema.describe('Virtual DTO CSS font-family token used for body copy and UI controls.'),
  fontMono: fontTokenSchema.describe('Virtual DTO CSS font-family token used for invitation codes and tabular values.'),
  timezone: z.string().default('America/Chicago').describe('IANA timezone identifier used to format event schedules and countdown timers.'),
  showCountdown: z.boolean().default(true).describe('Toggle controlling whether the live wedding countdown widget renders on public pages.'),
  showAddToCalendar: z.boolean().default(true).describe('Toggle controlling whether Add-to-Calendar links and ICS downloads are shown.'),
  rsvpOpen: z.boolean().default(true).describe('Manual toggle controlling whether online guest RSVP submissions and edits are enabled.'),
  isRsvpOpen: z.boolean().optional().describe('Virtual server-evaluated flag indicating whether online RSVPs are currently open after evaluating manual lock, cutoff date, and grace period.'),
  rsvpDeadlineDate: z.string().refine((val) => val === '' || isValidRsvpDeadlineDate(val), { message: 'Invalid RSVP deadline date. Expected YYYY-MM-DD.' }).default('').describe('Optional global RSVP cutoff calendar date (YYYY-MM-DD) enforced at midnight in the venue timezone.'),
  rsvpGracePeriodHours: z.number().int().refine(isValidRsvpGracePeriodHours, { message: 'Invalid RSVP grace period hours.' }).default(0).describe('Admin-only silent grace window in hours (0, 12, 24, 48, 72, or 168) after the midnight RSVP cutoff; omitted from public DTOs.'),
  rsvpClosedMessage: z.string().default('').transform((val) => sanitizeRsvpClosedMessage(val)).describe('Sanitized custom message displayed to guests and returned by RSVP APIs once online RSVPs close.'),
  emailProvider: z.string().default('smtp').describe('Active outbound email transport provider identifier (smtp, resend, or sendgrid).'),
  smtpHost: z.string().nullable().optional().default('').describe('Hostname of the outbound SMTP relay server for guest broadcasts.'),
  smtpPort: z.number().nullable().optional().default(587).describe('TCP port number used when connecting to the outbound SMTP server.'),
  smtpUser: z.string().nullable().optional().default('').describe('Authentication username for the configured outbound SMTP server.'),
  smtpPass: z.string().nullable().optional().default('').describe('Authentication password for the SMTP server; omitted from public DTOs and masked as hasSmtpPass in admin DTOs.'),
  smtpFrom: z.string().nullable().optional().default('').describe('Sender email address used in the From header of SMTP broadcast emails.'),
  smtpSecure: z.boolean().nullable().optional().default(false).describe('Whether the SMTP transport establishes implicit TLS on connection.'),
  resendApiKey: z.string().nullable().optional().default('').describe('API key for Resend email delivery; omitted from public DTOs and masked as hasResendApiKey in admin DTOs.'),
  resendFrom: z.string().nullable().optional().default('').describe('Verified sender email address used for outbound Resend broadcasts.'),
  sendgridApiKey: z.string().nullable().optional().default('').describe('API key for SendGrid email delivery; omitted from public DTOs and masked as hasSendgridApiKey in admin DTOs.'),
  sendgridFrom: z.string().nullable().optional().default('').describe('Verified sender email address used for outbound SendGrid broadcasts.'),
  smsProvider: z.string().nullable().optional().default('none').describe('Active outbound SMS broadcast provider identifier (none or twilio).'),
  twilioAccountSid: z.string().nullable().optional().default('').describe('Twilio Account SID used for dispatching SMS guest broadcasts.'),
  twilioAuthToken: z.string().nullable().optional().default('').describe('Twilio Auth Token secret; omitted from public DTOs and masked as hasTwilioAuthToken in admin DTOs.'),
  twilioFromNumber: z.string().nullable().optional().default('').describe('Twilio E.164 sender phone number or messaging source for SMS broadcasts.'),
  broadcastBatchSize: z.number().default(50).describe('Maximum number of broadcast recipients processed per delivery batch.'),
  broadcastBatchDelayMs: z.number().default(500).describe('Delay in milliseconds between consecutive outbound broadcast batches.'),
  shippingRecipientName: z.string().default('').describe('Recipient full name for registry gift shipping; omitted from public DTOs and served only to authenticated guests and admins.'),
  shippingAddressLine1: z.string().default('').describe('Primary street address line for registry gift deliveries; omitted from public DTOs.'),
  shippingAddressLine2: z.string().default('').describe('Optional apartment, suite, or unit line for registry gift deliveries; omitted from public DTOs.'),
  shippingCity: z.string().default('').describe('City for registry gift deliveries; omitted from public DTOs.'),
  shippingState: z.string().default('').describe('State, province, or region for registry gift deliveries; omitted from public DTOs.'),
  shippingZip: z.string().default('').describe('Postal or ZIP code for registry gift deliveries; omitted from public DTOs.'),
  shippingCountry: z.string().default('').describe('Destination country for registry gift deliveries; omitted from public DTOs.'),
  shippingPhone: z.string().default('').describe('Carrier contact phone number for registry gift deliveries; omitted from public DTOs.'),
  shippingDeliveryNotes: z.string().default('').describe('Optional carrier or concierge instructions for registry gift deliveries; omitted from public DTOs.'),
  defaultPaymentHandleType: z.string().default('').describe('Site-wide fallback peer-to-peer payment service (Venmo, PayPal, Cash App, Zelle, or Custom) for group gifts without an item-level handle; omitted from public DTOs.'),
  defaultPaymentHandle: z.string().default('').describe('Site-wide fallback peer-to-peer payment handle or username for group gifts without an item-level handle; omitted from public DTOs.'),
  registryGiftAccessTier: z
    .enum(['PASSCODE_GUESTS', 'INVITED_HOUSEHOLDS'])
    .default('PASSCODE_GUESTS')
    .describe('Controls whether website passcode guests (PASSCODE_GUESTS) or only verified invited households (INVITED_HOUSEHOLDS) can claim physical gifts and record zero-fee direct transfers; omitted from public DTOs.'),
  shippingDisclosureTier: z
    .enum(['PASSCODE_GUESTS', 'INVITED_HOUSEHOLDS', 'POST_CLAIM_ONLY'])
    .default('PASSCODE_GUESTS')
    .describe('Controls when the couple shipping address is revealed: to passcode and invited guests (PASSCODE_GUESTS), verified invited households only (INVITED_HOUSEHOLDS), or strictly after claiming a gift (POST_CLAIM_ONLY); omitted from public DTOs.'),
  maxPendingReservations: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5)
    .describe('Maximum concurrent RESERVED physical gift holds allowed per household or email before requiring confirmation or release; omitted from public DTOs.'),
  setupCompleted: z.boolean().default(true).describe('Admin-only flag tracking whether the five-step onboarding setup wizard has been completed; omitted from public DTOs.'),
  modules: z.any().optional().transform((val): z.input<typeof ModuleConfigSchema> => resolveModuleConfig(val)).pipe(ModuleConfigSchema).default(DEFAULT_MODULE_CONFIG).describe('Persisted feature module enablement map validated against ModuleConfigSchema with dependency resolution.'),
  features: z.union([
    z.string().transform((str) => {
      try {
        return JSON.parse(str);
      } catch {
        return [];
      }
    }),
    z.any()
  ]).pipe(z.array(FeatureSchema)).describe('Ordered homepage content section definitions controlling section titles, visibility, and copy.'),
  createdAt: z.date().describe('Timestamp recording when the configuration record was initially created.'),
  updatedAt: z.date().describe('Timestamp recording when the configuration record was last modified.'),
});

export type AppConfigDTO = z.infer<typeof AppConfigSchema>;

export const PublicAppConfigSchema = z
  .object({
    id: z.string(),
    subdomain: z.string().nullable().optional(),
    multisiteEnabled: z.boolean().optional(),
    partner1Name: z.string().default(''),
    partner2Name: z.string().default(''),
    brideName: z.string().nullable().optional(),
    groomName: z.string().nullable().optional(),
    weddingDate: z.coerce.date(),
    baseUrl: z.string(),
    venueName: z.string(),
    venueAddress: z.string(),
    venueCity: z.string(),
    venueState: z.string(),
    venueZip: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    storyText: z.string(),
    venueDescription: z.string(),
    travelAdvice: z.string(),
    heroTitle: z.string(),
    heroSubtitle: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    contactEmail: z.string().default(''),
    photoAlbumUrl: z.string().default(''),
    faviconUrl: z.string(),
    ogImageUrl: z.string(),
    brandMonogram: z.string().nullable().optional(),
    brandLogoUrl: z.string().nullable().optional(),
    brandLogoAlt: z.string().nullable().optional(),
    heroImageUrl: z.string().nullable().optional(),
    heroImageAlt: z.string().nullable().optional(),
    brandWatermarkUrl: z.string().nullable().optional(),
    brandWatermarkAlt: z.string().nullable().optional(),
    badgeGraphicUrl: z.string().nullable().optional(),
    badgeGraphicAlt: z.string().nullable().optional(),
    seoKeywords: z.string(),
    colorPrimary: z.string().default('#B91C1C'),
    colorSecondary: z.string().default('#B45309'),
    themePreset: z
      .enum(['classic', 'modern', 'romantic', 'minimal', 'editorial'])
      .default('classic'),
    themeTokens: AppConfigSchema.shape.themeTokens,
    typographyScale: AppConfigSchema.shape.typographyScale,
    spacingScale: AppConfigSchema.shape.spacingScale,
    borderTreatment: AppConfigSchema.shape.borderTreatment,
    brandDimensions: AppConfigSchema.shape.brandDimensions,
    brandLogoWidth: AppConfigSchema.shape.brandLogoWidth,
    brandLogoHeight: AppConfigSchema.shape.brandLogoHeight,
    brandHeroHeight: AppConfigSchema.shape.brandHeroHeight,
    brandWatermarkWidth: AppConfigSchema.shape.brandWatermarkWidth,
    brandWatermarkOpacity: AppConfigSchema.shape.brandWatermarkOpacity,
    brandBadgeSize: AppConfigSchema.shape.brandBadgeSize,
    layoutContainerMaxWidth: AppConfigSchema.shape.layoutContainerMaxWidth,
    layoutGridGap: AppConfigSchema.shape.layoutGridGap,
    layoutCardPadding: AppConfigSchema.shape.layoutCardPadding,
    layoutBorderRadius: AppConfigSchema.shape.layoutBorderRadius,
    fontHeading: fontTokenSchema,
    fontBody: fontTokenSchema,
    fontMono: fontTokenSchema,
    timezone: z.string().default('America/Chicago'),
    showCountdown: z.boolean().default(true),
    showAddToCalendar: z.boolean().default(true),
    rsvpOpen: z.boolean().default(true),
    isRsvpOpen: z.boolean().optional(),
    rsvpDeadlineDate: z.string().default(''),
    rsvpClosedMessage: z
      .string()
      .default('')
      .transform((val) => sanitizeRsvpClosedMessage(val)),
    modules: AppConfigSchema.shape.modules,
    features: AppConfigSchema.shape.features,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .strict();
export type PublicAppConfigDTO = z.infer<typeof PublicAppConfigSchema>;

/**
 * Derive brand monogram text based on explicit brandMonogram token or partner names initials.
 * Example: partner1Name: "Alice", partner2Name: "Bob" -> "A & B"
 */
export function deriveBrandMonogram(
  config:
    | {
      brandMonogram?: string | null;
      partner1Name?: string | null;
      partner2Name?: string | null;
      brideName?: string | null;
      groomName?: string | null;
    }
    | null
    | undefined,
): string {
  if (!config) return 'A & F';
  if (config.brandMonogram && config.brandMonogram.trim() !== '') {
    return config.brandMonogram.trim();
  }
  const p1 = (config.partner1Name || config.brideName || '').trim();
  const p2 = (config.partner2Name || config.groomName || '').trim();

  if (p1 && p2) {
    const i1 = p1.charAt(0).toUpperCase();
    const i2 = p2.charAt(0).toUpperCase();
    return `${i1} & ${i2}`;
  }
  if (p1) return p1.charAt(0).toUpperCase();
  if (p2) return p2.charAt(0).toUpperCase();

  return 'A & F';
}

const APP_CONFIG_EMPTY_STRING_COLUMNS = [
  'baseUrl',
  'venueName',
  'venueAddress',
  'venueCity',
  'venueState',
  'venueZip',
  'storyText',
  'venueDescription',
  'travelAdvice',
  'heroTitle',
  'heroSubtitle',
  'seoTitle',
  'seoDescription',
  'contactEmail',
  'photoAlbumUrl',
  'seoKeywords',
] as const;

const APP_CONFIG_NULLABLE_BRAND_COLUMNS = [
  'brandMonogram',
  'brandLogoUrl',
  'brandLogoAlt',
  'heroImageUrl',
  'heroImageAlt',
  'brandWatermarkUrl',
  'brandWatermarkAlt',
  'badgeGraphicUrl',
  'badgeGraphicAlt',
] as const;

const APP_CONFIG_NULLABLE_BRAND_URL_SET = new Set<string>([
  'brandLogoUrl',
  'heroImageUrl',
  'brandWatermarkUrl',
  'badgeGraphicUrl',
]);

const APP_CONFIG_LAYOUT_DEFAULTS = {
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
} as const;

const APP_CONFIG_NULLABLE_STRING_DELIVERY_DEFAULTS = {
  smtpHost: '',
  smtpUser: '',
  smtpFrom: '',
  resendFrom: '',
  sendgridFrom: '',
  smsProvider: 'none',
  twilioAccountSid: '',
  twilioFromNumber: '',
} as const;

const APP_CONFIG_TRIMMED_SHIPPING_AND_PAYMENT_COLUMNS = [
  'shippingRecipientName',
  'shippingAddressLine1',
  'shippingAddressLine2',
  'shippingCity',
  'shippingState',
  'shippingZip',
  'shippingCountry',
  'shippingPhone',
  'shippingDeliveryNotes',
  'defaultPaymentHandleType',
  'defaultPaymentHandle',
] as const;

/**
 * Translate a persisted `AppConfig` snapshot into separate Prisma `update` and
 * `create` payloads across all mutable persisted columns.
 *
 * Omitted (`undefined`) fields remain `undefined` in `update` so rolling back
 * partial or legacy historical snapshots preserves live database values and
 * never overwrites stored messaging secrets with blank values.
 */
export function translateAppConfigSnapshot(
  snapshotData: Record<string, unknown> | null | undefined,
  entityId?: string,
): { update: Record<string, unknown>; create: Record<string, unknown> } | null {
  if (
    !snapshotData ||
    typeof snapshotData !== 'object' ||
    Array.isArray(snapshotData)
  ) {
    return null;
  }

  const update: Record<string, unknown> = {};
  const create: Record<string, unknown> = {
    ...(entityId !== undefined ? { id: entityId } : {}),
  };

  const hasPartner1 =
    snapshotData.partner1Name !== undefined ||
    snapshotData.brideName !== undefined;
  const partner1Name =
    typeof snapshotData.partner1Name === 'string'
      ? snapshotData.partner1Name
      : typeof snapshotData.brideName === 'string'
        ? snapshotData.brideName
        : '';
  const brideName =
    snapshotData.brideName === null
      ? null
      : typeof snapshotData.brideName === 'string'
        ? snapshotData.brideName
        : partner1Name;
  create.partner1Name = partner1Name;
  create.brideName = brideName;
  if (hasPartner1) {
    update.partner1Name = partner1Name;
    update.brideName = brideName;
  }

  const hasPartner2 =
    snapshotData.partner2Name !== undefined ||
    snapshotData.groomName !== undefined;
  const partner2Name =
    typeof snapshotData.partner2Name === 'string'
      ? snapshotData.partner2Name
      : typeof snapshotData.groomName === 'string'
        ? snapshotData.groomName
        : '';
  const groomName =
    snapshotData.groomName === null
      ? null
      : typeof snapshotData.groomName === 'string'
        ? snapshotData.groomName
        : partner2Name;
  create.partner2Name = partner2Name;
  create.groomName = groomName;
  if (hasPartner2) {
    update.partner2Name = partner2Name;
    update.groomName = groomName;
  }

  const subdomain =
    typeof snapshotData.subdomain === 'string' &&
    snapshotData.subdomain.length > 0
      ? snapshotData.subdomain
      : null;
  create.subdomain = subdomain;
  if (snapshotData.subdomain !== undefined) {
    update.subdomain = subdomain;
  }

  if (
    snapshotData.weddingDate !== undefined &&
    snapshotData.weddingDate !== null &&
    snapshotData.weddingDate !== ''
  ) {
    const rawDate =
      snapshotData.weddingDate instanceof Date
        ? snapshotData.weddingDate
        : new Date(String(snapshotData.weddingDate));
    const resolvedDate = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
    update.weddingDate = resolvedDate;
    create.weddingDate = resolvedDate;
  } else {
    create.weddingDate = new Date();
  }

  for (const key of APP_CONFIG_EMPTY_STRING_COLUMNS) {
    const raw = snapshotData[key];
    let resolved = raw === undefined || raw === null ? '' : String(raw);
    if (key === 'baseUrl' || key === 'photoAlbumUrl') {
      const candidate = resolved.trim();
      resolved = isSafeHttpBaseUrl(candidate) ? candidate : '';
    } else if (key === 'contactEmail') {
      const candidate = resolved.trim();
      resolved =
        candidate === '' || z.email().safeParse(candidate).success
          ? candidate
          : '';
    }
    create[key] = resolved;
    if (raw !== undefined) {
      update[key] = resolved;
    }
  }

  if (
    snapshotData.autoApproveGuestPhotos !== undefined &&
    snapshotData.autoApproveGuestPhotos !== null
  ) {
    const resolvedAutoApprove = Boolean(snapshotData.autoApproveGuestPhotos);
    update.autoApproveGuestPhotos = resolvedAutoApprove;
    create.autoApproveGuestPhotos = resolvedAutoApprove;
  } else {
    create.autoApproveGuestPhotos = false;
  }

  if (
    snapshotData.guestPhotoQrTokenVersion !== undefined &&
    snapshotData.guestPhotoQrTokenVersion !== null
  ) {
    const numericVersion = Number(snapshotData.guestPhotoQrTokenVersion);
    const resolvedVersion =
      Number.isInteger(numericVersion) && numericVersion >= 1
        ? numericVersion
        : 1;
    update.guestPhotoQrTokenVersion = resolvedVersion;
    create.guestPhotoQrTokenVersion = resolvedVersion;
  } else {
    create.guestPhotoQrTokenVersion = 1;
  }

  const faviconUrl =
    typeof snapshotData.faviconUrl === 'string' &&
    isSafeConfigAssetUrl(snapshotData.faviconUrl)
      ? snapshotData.faviconUrl
      : '/assets/favicon.png';
  create.faviconUrl = faviconUrl;
  if (snapshotData.faviconUrl !== undefined) {
    update.faviconUrl = faviconUrl;
  }

  const ogImageUrl =
    typeof snapshotData.ogImageUrl === 'string' &&
    isSafeConfigAssetUrl(snapshotData.ogImageUrl)
      ? snapshotData.ogImageUrl
      : '/images/placeholder.png';
  create.ogImageUrl = ogImageUrl;
  if (snapshotData.ogImageUrl !== undefined) {
    update.ogImageUrl = ogImageUrl;
  }

  const parsedLat =
    snapshotData.latitude !== undefined
      ? coordinateSchema.safeParse(snapshotData.latitude ?? 0)
      : null;
  const latitude = parsedLat && parsedLat.success ? parsedLat.data : 0;
  create.latitude = latitude;
  if (snapshotData.latitude !== undefined) {
    update.latitude = latitude;
  }

  const parsedLng =
    snapshotData.longitude !== undefined
      ? coordinateSchema.safeParse(snapshotData.longitude ?? 0)
      : null;
  const longitude = parsedLng && parsedLng.success ? parsedLng.data : 0;
  create.longitude = longitude;
  if (snapshotData.longitude !== undefined) {
    update.longitude = longitude;
  }

  for (const key of APP_CONFIG_NULLABLE_BRAND_COLUMNS) {
    const raw = snapshotData[key];
    if (raw !== undefined) {
      const candidate = raw === null ? null : String(raw);
      const resolved =
        candidate === null ||
        !APP_CONFIG_NULLABLE_BRAND_URL_SET.has(key) ||
        isSafeConfigAssetUrl(candidate)
          ? candidate
          : null;
      update[key] = resolved;
      create[key] = resolved;
    } else {
      create[key] = null;
    }
  }

  const colorPrimary =
    typeof snapshotData.colorPrimary === 'string' &&
    hexColorRegex.test(snapshotData.colorPrimary)
      ? snapshotData.colorPrimary
      : '#B91C1C';
  create.colorPrimary = colorPrimary;
  if (snapshotData.colorPrimary !== undefined) {
    update.colorPrimary = colorPrimary;
  }

  const colorSecondary =
    typeof snapshotData.colorSecondary === 'string' &&
    hexColorRegex.test(snapshotData.colorSecondary)
      ? snapshotData.colorSecondary
      : '#B45309';
  create.colorSecondary = colorSecondary;
  if (snapshotData.colorSecondary !== undefined) {
    update.colorSecondary = colorSecondary;
  }

  const parsedThemePreset = AppConfigSchema.shape.themePreset.safeParse(
    snapshotData.themePreset,
  );
  const themePreset = parsedThemePreset.success
    ? parsedThemePreset.data
    : 'classic';
  create.themePreset = themePreset;
  if (snapshotData.themePreset !== undefined) {
    update.themePreset = themePreset;
  }

  if (snapshotData.themeTokens !== undefined) {
    let resolvedTokens: Record<string, string> | null = {};
    if (snapshotData.themeTokens === null) {
      resolvedTokens = null;
    } else {
      let candidateTokens: unknown = snapshotData.themeTokens;
      if (typeof candidateTokens === 'string') {
        try {
          candidateTokens = JSON.parse(candidateTokens);
        } catch {
          candidateTokens = {};
        }
      }
      if (
        candidateTokens &&
        typeof candidateTokens === 'object' &&
        !Array.isArray(candidateTokens)
      ) {
        const filteredTokens: Record<string, string> = {};
        for (const [tokenKey, tokenVal] of Object.entries(candidateTokens)) {
          if (
            cssTokenKeyRegex.test(tokenKey) &&
            typeof tokenVal === 'string' &&
            isValidCssTokenValue(tokenVal)
          ) {
            filteredTokens[tokenKey] = tokenVal;
          }
        }
        resolvedTokens = filteredTokens;
      }
    }
    update.themeTokens = resolvedTokens;
    create.themeTokens = resolvedTokens;
  } else {
    create.themeTokens = {};
  }

  for (const [key, fallback] of Object.entries(APP_CONFIG_LAYOUT_DEFAULTS)) {
    const raw = snapshotData[key];
    const resolved =
      typeof raw === 'string' &&
      raw.length > 0 &&
      layoutTokenSchema.safeParse(raw).success
        ? raw
        : fallback;
    create[key] = resolved;
    if (raw !== undefined) {
      update[key] = resolved;
    }
  }

  const features = Array.isArray(snapshotData.features)
    ? snapshotData.features.flatMap((entry) => {
      const parsedFeature = FeatureSchema.safeParse(entry);
      return parsedFeature.success ? [parsedFeature.data] : [];
    })
    : [];
  create.features = features;
  if (snapshotData.features !== undefined) {
    update.features = features;
  }

  const hasSnapshotModules =
    snapshotData.modules !== undefined &&
    snapshotData.modules !== null &&
    typeof snapshotData.modules === 'object' &&
    !Array.isArray(snapshotData.modules);
  const rawModules = hasSnapshotModules
    ? (snapshotData.modules as Record<string, unknown>)
    : {};
  const resolvedModules = resolveModuleConfig({
    ...(snapshotData.showCountdown !== undefined
      ? { countdown: snapshotData.showCountdown !== false }
      : {}),
    ...(snapshotData.showAddToCalendar !== undefined
      ? { addToCalendar: snapshotData.showAddToCalendar !== false }
      : {}),
    ...rawModules,
  });
  const resolvedShowCountdown =
    hasSnapshotModules && typeof rawModules.countdown === 'boolean'
      ? resolvedModules.countdown
      : snapshotData.showCountdown !== undefined
        ? snapshotData.showCountdown !== false
        : resolvedModules.countdown;
  const resolvedShowAddToCalendar =
    hasSnapshotModules && typeof rawModules.addToCalendar === 'boolean'
      ? resolvedModules.addToCalendar
      : snapshotData.showAddToCalendar !== undefined
        ? snapshotData.showAddToCalendar !== false
        : resolvedModules.addToCalendar;
  create.modules = resolvedModules;
  create.showCountdown = resolvedShowCountdown;
  create.showAddToCalendar = resolvedShowAddToCalendar;
  if (
    hasSnapshotModules ||
    snapshotData.showCountdown !== undefined ||
    snapshotData.showAddToCalendar !== undefined
  ) {
    update.modules = resolvedModules;
    update.showCountdown = resolvedShowCountdown;
    update.showAddToCalendar = resolvedShowAddToCalendar;
  }

  const timezone =
    typeof snapshotData.timezone === 'string' &&
    snapshotData.timezone.length > 0
      ? snapshotData.timezone
      : 'UTC';
  create.timezone = timezone;
  if (snapshotData.timezone !== undefined) {
    update.timezone = timezone;
  }

  if (snapshotData.rsvpOpen !== undefined && snapshotData.rsvpOpen !== null) {
    const resolvedRsvpOpen = Boolean(snapshotData.rsvpOpen);
    update.rsvpOpen = resolvedRsvpOpen;
    create.rsvpOpen = resolvedRsvpOpen;
  } else {
    create.rsvpOpen = true;
  }

  if (snapshotData.rsvpDeadlineDate !== undefined) {
    const rawDeadline =
      snapshotData.rsvpDeadlineDate === null
        ? ''
        : String(snapshotData.rsvpDeadlineDate).trim();
    const resolvedDeadline =
      rawDeadline === '' || isValidRsvpDeadlineDate(rawDeadline)
        ? rawDeadline
        : '';
    update.rsvpDeadlineDate = resolvedDeadline;
    create.rsvpDeadlineDate = resolvedDeadline;
  } else {
    create.rsvpDeadlineDate = '';
  }

  if (
    snapshotData.rsvpGracePeriodHours !== undefined &&
    snapshotData.rsvpGracePeriodHours !== null
  ) {
    const numericGrace =
      typeof snapshotData.rsvpGracePeriodHours === 'number'
        ? snapshotData.rsvpGracePeriodHours
        : parseInt(String(snapshotData.rsvpGracePeriodHours).trim(), 10);
    const resolvedGrace = isValidRsvpGracePeriodHours(numericGrace)
      ? numericGrace
      : 0;
    update.rsvpGracePeriodHours = resolvedGrace;
    create.rsvpGracePeriodHours = resolvedGrace;
  } else {
    create.rsvpGracePeriodHours = 0;
  }

  if (snapshotData.rsvpClosedMessage !== undefined) {
    const resolvedClosedMessage = sanitizeRsvpClosedMessage(
      typeof snapshotData.rsvpClosedMessage === 'string'
        ? snapshotData.rsvpClosedMessage
        : '',
    );
    update.rsvpClosedMessage = resolvedClosedMessage;
    create.rsvpClosedMessage = resolvedClosedMessage;
  } else {
    create.rsvpClosedMessage = '';
  }

  const emailProvider =
    typeof snapshotData.emailProvider === 'string' &&
    snapshotData.emailProvider.length > 0
      ? snapshotData.emailProvider
      : 'smtp';
  create.emailProvider = emailProvider;
  if (snapshotData.emailProvider !== undefined) {
    update.emailProvider = emailProvider;
  }

  for (const [key, fallback] of Object.entries(
    APP_CONFIG_NULLABLE_STRING_DELIVERY_DEFAULTS,
  )) {
    const raw = snapshotData[key];
    if (raw !== undefined) {
      const resolved = raw === null ? null : String(raw);
      update[key] = resolved;
      create[key] = resolved;
    } else {
      create[key] = fallback;
    }
  }

  if (snapshotData.smtpPort !== undefined) {
    const numericPort =
      snapshotData.smtpPort === null ? null : Number(snapshotData.smtpPort);
    const resolvedPort =
      numericPort === null ||
      (Number.isInteger(numericPort) &&
        numericPort >= 1 &&
        numericPort <= 65535)
        ? numericPort
        : 587;
    update.smtpPort = resolvedPort;
    create.smtpPort = resolvedPort;
  } else {
    create.smtpPort = 587;
  }

  if (snapshotData.smtpSecure !== undefined) {
    const resolvedSecure =
      snapshotData.smtpSecure === null
        ? null
        : Boolean(snapshotData.smtpSecure);
    update.smtpSecure = resolvedSecure;
    create.smtpSecure = resolvedSecure;
  } else {
    create.smtpSecure = false;
  }

  if (
    snapshotData.broadcastBatchSize !== undefined &&
    snapshotData.broadcastBatchSize !== null
  ) {
    const numericBatchSize = Number(snapshotData.broadcastBatchSize);
    const resolvedBatchSize =
      Number.isInteger(numericBatchSize) && numericBatchSize >= 1
        ? numericBatchSize
        : 50;
    update.broadcastBatchSize = resolvedBatchSize;
    create.broadcastBatchSize = resolvedBatchSize;
  } else {
    create.broadcastBatchSize = 50;
  }

  if (
    snapshotData.broadcastBatchDelayMs !== undefined &&
    snapshotData.broadcastBatchDelayMs !== null
  ) {
    const numericBatchDelay = Number(snapshotData.broadcastBatchDelayMs);
    const resolvedBatchDelay =
      Number.isInteger(numericBatchDelay) && numericBatchDelay >= 0
        ? numericBatchDelay
        : 500;
    update.broadcastBatchDelayMs = resolvedBatchDelay;
    create.broadcastBatchDelayMs = resolvedBatchDelay;
  } else {
    create.broadcastBatchDelayMs = 500;
  }

  for (const key of APP_CONFIG_TRIMMED_SHIPPING_AND_PAYMENT_COLUMNS) {
    const raw = snapshotData[key];
    if (raw !== undefined) {
      const resolved = raw === null ? '' : String(raw).trim();
      update[key] = resolved;
      create[key] = resolved;
    } else {
      create[key] = '';
    }
  }

  const parsedGiftAccessTier = AppConfigSchema.shape.registryGiftAccessTier.safeParse(
    snapshotData.registryGiftAccessTier,
  );
  const resolvedGiftAccessTier = parsedGiftAccessTier.success
    ? parsedGiftAccessTier.data
    : 'PASSCODE_GUESTS';
  create.registryGiftAccessTier = resolvedGiftAccessTier;
  if (snapshotData.registryGiftAccessTier !== undefined) {
    update.registryGiftAccessTier = resolvedGiftAccessTier;
  }

  const parsedShippingDisclosureTier = AppConfigSchema.shape.shippingDisclosureTier.safeParse(
    snapshotData.shippingDisclosureTier,
  );
  const resolvedShippingDisclosureTier = parsedShippingDisclosureTier.success
    ? parsedShippingDisclosureTier.data
    : 'PASSCODE_GUESTS';
  create.shippingDisclosureTier = resolvedShippingDisclosureTier;
  if (snapshotData.shippingDisclosureTier !== undefined) {
    update.shippingDisclosureTier = resolvedShippingDisclosureTier;
  }

  if (
    snapshotData.maxPendingReservations !== undefined &&
    snapshotData.maxPendingReservations !== null
  ) {
    const numericMaxHolds = Number(snapshotData.maxPendingReservations);
    const resolvedMaxHolds =
      Number.isInteger(numericMaxHolds) &&
      numericMaxHolds >= 1 &&
      numericMaxHolds <= 100
        ? numericMaxHolds
        : 5;
    update.maxPendingReservations = resolvedMaxHolds;
    create.maxPendingReservations = resolvedMaxHolds;
  } else {
    create.maxPendingReservations = 5;
  }

  if (
    snapshotData.setupCompleted !== undefined &&
    snapshotData.setupCompleted !== null
  ) {
    const resolvedSetupCompleted = Boolean(snapshotData.setupCompleted);
    update.setupCompleted = resolvedSetupCompleted;
    create.setupCompleted = resolvedSetupCompleted;
  } else {
    create.setupCompleted = true;
  }

  for (const secretKey of APP_CONFIG_SECRET_KEYS) {
    const val = snapshotData[secretKey];
    if (hasNonEmptySecret(val)) {
      update[secretKey] = val;
      create[secretKey] = val;
    }
  }

  return { update, create };
}
