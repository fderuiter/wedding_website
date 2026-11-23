import { z } from 'zod';
import {
  AppConfigSchema,
  FeatureSchema,
  PhotoDataSchema,
  RawUpdateAppConfigSchema,
} from '@/features/content';
import { ModuleConfigSchema, resolveModuleConfig } from '@/lib/modules';
import { isSafeMediaOrPhotoUrl } from '@/utils/validationPrimitives';
import { WeddingPartyMemberSchema } from '@/features/wedding-party';
import { AttractionSchema } from '@/features/attractions';
import {
  RegistryItemSchema,
  RegistryItemBaseSchema,
  ContributorSchema,
} from '@/features/registry';

export interface PathDiagnostic {
  path: string;
  message: string;
}

export function formatZodIssues(error: z.ZodError): PathDiagnostic[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
}

const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function reviveDates(root: any): any {
  if (root === null || root === undefined) return root;
  if (typeof root === 'string' && ISO_DATE_REGEX.test(root)) {
    return new Date(root);
  }
  if (typeof root !== 'object') {
    return root;
  }

  const stack: any[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === null || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        const val = current[i];
        if (typeof val === 'string' && ISO_DATE_REGEX.test(val)) {
          current[i] = new Date(val);
        } else if (val !== null && typeof val === 'object') {
          stack.push(val);
        }
      }
    } else {
      for (const key of Object.keys(current)) {
        const val = current[key];
        if (typeof val === 'string' && ISO_DATE_REGEX.test(val)) {
          current[key] = new Date(val);
        } else if (val !== null && typeof val === 'object') {
          stack.push(val);
        }
      }
    }
  }

  return root;
}

// AppConfig database-aligned schema (unknown/virtual DTO keys are stripped automatically by z.object)
export const BackupAppConfigSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Core identity, venue, content, branding, and SEO columns
  partner1Name: z.string().optional(),
  partner2Name: z.string().optional(),
  brideName: z.string().nullable().optional(),
  groomName: z.string().nullable().optional(),
  subdomain: z.string().max(255).nullable().optional(),
  weddingDate: AppConfigSchema.shape.weddingDate.optional(),
  baseUrl: RawUpdateAppConfigSchema.shape.baseUrl.optional(),
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
  contactEmail: RawUpdateAppConfigSchema.shape.contactEmail.optional(),
  photoAlbumUrl: RawUpdateAppConfigSchema.shape.photoAlbumUrl.optional(),
  autoApproveGuestPhotos: z.boolean().optional(),
  guestPhotoQrTokenVersion: z.number().int().min(1).optional(),
  faviconUrl: RawUpdateAppConfigSchema.shape.faviconUrl.optional(),
  ogImageUrl: RawUpdateAppConfigSchema.shape.ogImageUrl.optional(),
  brandMonogram: z.string().nullable().optional(),
  brandLogoUrl: RawUpdateAppConfigSchema.shape.brandLogoUrl,
  brandLogoAlt: z.string().nullable().optional(),
  heroImageUrl: RawUpdateAppConfigSchema.shape.heroImageUrl,
  heroImageAlt: z.string().nullable().optional(),
  brandWatermarkUrl: RawUpdateAppConfigSchema.shape.brandWatermarkUrl,
  brandWatermarkAlt: z.string().nullable().optional(),
  badgeGraphicUrl: RawUpdateAppConfigSchema.shape.badgeGraphicUrl,
  badgeGraphicAlt: z.string().nullable().optional(),
  seoKeywords: AppConfigSchema.shape.seoKeywords.optional(),

  // Theme, layout, feature, and calendar columns
  colorPrimary: RawUpdateAppConfigSchema.shape.colorPrimary.optional(),
  colorSecondary: RawUpdateAppConfigSchema.shape.colorSecondary.optional(),
  themePreset: z.string().max(100).optional(),
  themeTokens: z.record(z.string(), z.unknown()).nullable().optional(),
  layoutContainerMaxWidth: z.string().max(100).optional(),
  layoutGridGap: z.string().max(100).optional(),
  layoutCardPadding: z.string().max(100).optional(),
  layoutBorderRadius: z.string().max(100).optional(),
  features: z.array(FeatureSchema).optional(),
  modules: ModuleConfigSchema.partial()
    .optional()
    .transform((val) =>
      val === undefined ? undefined : resolveModuleConfig(val),
    ),
  timezone: RawUpdateAppConfigSchema.shape.timezone.optional(),
  showCountdown: z.boolean().optional(),
  showAddToCalendar: z.boolean().optional(),
  rsvpOpen: z.boolean().optional(),
  rsvpDeadlineDate: RawUpdateAppConfigSchema.shape.rsvpDeadlineDate,
  rsvpGracePeriodHours: RawUpdateAppConfigSchema.shape.rsvpGracePeriodHours,
  rsvpClosedMessage: RawUpdateAppConfigSchema.shape.rsvpClosedMessage,

  // Non-secret delivery & broadcast configuration columns
  emailProvider: z.string().max(100).optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  smtpFrom: z.string().max(255).nullable().optional(),
  smtpSecure: z.boolean().nullable().optional(),
  resendFrom: z.string().max(255).nullable().optional(),
  sendgridFrom: z.string().max(255).nullable().optional(),
  smsProvider: z.string().max(100).nullable().optional(),
  twilioAccountSid: z.string().max(255).nullable().optional(),
  twilioFromNumber: z.string().max(100).nullable().optional(),
  broadcastBatchSize: z.number().int().min(1).max(10000).optional(),
  broadcastBatchDelayMs: z.number().int().min(0).max(3600000).optional(),
  shippingRecipientName: z.string().max(255).optional(),
  shippingAddressLine1: z.string().max(255).optional(),
  shippingAddressLine2: z.string().max(255).optional(),
  shippingCity: z.string().max(120).optional(),
  shippingState: z.string().max(120).optional(),
  shippingZip: z.string().max(40).optional(),
  shippingCountry: z.string().max(120).optional(),
  shippingPhone: z.string().max(60).optional(),
  shippingDeliveryNotes: z.string().max(1000).optional(),
  defaultPaymentHandleType: z.string().max(100).optional(),
  defaultPaymentHandle: z.string().max(255).optional(),

  // Optional provider credentials (omitted on export; preserved from live DB if omitted/blank on import)
  smtpPass: z.string().nullable().optional(),
  resendApiKey: z.string().nullable().optional(),
  sendgridApiKey: z.string().nullable().optional(),
  twilioAuthToken: z.string().nullable().optional(),
});

// Media database-aligned schema
const BackupMediaSchema = z.object({
  id: z.string().min(1).max(255),
  url: z
    .string()
    .refine(isSafeMediaOrPhotoUrl, { message: 'Invalid media URL format' }),
  altText: z.string().nullable().optional(),
  isDecorative: z.boolean().optional(),
  isSample: z.boolean().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// WeddingPartyMember database-aligned schema
const BackupWeddingPartyMemberSchema = z.object({
  // System-level metadata fields (Required)
  id: WeddingPartyMemberSchema.shape.id,
  createdAt: WeddingPartyMemberSchema.shape.createdAt,
  updatedAt: WeddingPartyMemberSchema.shape.updatedAt,

  // Database-required columns
  name: WeddingPartyMemberSchema.shape.name,
  role: WeddingPartyMemberSchema.shape.role,
  bio: WeddingPartyMemberSchema.shape.bio,

  // Nullable/Optional fields
  photoId: z.string().min(1).max(255).nullable().optional(),
  side: WeddingPartyMemberSchema.shape.side.optional(),
  link: WeddingPartyMemberSchema.shape.link.nullable().optional(),
  order: WeddingPartyMemberSchema.shape.order.optional(),
  isSample: z.boolean().optional(),
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
  isSample: z.boolean().optional(),
  promoCode: AttractionSchema.shape.promoCode,
  bookingUrl: AttractionSchema.shape.bookingUrl,
  roomRate: AttractionSchema.shape.roomRate,
  cutoffDate: z.union([z.date(), z.string()]).nullable().optional(),
  shuttleInfo: AttractionSchema.shape.shuttleInfo,
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
  itemType: z.string().max(100).optional(),
  paymentHandleType: RegistryItemSchema.shape.paymentHandleType
    .nullable()
    .optional(),
  paymentHandle: RegistryItemSchema.shape.paymentHandle.nullable().optional(),
  vendorUrl: RegistryItemSchema.shape.vendorUrl.nullable().optional(),
  isGroupGift: RegistryItemSchema.shape.isGroupGift.optional(),
  isMostWanted: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
  purchased: z.boolean().optional(),
  isSample: z.boolean().optional(),
  purchaserName: RegistryItemSchema.shape.purchaserName,
  amountContributed: z.number().min(0).optional(),
});

// Contributor database-aligned schema
export const BackupContributorSchema = z.object({
  // System-level metadata fields (Required)
  id: z.string().min(1).max(255),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Database-required columns (No defaults, not nullable)
  name: ContributorSchema.shape.name,

  // Optional/Nullable fields
  email: z.email().max(255).nullable().optional().or(z.literal('')),
  isPlusOne: z.boolean().optional(),
  amount: z.number().min(0).optional(),
  refundedAmount: z.number().min(0).optional(),
  status: z.enum(['RESERVED', 'CONFIRMED', 'CANCELLED', 'REFUNDED']).optional(),
  coverFee: z.boolean().optional(),
  feeAmount: z.number().min(0).optional(),
  date: z.date().optional(),
  message: z.string().nullable().optional(),
  thankYouStatus: z.string().max(100).optional(),
  thankYouSentAt: z.date().nullable().optional(),
  thankYouNote: z.string().nullable().optional(),
  stripePaymentIntentId: z.string().max(255).nullable().optional(),
  stripeChargeId: z.string().max(255).nullable().optional(),
  transactionTimestamp: z.date().nullable().optional(),
  confirmationEmailSentAt: z.date().nullable().optional(),
  alertEmailSentAt: z.date().nullable().optional(),
  reminderEmailSentAt: z.date().nullable().optional(),
  retailerOrderNumber: z.string().max(120).nullable().optional(),
  carrier: z.string().max(100).nullable().optional(),
  trackingNumber: z.string().max(120).nullable().optional(),
  registryItemId: z.string().max(255).nullable().optional(),
  invitationCodeId: z.string().max(255).nullable().optional(),
});

// ContentNode database-aligned schema
const BackupContentNodeSchema = z
  .object({
    // System-level metadata fields (Required)
    id: z.string().min(1).max(255),
    createdAt: z.date(),
    updatedAt: z.date(),

    // Database-required columns (No defaults, not nullable)
    type: z.string().min(1).max(255),
    tags: z.array(z.string().max(255)),
    data: z.record(z.string(), z.unknown()),
  })
  .superRefine((node, ctx) => {
    if (node.type === 'Photo') {
      if (
        !node.data ||
        typeof node.data !== 'object' ||
        Array.isArray(node.data)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Photo node data must be an object',
        });
        return;
      }
      const parsed = PhotoDataSchema.safeParse(node.data);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['data', ...issue.path],
            message: issue.message,
          });
        }
      }
    } else if (
      node.data &&
      typeof node.data === 'object' &&
      !Array.isArray(node.data) &&
      typeof node.data.url === 'string' &&
      !isSafeMediaOrPhotoUrl(node.data.url)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['data', 'url'],
        message: 'Invalid URL format',
      });
    }
  });

// SeatingTable database-aligned schema
const BackupSeatingTableSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  shape: z.string().max(100).optional(),
  capacity: z.number().int().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  isSample: z.boolean().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
});

// InvitationCode database-aligned schema
const BackupInvitationCodeSchema = z.object({
  id: z.string().min(1).max(255),
  code: z.string().min(1).max(255),
  guestName: z.string(),
  email: z.string().max(255).nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  dietaryNotes: z.string().nullable().optional(),
  plusOneAllocations: z.number().int().min(0).nullable().optional(),
  plusOneFirstName: z.string().nullable().optional(),
  plusOneLastName: z.string().nullable().optional(),
  householdName: z.string().nullable().optional(),
  partyGroup: z.string().nullable().optional(),
  partyTags: z.array(z.string()).optional(),
  extraFields: z.record(z.string(), z.unknown()).nullable().optional(),
  used: z.boolean().optional(),
  usedAt: z.date().nullable().optional(),
  tableId: z.string().max(255).nullable().optional(),
  seatNumber: z.number().int().nullable().optional(),
  isSample: z.boolean().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// SubEvent database-aligned schema
const BackupSubEventSchema = z.object({
  id: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  startTime: z.date().nullable().optional(),
  endTime: z.date().nullable().optional(),
  locationName: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  isPrivate: z.boolean().optional(),
  mealOptions: z.array(z.unknown()).optional(),
  customQuestions: z.array(z.unknown()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// SubEventAccess database-aligned schema
const BackupSubEventAccessSchema = z.object({
  id: z.string().min(1).max(255),
  subEventId: z.string().min(1).max(255),
  invitationCodeId: z.string().min(1).max(255),
  createdAt: z.date().optional(),
});

// SubEventRsvp database-aligned schema
const BackupSubEventRsvpSchema = z.object({
  id: z.string().min(1).max(255),
  subEventId: z.string().min(1).max(255),
  invitationCodeId: z.string().min(1).max(255),
  status: z.string().min(1).max(100).optional(),
  plusOneCount: z.number().int().min(0).optional(),
  dietaryNotes: z.string().nullable().optional(),
  mealSelections: z.array(z.string()).optional(),
  customAnswers: z.record(z.string(), z.unknown()).optional(),
  plusOneNames: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// BroadcastMessage database-aligned schema
const BackupBroadcastMessageSchema = z.object({
  id: z.string().min(1).max(255),
  channel: z.string().min(1).max(100),
  subject: z.string().nullable().optional(),
  body: z.string(),
  targetFilters: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string().min(1).max(100).optional(),
  totalRecipients: z.number().int().min(0).optional(),
  sentCount: z.number().int().min(0).optional(),
  failedCount: z.number().int().min(0).optional(),
  scheduledFor: z.date().nullable().optional(),
  sentAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// BroadcastRecipient database-aligned schema
const BackupBroadcastRecipientSchema = z.object({
  id: z.string().min(1).max(255),
  broadcastId: z.string().min(1).max(255),
  invitationCodeId: z.string().max(255).nullable().optional(),
  guestName: z.string(),
  destination: z.string().min(1),
  status: z.string().min(1).max(100).optional(),
  error: z.string().nullable().optional(),
  sentAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// SnapshotVersion database-aligned schema
const BackupSnapshotVersionSchema = z.object({
  id: z.string().min(1).max(255),
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  author: z.string().max(255).nullable().optional(),
});

// Full database backup structure schema across all 15 Prisma models
export const DatabaseBackupSchema = z.object({
  version: z.string().optional(),
  schemaVersion: z.string().optional(),
  exportedAt: z.union([z.string(), z.date()]).optional(),
  appConfig: z.array(BackupAppConfigSchema),
  contentNode: z.array(BackupContentNodeSchema).optional(),
  media: z.array(BackupMediaSchema).optional(),
  seatingTable: z.array(BackupSeatingTableSchema).optional(),
  invitationCode: z.array(BackupInvitationCodeSchema).optional(),
  weddingPartyMember: z.array(BackupWeddingPartyMemberSchema).optional(),
  attraction: z.array(BackupAttractionSchema).optional(),
  registryItem: z.array(BackupRegistryItemSchema),
  contributor: z.array(BackupContributorSchema).optional(),
  subEvent: z.array(BackupSubEventSchema).optional(),
  subEventAccess: z.array(BackupSubEventAccessSchema).optional(),
  subEventRsvp: z.array(BackupSubEventRsvpSchema).optional(),
  broadcastMessage: z.array(BackupBroadcastMessageSchema).optional(),
  broadcastRecipient: z.array(BackupBroadcastRecipientSchema).optional(),
  snapshotVersion: z.array(BackupSnapshotVersionSchema).optional(),
});
