import { z } from 'zod';
import { AppConfigSchema, UpdateAppConfigSchema } from '@/features/content';
import { WeddingPartyMemberSchema } from '@/features/wedding-party';
import { AttractionSchema } from '@/features/attractions';
import { RegistryItemSchema, RegistryItemBaseSchema, ContributorSchema } from '@/features/registry';

// Helper for formatted Zod error output
export function formatZodError(error: z.ZodError): string {
  return error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
}

// AppConfig database-aligned schema
const BackupAppConfigSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Non-nullable fields with defaults (Optional but validated if present)
  brideName: AppConfigSchema.shape.brideName.optional(),
  groomName: AppConfigSchema.shape.groomName.optional(),
  weddingDate: AppConfigSchema.shape.weddingDate.optional(),
  baseUrl: UpdateAppConfigSchema.shape.baseUrl.optional(),
  venueName: AppConfigSchema.shape.venueName.optional(),
  venueAddress: AppConfigSchema.shape.venueAddress.optional(),
  venueCity: AppConfigSchema.shape.venueCity.optional(),
  venueState: AppConfigSchema.shape.venueState.optional(),
  venueZip: AppConfigSchema.shape.venueZip.optional(),
  latitude: AppConfigSchema.shape.latitude.optional(),
  longitude: AppConfigSchema.shape.longitude.optional(),
  storyText: AppConfigSchema.shape.storyText.optional(),
  venueDescription: AppConfigSchema.shape.venueDescription.optional(),
  travelAdvice: AppConfigSchema.shape.travelAdvice.optional(),
  heroTitle: AppConfigSchema.shape.heroTitle.optional(),
  heroSubtitle: AppConfigSchema.shape.heroSubtitle.optional(),
  seoTitle: AppConfigSchema.shape.seoTitle.optional(),
  seoDescription: AppConfigSchema.shape.seoDescription.optional(),
  faviconUrl: UpdateAppConfigSchema.shape.faviconUrl.optional(),
  ogImageUrl: UpdateAppConfigSchema.shape.ogImageUrl.optional(),
  seoKeywords: AppConfigSchema.shape.seoKeywords.optional(),
  colorPrimary: UpdateAppConfigSchema.shape.colorPrimary.optional(),
  colorSecondary: UpdateAppConfigSchema.shape.colorSecondary.optional(),
  features: AppConfigSchema.shape.features.optional(),
  timezone: UpdateAppConfigSchema.shape.timezone.optional(),
});

// Media database-aligned schema
const BackupMediaSchema = z.object({
  id: z.string().min(1).max(255),
  url: z.string(),
  altText: z.string().nullable().optional(),
  isDecorative: z.boolean().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// WeddingPartyMember database-aligned schema
const BackupWeddingPartyMemberSchema = z.object({
  // System-level metadata fields (Required)
  id: WeddingPartyMemberSchema.shape.id,
  createdAt: WeddingPartyMemberSchema.shape.createdAt,
  updatedAt: WeddingPartyMemberSchema.shape.updatedAt,

  // Database-required columns (No defaults, not nullable)
  name: WeddingPartyMemberSchema.shape.name,
  role: WeddingPartyMemberSchema.shape.role,
  bio: WeddingPartyMemberSchema.shape.bio,
  photoId: z.string().min(1).max(255),

  // Nullable/Optional fields
  link: WeddingPartyMemberSchema.shape.link.nullable().optional(),
  order: WeddingPartyMemberSchema.shape.order.optional(),
});

// Attraction database-aligned schema
const BackupAttractionSchema = z.object({
  // System-level metadata fields (Required)
  id: AttractionSchema.shape.id,
  createdAt: AttractionSchema.shape.createdAt,
  updatedAt: AttractionSchema.shape.updatedAt,

  // Database-required columns (No defaults, not nullable)
  name: AttractionSchema.shape.name,
  description: AttractionSchema.shape.description,
  category: AttractionSchema.shape.category,
  website: AttractionSchema.shape.website,
  directions: AttractionSchema.shape.directions,
  latitude: AttractionSchema.shape.latitude,
  longitude: AttractionSchema.shape.longitude,

  // Optional/Nullable fields
  imageId: AttractionSchema.shape.imageId,
  isVisible: AttractionSchema.shape.isVisible.optional(),
});

// RegistryItem database-aligned schema
const BackupRegistryItemSchema = z.object({
  // System-level metadata fields (Required)
  id: RegistryItemSchema.shape.id,
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: RegistryItemSchema.shape.name,
  description: RegistryItemBaseSchema.shape.description,
  category: RegistryItemSchema.shape.category,
  price: RegistryItemSchema.shape.price,
  imageId: z.string().min(1).max(255),
  quantity: RegistryItemSchema.shape.quantity,

  // Optional/Nullable fields
  vendorUrl: RegistryItemSchema.shape.vendorUrl.nullable().optional(),
  isGroupGift: RegistryItemSchema.shape.isGroupGift.optional(),
  purchased: RegistryItemSchema.shape.purchased.optional(),
  purchaserName: RegistryItemSchema.shape.purchaserName,
  amountContributed: RegistryItemSchema.shape.amountContributed.optional(),
});

// Contributor database-aligned schema
const BackupContributorSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: ContributorSchema.shape.name,

  // Optional/Nullable fields
  email: z.string().email().max(255).nullable().optional().or(z.literal('')),
  isPlusOne: z.boolean().optional(),
  amount: z.number().min(0).optional(),
  date: z.date().optional(),
  registryItemId: z.string().max(255).nullable().optional(),
});

// ContentNode database-aligned schema
const BackupContentNodeSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  type: z.string().min(1).max(255),
  tags: z.array(z.string().max(255)),
  data: z.any(),
});

// Full database backup structure schema
export const DatabaseBackupSchema = z.object({
  appConfig: z.array(BackupAppConfigSchema).optional(),
  contentNode: z.array(BackupContentNodeSchema).optional(),
  media: z.array(BackupMediaSchema).optional(),
  weddingPartyMember: z.array(BackupWeddingPartyMemberSchema).optional(),
  attraction: z.array(BackupAttractionSchema).optional(),
  registryItem: z.array(BackupRegistryItemSchema).optional(),
  contributor: z.array(BackupContributorSchema).optional(),
});
