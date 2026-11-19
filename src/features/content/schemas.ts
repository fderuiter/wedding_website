import { z } from 'zod';
import { coordinateSchema, isSafeConfigAssetUrl, isSafeMediaOrPhotoUrl } from '@/utils/validation';
import { ModuleConfigSchema, resolveModuleConfig, DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import {
  isValidRsvpDeadlineDate,
  isValidRsvpGracePeriodHours,
  sanitizeRsvpClosedMessage,
} from '@/utils/rsvpDeadline';

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;
export const layoutTokenSchema = z.string().refine(
  (val) => val === '' || layoutTokenRegex.test(val),
  { message: 'Invalid CSS length unit format.' }
);

export const cssTokenKeyRegex = /^--[a-zA-Z0-9_-]+$/;

export function isValidCssTokenValue(val: string): boolean {
  if (typeof val !== 'string') return false;
  // Disallow CSS code injection characters and control syntax
  if (/[;{}<>\r\n]|\/\*|\*\//.test(val)) return false;
  return true;
}

export const ThemeTokensSchema = z.record(
  z.string().regex(cssTokenKeyRegex, 'Invalid CSS token identifier format. Must start with "--" and contain alphanumeric characters, hyphens, or underscores.'),
  z.string().refine((val) => isValidCssTokenValue(val), {
    message: 'Invalid CSS token value or contains disallowed characters.',
  })
).default({});

export type ThemeTokensDTO = z.infer<typeof ThemeTokensSchema>;

const fontTokenRegex = /^[a-zA-Z0-9_\-\s,'"\(\)]*$/;
export const fontTokenSchema = z.string().regex(fontTokenRegex, 'Invalid font token format. Must only contain safe font-family characters.').nullable().optional();

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

export type TypographyScaleDTO = z.infer<typeof TypographyScaleSchema>;

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

export type SpacingScaleDTO = z.infer<typeof SpacingScaleSchema>;

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

export type BorderTreatmentDTO = z.infer<typeof BorderTreatmentSchema>;

export const BrandDimensionsSchema = z.object({
  logoWidth: layoutTokenSchema.optional().default('120px'),
  logoHeight: layoutTokenSchema.optional().default('40px'),
  heroHeight: layoutTokenSchema.optional().default('400px'),
  watermarkWidth: layoutTokenSchema.optional().default('200px'),
  watermarkOpacity: z.string().optional().default('0.1'),
  badgeSize: layoutTokenSchema.optional().default('48px'),
});

export type BrandDimensionsDTO = z.infer<typeof BrandDimensionsSchema>;

export const RawUpdateAppConfigSchema = z.object({
  partner1Name: z.string().optional(),
  partner2Name: z.string().optional(),
  brideName: z.string().optional(),
  groomName: z.string().optional(),
  subdomain: z.string().nullable().optional(),
  weddingDate: z.union([z.string(), z.date()]).refine((val) => {
    const d = new Date(val);
    return !isNaN(d.getTime());
  }, { message: 'Invalid chronological date format.' }).transform(val => new Date(val)),
  baseUrl: z.url({
    error: (issue) => issue.code === 'invalid_type' ? undefined : 'Invalid URL format',
  }).or(z.literal('')),
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
  contactEmail: z.string().refine(val => !val || val === '' || z.email().safeParse(val).success, { message: 'Invalid email address format' }).optional(),
  faviconUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }),
  ogImageUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }),
  brandMonogram: z.string().nullable().optional(),
  brandLogoUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional(),
  brandLogoAlt: z.string().nullable().optional(),
  heroImageUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional(),
  heroImageAlt: z.string().nullable().optional(),
  brandWatermarkUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional(),
  brandWatermarkAlt: z.string().nullable().optional(),
  badgeGraphicUrl: z.string().refine(isSafeConfigAssetUrl, { message: 'Invalid URL format' }).nullable().optional(),
  badgeGraphicAlt: z.string().nullable().optional(),
  seoKeywords: z.string(),
  colorPrimary: z.string().regex(hexColorRegex).optional(),
  colorSecondary: z.string().regex(hexColorRegex).optional(),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic'),
  themeTokens: ThemeTokensSchema.optional().default({}),
  typographyScale: TypographyScaleSchema.optional().default(() => TypographyScaleSchema.parse({})),
  spacingScale: SpacingScaleSchema.optional().default(() => SpacingScaleSchema.parse({})),
  borderTreatment: BorderTreatmentSchema.optional().default(() => BorderTreatmentSchema.parse({})),
  brandDimensions: BrandDimensionsSchema.optional().default(() => BrandDimensionsSchema.parse({})),
  brandLogoWidth: layoutTokenSchema.optional(),
  brandLogoHeight: layoutTokenSchema.optional(),
  brandHeroHeight: layoutTokenSchema.optional(),
  brandWatermarkWidth: layoutTokenSchema.optional(),
  brandWatermarkOpacity: z.string().optional(),
  brandBadgeSize: layoutTokenSchema.optional(),
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
      (val) => val === null || val.trim() === '' || isValidRsvpDeadlineDate(val.trim()),
      { message: 'Invalid RSVP deadline date. Expected YYYY-MM-DD.' }
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
  smtpPort: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).nullable().optional().default(587),
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
  broadcastBatchSize: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional().default(50),
  broadcastBatchDelayMs: z.union([z.number(), z.string().transform(v => parseInt(v, 10))]).optional().default(500),
  modules: ModuleConfigSchema.partial().optional(),
  timezone: z.string().refine(
    (val) => {
      if (val === 'UTC' || val === 'GMT') return true;
      try {
        return Intl.supportedValuesOf('timeZone').includes(val);
      } catch {
        return false;
      }
    },
    { message: 'Invalid standard IANA timezone identifier.' }
  ).optional(),
}).catchall(z.any()).superRefine((val, ctx) => {
  for (const [key, value] of Object.entries(val)) {
    if (typeof key === 'string' && key.toLowerCase().includes('color') && typeof value === 'string' && value !== '') {
      if (!hexColorRegex.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `Invalid hex color format for ${key}. Must be a valid hex code (e.g. #RRGGBB).`,
        });
      }
    }
  }
});

export const UpdateAppConfigSchema = RawUpdateAppConfigSchema.transform((data) => {
  const partner1Name = data.partner1Name || data.brideName || '';
  const partner2Name = data.partner2Name || data.groomName || '';
  return {
    ...data,
    partner1Name,
    partner2Name,
    brideName: partner1Name,
    groomName: partner2Name,
    layoutContainerMaxWidth: !data.layoutContainerMaxWidth || data.layoutContainerMaxWidth === '' ? '64rem' : data.layoutContainerMaxWidth,
    layoutGridGap: !data.layoutGridGap || data.layoutGridGap === '' ? '1.5rem' : data.layoutGridGap,
    layoutCardPadding: !data.layoutCardPadding || data.layoutCardPadding === '' ? '2rem' : data.layoutCardPadding,
    layoutBorderRadius: !data.layoutBorderRadius || data.layoutBorderRadius === '' ? '1rem' : data.layoutBorderRadius,
  };
});

/**
 * Map validated configuration data into the standard database payload structure for Prisma AppConfig operations.
 *
 * @param data - The validated data output from UpdateAppConfigSchema.
 * @returns Object formatted for Prisma appConfig create, update, and upsert operations.
 */
export function toAppConfigDbPayload(data: z.infer<typeof UpdateAppConfigSchema>) {
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
    timezone: data.timezone,
    showCountdown: data.showCountdown,
    showAddToCalendar: data.showAddToCalendar,
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

export const ScheduleDataSchema = z.object({
  title: z.string().optional(),
  startTime: z.string().nullish().refine(
    (val) => !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
    { message: 'startTime must be a valid ISO timestamp format (e.g., YYYY-MM-DDTHH:mm:ssZ).' }
  ).optional(),
  endTime: z.string().nullish().refine(
    (val) => !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))),
    { message: 'endTime must be a valid ISO timestamp format (e.g., YYYY-MM-DDTHH:mm:ssZ).' }
  ).optional(),
  categoryColors: z.record(z.string(), CategoryColorSchema).optional(),
  categoryTags: z.array(CategoryTagItemSchema).optional().default([]),
  category: z.string().optional(),
  locationName: z.string().optional(),
  location: z.string().optional(),
  attireRules: z.string().optional(),
  attire: z.string().optional(),
  description: z.string().optional(),
}).loose().transform((data) => {
  const extractedColors: Record<string, z.infer<typeof CategoryColorSchema>> = {
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
    categoryColors: Object.keys(extractedColors).length > 0 ? extractedColors : data.categoryColors,
  };
}).superRefine((val, ctx) => {
  if (val.startTime && val.endTime) {
    const start = new Date(val.startTime).getTime();
    const end = new Date(val.endTime).getTime();
    if (!isNaN(start) && !isNaN(end) && end < start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'endTime must be chronologically equal to or after startTime.',
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
  data: z.object({
    question: z.string().optional(),
    answer: z.string().optional(),
    category: z.string().optional(),
    categoryTags: z.union([z.array(z.string()), z.string()]).optional().transform((val) => {
      if (typeof val === 'string') {
        return val.split(',').map(s => s.trim()).filter(Boolean);
      }
      return val;
    }),
    keywords: z.union([z.array(z.string()), z.string()]).optional().transform((val) => {
      if (typeof val === 'string') {
        return val.split(',').map(s => s.trim()).filter(Boolean);
      }
      return val;
    }),
  }).loose(),
});

export const LogisticsNodeSchema = BaseContentNode.extend({
  type: z.literal('Logistics'),
  data: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    ceremonyTitle: z.string().optional(),
    ceremonyTime: z.string().optional(),
    receptionTitle: z.string().optional(),
    receptionTime: z.string().optional(),
    receptionDetails: z.string().optional(),
    receptionAttire: z.string().optional(),
    startTime: z.string().nullish().refine((val) => !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))), { message: 'startTime must be a valid ISO timestamp.' }).optional(),
    endTime: z.string().nullish().refine((val) => !val || (isoTimestampRegex.test(val) && !isNaN(Date.parse(val))), { message: 'endTime must be a valid ISO timestamp.' }).optional(),
    categoryTags: z.array(z.string()).optional(),
    category: z.string().optional(),
    locationName: z.string().optional(),
    location: z.string().optional(),
    attireRules: z.string().optional(),
    attire: z.string().optional(),
  }).loose(),
});

export const PhotoDataSchema = z.object({
  url: z.string().refine(isSafeMediaOrPhotoUrl, { message: 'Invalid photo URL format' }).optional(),
  title: z.string().optional(),
  altText: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().default('PENDING'),
  isVisible: z.boolean().optional().default(false),
  mediaId: z.string().optional(),
}).loose();

export const PhotoModerationSchema = z.object({
  id: z.string().optional(),
  nodeId: z.string().optional(),
  photoId: z.string().optional(),
  action: z.enum(['approve', 'reject', 'APPROVE', 'REJECT']).optional(),
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
});

export const BatchPhotoModerationSchema = z.object({
  ids: z.array(z.string()).optional(),
  photoIds: z.array(z.string()).optional(),
  nodeIds: z.array(z.string()).optional(),
  action: z.enum(['approve', 'reject', 'APPROVE', 'REJECT']).optional(),
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
}).loose().superRefine((data, ctx) => {
  const idsList = data.ids || data.photoIds || data.nodeIds;
  if (!idsList || !Array.isArray(idsList) || idsList.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['ids'],
      message: 'At least one photo ID (ids, photoIds, or nodeIds) is required',
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
      message: "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required",
    });
  }
});

export const PhotoNodeSchema = BaseContentNode.extend({
  type: z.literal('Photo'),
  data: PhotoDataSchema,
});

const TYPED_CONTENT_NODE_TYPES = new Set(['FAQ', 'Logistics', 'Schedule', 'Photo']);

export const GenericNodeSchema = BaseContentNode.extend({
  type: z.string().refine((val) => !TYPED_CONTENT_NODE_TYPES.has(val), {
    message: 'Known content node types must conform to their specific schema.',
  }),
  data: z.any(),
});

export const ContentNodeSchema = z.union([FAQNodeSchema, LogisticsNodeSchema, ScheduleNodeSchema, PhotoNodeSchema, GenericNodeSchema]);

export type ContentNodeDTO = z.infer<typeof ContentNodeSchema>;

const FeatureSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  visible: z.boolean().default(true),
  content: z.string().optional(),
});

export const AppConfigSchema = z.object({
  id: z.string().describe('Unique configuration profile identifier (defaults to "global" in single-site deployments).'),
  subdomain: z.string().nullable().optional().describe('Optional tenant subdomain slug used when MULTISITE_ENABLED is active.'),
  multisiteEnabled: z.boolean().optional().describe('Runtime flag resolved from MULTISITE_ENABLED indicating whether multi-profile routing is active.'),
  partner1Name: z.string().default('').describe('Primary display name for the first partner across headings, metadata, and monograms.'),
  partner2Name: z.string().default('').describe('Primary display name for the second partner across headings, metadata, and monograms.'),
  brideName: z.string().nullable().optional().describe('Legacy optional alias for the first partner name retained for backward compatibility.'),
  groomName: z.string().nullable().optional().describe('Legacy optional alias for the second partner name retained for backward compatibility.'),
  weddingDate: z.date().describe('Scheduled wedding ceremony date and timestamp used by countdowns and calendar exports.'),
  baseUrl: z.string().describe('Canonical public base URL of the deployed wedding website used for SEO and Open Graph tags.'),
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
  contactEmail: z.string().default('').describe('Public host contact email address displayed for guest inquiries.'),
  faviconUrl: z.string().describe('Asset path or safe URL for the browser tab favicon icon.'),
  ogImageUrl: z.string().describe('Default Open Graph social sharing preview image URL or asset path.'),
  brandMonogram: z.string().nullable().optional().describe('Custom monogram text overriding initials derived from partner names.'),
  brandLogoUrl: z.string().nullable().optional().describe('Optional custom brand logo image URL or asset path rendered in navigation.'),
  brandLogoAlt: z.string().nullable().optional().describe('Accessible alt text describing the custom brand logo image.'),
  heroImageUrl: z.string().nullable().optional().describe('Optional custom hero background or featured image URL on the homepage.'),
  heroImageAlt: z.string().nullable().optional().describe('Accessible alt text describing the homepage hero image.'),
  brandWatermarkUrl: z.string().nullable().optional().describe('Optional decorative watermark graphic URL rendered in page backgrounds.'),
  brandWatermarkAlt: z.string().nullable().optional().describe('Accessible alt text for the brand watermark graphic when non-decorative.'),
  badgeGraphicUrl: z.string().nullable().optional().describe('Optional emblem or badge graphic URL displayed in headers or footers.'),
  badgeGraphicAlt: z.string().nullable().optional().describe('Accessible alt text describing the custom badge graphic.'),
  seoKeywords: z.string().describe('Comma-separated SEO meta keywords template supporting partner and venue placeholders.'),
  colorPrimary: z.string().default('#B91C1C').describe('Primary brand hex color applied to accents, buttons, and interactive highlights.'),
  colorSecondary: z.string().default('#B45309').describe('Secondary brand hex color applied to complementary badges, borders, and highlights.'),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic').describe('Named visual theme preset controlling baseline palette and typographic styling.'),
  themeTokens: z.union([
    z.string().transform((str) => {
      try {
        return JSON.parse(str);
      } catch (e) {
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
  rsvpDeadlineDate: z.string().default('').describe('Optional global RSVP cutoff calendar date (YYYY-MM-DD) enforced at midnight in the venue timezone.'),
  rsvpGracePeriodHours: z.number().int().default(0).describe('Admin-only silent grace window in hours (0, 12, 24, 48, 72, or 168) after the midnight RSVP cutoff; omitted from public DTOs.'),
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
  modules: z.any().optional().transform((val): z.input<typeof ModuleConfigSchema> => resolveModuleConfig(val)).pipe(ModuleConfigSchema).default(DEFAULT_MODULE_CONFIG).describe('Virtual DTO feature module enablement map validated against ModuleConfigSchema with dependency resolution.'),
  features: z.union([
    z.string().transform((str) => {
      try {
        return JSON.parse(str);
      } catch (e) {
        return [];
      }
    }),
    z.any()
  ]).pipe(z.array(FeatureSchema)).describe('Ordered homepage content section definitions controlling section titles, visibility, and copy.'),
  createdAt: z.date().describe('Timestamp recording when the configuration record was initially created.'),
  updatedAt: z.date().describe('Timestamp recording when the configuration record was last modified.'),
});

export type AppConfigDTO = z.infer<typeof AppConfigSchema>;

export const PublicAppConfigSchema = z.object({
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
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic'),
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
  rsvpClosedMessage: z.string().default('').transform((val) => sanitizeRsvpClosedMessage(val)),
  modules: AppConfigSchema.shape.modules,
  features: AppConfigSchema.shape.features,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).strict();
export type PublicAppConfigDTO = z.infer<typeof PublicAppConfigSchema>;

/**
 * Derive brand monogram text based on explicit brandMonogram token or partner names initials.
 * Example: partner1Name: "Alice", partner2Name: "Bob" -> "A & B"
 */
export function deriveBrandMonogram(config: {
  brandMonogram?: string | null;
  partner1Name?: string | null;
  partner2Name?: string | null;
  brideName?: string | null;
  groomName?: string | null;
} | null | undefined): string {
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

