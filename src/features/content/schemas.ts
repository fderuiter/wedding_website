import { z } from 'zod';
import { coordinateSchema } from '@/utils/validation';

export const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;

export const UpdateAppConfigSchema = z.object({
  brideName: z.string(),
  groomName: z.string(),
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

const BaseContentNode = z.object({
  id: z.string(),
  tags: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
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
  }).passthrough(),
});

export const GenericNodeSchema = BaseContentNode.extend({
  type: z.string(),
  data: z.any(),
});

export const ContentNodeSchema = z.union([FAQNodeSchema, LogisticsNodeSchema, GenericNodeSchema]);

export type ContentNodeDTO = z.infer<typeof ContentNodeSchema>;

export const FeatureSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  visible: z.boolean().default(true),
  content: z.string().optional(),
});

export const AppConfigSchema = z.object({
  id: z.string(),
  brideName: z.string(),
  groomName: z.string(),
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
  showCountdown: z.boolean().default(true),
  showAddToCalendar: z.boolean().default(true),
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
