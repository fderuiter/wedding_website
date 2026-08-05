import { z } from 'zod';

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
  brideName: z.string().max(255).optional(),
  groomName: z.string().max(255).optional(),
  weddingDate: z.date().optional(),
  baseUrl: z.string().max(2000).optional(),
  venueName: z.string().max(255).optional(),
  venueAddress: z.string().max(255).optional(),
  venueCity: z.string().max(255).optional(),
  venueState: z.string().max(255).optional(),
  venueZip: z.string().max(50).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  storyText: z.string().max(10000).optional(),
  venueDescription: z.string().max(10000).optional(),
  travelAdvice: z.string().max(10000).optional(),
  heroTitle: z.string().max(255).optional(),
  heroSubtitle: z.string().max(255).optional(),
  seoTitle: z.string().max(255).optional(),
  seoDescription: z.string().max(1000).optional(),
  faviconUrl: z.string().max(2000).optional(),
  ogImageUrl: z.string().max(2000).optional(),
  seoKeywords: z.string().max(2000).optional(),
  colorPrimary: z.string().max(50).optional(),
  colorSecondary: z.string().max(50).optional(),
  features: z.any().optional(),
  timezone: z.string().max(255).optional(),
});

// WeddingPartyMember database-aligned schema
const BackupWeddingPartyMemberSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: z.string().min(1).max(255),
  role: z.string().min(1).max(255),
  bio: z.string().max(5000),
  photoId: z.string().min(1).max(255),

  // Nullable/Optional fields
  link: z.string().max(2000).nullable().optional().or(z.literal('')),
  order: z.number().int().optional(),
});

// Attraction database-aligned schema
const BackupAttractionSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: z.string().min(1).max(255),
  description: z.string().max(5000),
  category: z.string().min(1).max(255),
  website: z.string().max(2000).or(z.literal('')),
  directions: z.string().max(5000),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),

  // Optional/Nullable fields
  imageId: z.string().max(255).nullable().optional(),
  isVisible: z.boolean().optional(),
});

// RegistryItem database-aligned schema
const BackupRegistryItemSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: z.string().min(1).max(255),
  description: z.string().max(5000),
  category: z.string().min(1).max(255),
  price: z.number().min(0),
  imageId: z.string().min(1).max(255),
  quantity: z.number().int().min(0),

  // Optional/Nullable fields
  vendorUrl: z.string().max(2000).nullable().optional().or(z.literal('')),
  isGroupGift: z.boolean().optional(),
  purchased: z.boolean().optional(),
  purchaserName: z.string().max(255).nullable().optional().or(z.literal('')),
  amountContributed: z.number().min(0).optional(),
});

// Contributor database-aligned schema
const BackupContributorSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: z.string().min(1).max(255),

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
  weddingPartyMember: z.array(BackupWeddingPartyMemberSchema).optional(),
  attraction: z.array(BackupAttractionSchema).optional(),
  registryItem: z.array(BackupRegistryItemSchema).optional(),
  contributor: z.array(BackupContributorSchema).optional(),
});
