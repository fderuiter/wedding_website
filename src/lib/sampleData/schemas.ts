import { z } from 'zod';
import {
  isSafeConfigAssetUrl,
  isSafeMediaOrPhotoUrl,
  sanitizeUrl,
} from '@/utils/validationPrimitives';

export const ArchetypeIdSchema = z.enum(['classic', 'destination', 'romantic']);

export const SampleDataGenerateSchema = z.object({
  archetype: ArchetypeIdSchema.optional().default('classic'),
  modules: z.array(z.string()).optional(),
});

const safeHttpOrRelativeUrlSchema = z
  .string()
  .max(2000)
  .refine((val) => val === '' || sanitizeUrl(val) !== undefined, {
    message: 'Must be a valid http, https, or relative URL',
  });

const safeAssetPathSchema = z
  .string()
  .max(2000)
  .refine(isSafeConfigAssetUrl, {
    message: 'Must be a valid config asset URL',
  });

const safeMediaUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(isSafeMediaOrPhotoUrl, {
    message: 'Must be a valid media or photo URL',
  });

const SampleContributorPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  email: z.email(),
  amount: z.number().positive(),
  status: z.enum(['RESERVED', 'CONFIRMED', 'CANCELLED', 'REFUNDED']).default('CONFIRMED'),
  message: z.string().max(1000).optional(),
  date: z.string().min(1),
  guestCode: z.string().optional(),
  thankYouStatus: z.enum(['Unsent', 'Sent', 'Not Needed']).default('Unsent'),
  retailerOrderNumber: z.string().max(120).optional(),
  carrier: z.string().max(100).optional(),
  trackingNumber: z.string().max(120).optional(),
});

const SampleRegistryPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(2000),
  category: z.string().min(1).max(255),
  price: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  itemType: z.enum(['PHYSICAL', 'CASH_FUND', 'EXPERIENCE_FUND']).default('PHYSICAL'),
  isGroupGift: z.boolean().default(false),
  isMostWanted: z.boolean().default(false),
  vendorUrl: safeHttpOrRelativeUrlSchema.optional(),
  paymentHandleType: z.string().max(100).optional(),
  paymentHandle: z.string().max(255).optional(),
  imageUrl: safeMediaUrlSchema,
  imageAlt: z.string().min(1).max(500),
  contributors: z.array(SampleContributorPresetSchema).default([]),
});

const SampleGuestPresetSchema = z.object({
  id: z.string().min(1),
  guestName: z.string().min(1).max(120),
  code: z.string().min(1).max(64),
  email: z.email().optional(),
  householdName: z.string().min(1).max(120),
  partyGroup: z.string().min(1).max(120),
  partyTags: z.array(z.string().min(1)),
  plusOnesAllowed: z.number().int().min(0).default(0),
  plusOneFirstName: z.string().max(80).optional(),
  plusOneLastName: z.string().max(80).optional(),
  plusOneNames: z.array(z.string().min(1)).optional(),
  dietaryNotes: z.string().max(500).optional(),
  addressLine1: z.string().max(255).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  zipCode: z.string().max(40).optional(),
  country: z.string().max(120).optional(),
  seatTableName: z.string().optional(),
  seatNumber: z.number().int().positive().optional(),
});

const SampleSeatingPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  shape: z.enum(['round', 'rectangular']),
  capacity: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
});

const SampleWeddingPartyPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  bio: z.string().min(1).max(1000),
  side: z.enum(['BRIDE', 'GROOM', 'JOINT']),
  order: z.number().int().positive(),
  imageUrl: safeMediaUrlSchema,
  imageAlt: z.string().min(1).max(500),
});

const SampleAttractionPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(120),
  website: safeHttpOrRelativeUrlSchema,
  directions: z.string().min(1).max(500),
  latitude: z.number(),
  longitude: z.number(),
  promoCode: z.string().max(100).optional(),
  bookingUrl: safeHttpOrRelativeUrlSchema.optional(),
  roomRate: z.string().max(100).optional(),
  cutoffDate: z.string().max(120).optional(),
  shuttleInfo: z.string().max(1000).optional(),
  imageUrl: safeMediaUrlSchema,
  imageAlt: z.string().min(1).max(500),
});

const SampleFaqPresetSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(2000),
  category: z.string().min(1).max(120),
  categoryTags: z.array(z.string().min(1)),
  keywords: z.array(z.string().min(1)),
});

const SampleLogisticsPresetSchema = z.object({
  id: z.string().min(1),
  tags: z.array(z.string().min(1)).default(['Homepage', 'Logistics']),
  title: z.string().optional(),
  description: z.string().optional(),
  ceremonyTitle: z.string().optional(),
  ceremonyTime: z.string().optional(),
  receptionTitle: z.string().optional(),
  receptionTime: z.string().optional(),
  receptionDetails: z.string().optional(),
  receptionAttire: z.string().optional(),
  locationName: z.string().optional(),
});

const SamplePhotoPresetSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['curated', 'guest-upload']),
  status: z.enum(['APPROVED', 'PENDING', 'REJECTED']).default('APPROVED'),
  isVisible: z.boolean().default(true),
  url: safeMediaUrlSchema,
  title: z.string().min(1).max(255),
  caption: z.string().max(1000),
  altText: z.string().min(1).max(500),
  category: z.string().max(120).optional(),
  uploaderName: z.string().max(120).optional(),
  uploaderEmail: z.email().optional(),
  createdAt: z.string().min(1),
});

const SampleMealOptionPresetSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  dietaryTags: z.array(z.string().min(1).max(60)).default([]),
});

const SampleCustomQuestionPresetSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: z.string().min(1).max(300),
  type: z.enum(['text', 'choice']).default('text'),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(160)).default([]),
});

const SampleSubEventRsvpPresetSchema = z.object({
  id: z.string().min(1),
  guestCode: z.string().min(1),
  status: z.enum(['attending', 'declined', 'pending']),
  plusOneCount: z.number().int().min(0).default(0),
  plusOneNames: z.array(z.string().min(1)).default([]),
  mealSelections: z.array(z.string().min(1)).default([]),
  dietaryNotes: z.string().max(500).default(''),
  customAnswers: z.record(z.string(), z.string()).default({}),
});

const SampleSubEventPresetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  locationName: z.string().min(1).max(200),
  location: z.string().max(300).default(''),
  category: z.string().min(1).max(100),
  attireRules: z.string().max(300).optional(),
  isPrivate: z.boolean().default(false),
  allowedGuestCodes: z.array(z.string().min(1)).default([]),
  mealOptions: z.array(SampleMealOptionPresetSchema).default([]),
  customQuestions: z.array(SampleCustomQuestionPresetSchema).default([]),
  rsvps: z.array(SampleSubEventRsvpPresetSchema).default([]),
});

const SampleSiteConfigPresetSchema = z.object({
  partner1Name: z.string().min(1),
  partner2Name: z.string().min(1),
  weddingDate: z.string().min(1),
  baseUrl: z.url(),
  venueName: z.string().min(1),
  venueAddress: z.string().min(1),
  venueCity: z.string().min(1),
  venueState: z.string().min(1),
  venueZip: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  storyText: z.string().min(1),
  venueDescription: z.string().min(1),
  travelAdvice: z.string().min(1),
  heroTitle: z.string().min(1),
  heroSubtitle: z.string().min(1),
  seoTitle: z.string().min(1),
  seoDescription: z.string().min(1),
  contactEmail: z.email(),
  faviconUrl: safeAssetPathSchema.default('/assets/favicon.png'),
  ogImageUrl: safeAssetPathSchema.default('/images/sunset-embrace.jpg'),
  heroImageUrl: safeAssetPathSchema.default('/images/sunset-embrace.jpg'),
  heroImageAlt: z.string().min(1),
  colorPrimary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  colorSecondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  themePreset: z.enum(['classic', 'modern', 'romantic', 'minimal', 'editorial']),
  timezone: z.string().min(1),
  shippingRecipientName: z.string().min(1).max(255),
  shippingAddressLine1: z.string().min(1).max(255),
  shippingAddressLine2: z.string().max(255).default(''),
  shippingCity: z.string().min(1).max(120),
  shippingState: z.string().min(1).max(120),
  shippingZip: z.string().min(1).max(40),
  shippingCountry: z.string().min(1).max(120),
  shippingPhone: z.string().min(1).max(60),
  shippingDeliveryNotes: z.string().max(1000).default(''),
  defaultPaymentHandleType: z.string().min(1).max(100),
  defaultPaymentHandle: z.string().min(1).max(255),
});

export const ArchetypePresetSchema = z.object({
  id: ArchetypeIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  siteConfig: SampleSiteConfigPresetSchema,
  registryItems: z.array(SampleRegistryPresetSchema).min(1),
  guests: z.array(SampleGuestPresetSchema).min(1),
  seatingTables: z.array(SampleSeatingPresetSchema).min(1),
  weddingParty: z.array(SampleWeddingPartyPresetSchema).min(1),
  attractions: z.array(SampleAttractionPresetSchema).min(1),
  faqs: z.array(SampleFaqPresetSchema).min(1),
  logistics: z.array(SampleLogisticsPresetSchema).min(1),
  photos: z.array(SamplePhotoPresetSchema).min(1),
  subEvents: z.array(SampleSubEventPresetSchema).min(1),
});
