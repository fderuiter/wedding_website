import { z } from 'zod';
import { coordinateSchema } from '@/utils/validation';
import { ModuleConfigSchema, resolveModuleConfig, DEFAULT_MODULE_CONFIG } from '@/lib/modules';

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;
export const layoutTokenSchema = z.string().regex(layoutTokenRegex, 'Invalid CSS length unit format.');

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
  baseUrl: z.string().url('Invalid URL format').or(z.literal('')),
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
  faviconUrl: z.string().refine(val => val === '' || val.startsWith('/') || val.startsWith('http'), { message: 'Invalid URL format' }),
  ogImageUrl: z.string().refine(val => val === '' || val.startsWith('/') || val.startsWith('http'), { message: 'Invalid URL format' }),
  seoKeywords: z.string(),
  colorPrimary: z.string().regex(hexColorRegex).optional(),
  colorSecondary: z.string().regex(hexColorRegex).optional(),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic'),
  layoutContainerMaxWidth: layoutTokenSchema.optional(),
  layoutGridGap: layoutTokenSchema.optional(),
  layoutCardPadding: layoutTokenSchema.optional(),
  layoutBorderRadius: layoutTokenSchema.optional(),
  showCountdown: z.boolean().optional(),
  showAddToCalendar: z.boolean().optional(),
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
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Invalid hex color format for ${key}. Must be a valid hex code (e.g. #RRGGBB).`,
        });
      }
    }
  }
});

export const UpdateAppConfigSchema = RawUpdateAppConfigSchema.transform((data) => {
  const partner1Name = data.partner1Name ?? data.brideName ?? '';
  const partner2Name = data.partner2Name ?? data.groomName ?? '';
  return {
    ...data,
    partner1Name,
    partner2Name,
    brideName: data.brideName ?? partner1Name,
    groomName: data.groomName ?? partner2Name,
  };
});

const BaseContentNode = z.object({
  id: z.string(),
  tags: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const isoTimestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

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
  categoryTags: z.array(z.string()).optional().default([]),
  category: z.string().optional(),
  locationName: z.string().optional(),
  location: z.string().optional(),
  attireRules: z.string().optional(),
  attire: z.string().optional(),
  description: z.string().optional(),
}).passthrough().superRefine((val, ctx) => {
  if (val.startTime && val.endTime) {
    const start = new Date(val.startTime).getTime();
    const end = new Date(val.endTime).getTime();
    if (!isNaN(start) && !isNaN(end) && end < start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
  }),
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
  }).passthrough(),
});

export const GenericNodeSchema = BaseContentNode.extend({
  type: z.string(),
  data: z.any(),
});

export const ContentNodeSchema = z.union([FAQNodeSchema, LogisticsNodeSchema, ScheduleNodeSchema, GenericNodeSchema]);

export type ContentNodeDTO = z.infer<typeof ContentNodeSchema>;

const FeatureSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  visible: z.boolean().default(true),
  content: z.string().optional(),
});

export const AppConfigSchema = z.object({
  id: z.string(),
  subdomain: z.string().nullable().optional(),
  multisiteEnabled: z.boolean().optional(),
  partner1Name: z.string().default(''),
  partner2Name: z.string().default(''),
  brideName: z.string().nullable().optional(),
  groomName: z.string().nullable().optional(),
  weddingDate: z.date(),
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
  faviconUrl: z.string(),
  ogImageUrl: z.string(),
  seoKeywords: z.string(),
  colorPrimary: z.string().default('#B91C1C'),
  colorSecondary: z.string().default('#B45309'),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']).default('classic'),
  layoutContainerMaxWidth: layoutTokenSchema.optional().default('64rem'),
  layoutGridGap: layoutTokenSchema.optional().default('1.5rem'),
  layoutCardPadding: layoutTokenSchema.optional().default('2rem'),
  layoutBorderRadius: layoutTokenSchema.optional().default('1rem'),
  timezone: z.string().default('America/Chicago'),
  showCountdown: z.boolean().default(true),
  showAddToCalendar: z.boolean().default(true),
  modules: z.any().optional().transform((val) => resolveModuleConfig(val)).default(DEFAULT_MODULE_CONFIG),
  features: z.union([
    z.string().transform((str) => {
      try {
        return JSON.parse(str);
      } catch (e) {
        return [];
      }
    }),
    z.any()
  ]).pipe(z.array(FeatureSchema)),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AppConfigDTO = z.infer<typeof AppConfigSchema>;

const PublicAppConfigSchema = AppConfigSchema;
export type PublicAppConfigDTO = z.infer<typeof PublicAppConfigSchema>;
