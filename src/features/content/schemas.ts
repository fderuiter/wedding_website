import { z } from 'zod';

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

export const PublicAppConfigSchema = AppConfigSchema;
export type PublicAppConfigDTO = z.infer<typeof PublicAppConfigSchema>;
