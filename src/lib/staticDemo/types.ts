import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { ModuleConfig } from '@/lib/modules';
import type { CustomRsvpQuestionDTO, MealOptionDTO } from '@/utils/rsvpPrompts';

interface DemoFeatureSection {
  id: string;
  type: string;
  title?: string;
  content?: string;
  visible: boolean;
}

export const STATIC_DEMO_STORAGE_KEY = 'wedding_static_demo_v2';
export const STATIC_DEMO_STORE_VERSION = 2;
export const STATIC_DEMO_BACKUP_SCHEMA_VERSION = '2.0';
export const STATIC_DEMO_MAX_STORAGE_BYTES = 1_900_000;

type DemoContributorStatus = 'RESERVED' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED';
export type DemoRsvpStatus = 'attending' | 'declined' | 'pending';

export interface DemoAppConfigRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  partner1Name: string;
  partner2Name: string;
  brideName?: string | null;
  groomName?: string | null;
  subdomain?: string | null;
  weddingDate: string;
  baseUrl: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  latitude: number;
  longitude: number;
  storyText: string;
  venueDescription: string;
  travelAdvice: string;
  heroTitle: string;
  heroSubtitle: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  contactEmail: string;
  contactPhone?: string;
  photoAlbumUrl: string;
  faviconUrl: string;
  ogImageUrl: string;
  brandMonogram?: string | null;
  brandLogoUrl?: string | null;
  brandLogoAlt?: string | null;
  heroImageUrl?: string | null;
  heroImageAlt?: string | null;
  brandWatermarkUrl?: string | null;
  brandWatermarkAlt?: string | null;
  badgeGraphicUrl?: string | null;
  badgeGraphicAlt?: string | null;
  colorPrimary: string;
  colorSecondary: string;
  themePreset: string;
  themeTokens: Record<string, unknown>;
  layoutContainerMaxWidth: string;
  layoutGridGap: string;
  layoutCardPadding: string;
  layoutBorderRadius: string;
  features: DemoFeatureSection[];
  modules: ModuleConfig;
  timezone: string;
  showCountdown: boolean;
  showAddToCalendar: boolean;
  autoApproveGuestPhotos: boolean;
  guestPhotoQrTokenVersion: number;
  setupCompleted: boolean;
  rsvpOpen: boolean;
  rsvpDeadlineDate: string;
  rsvpGracePeriodHours: number;
  rsvpClosedMessage: string;
  emailProvider: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpFrom?: string | null;
  smtpSecure?: boolean | null;
  resendFrom?: string | null;
  sendgridFrom?: string | null;
  smsProvider?: string | null;
  twilioAccountSid?: string | null;
  twilioFromNumber?: string | null;
  broadcastBatchSize: number;
  broadcastBatchDelayMs: number;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  shippingPhone: string;
  shippingDeliveryNotes: string;
  defaultPaymentHandleType: string;
  defaultPaymentHandle: string;
}

export interface DemoMediaRecord {
  id: string;
  url: string;
  altText: string | null;
  isDecorative: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoContentNodeRecord {
  id: string;
  type: string;
  tags: string[];
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type DemoSeatingTableShape =
  | 'round'
  | 'rectangular'
  | 'square'
  | 'head'
  | 'sweetheart'
  | 'dance-floor'
  | 'bar'
  | 'dj'
  | 'buffet'
  | 'cake';

export interface DemoSeatingTableRecord {
  id: string;
  name: string;
  shape: DemoSeatingTableShape;
  capacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoInvitationCodeRecord {
  id: string;
  code: string;
  guestName: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  dietaryNotes: string | null;
  plusOneAllocations: number;
  plusOneFirstName: string | null;
  plusOneLastName: string | null;
  householdName: string | null;
  partyGroup: string | null;
  partyTags: string[];
  extraFields: Record<string, unknown> | null;
  used: boolean;
  usedAt: string | null;
  tableId: string | null;
  seatNumber: number | null;
  plusOneSeatNumbers: number[];
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoWeddingPartyMemberRecord {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoId: string | null;
  side: 'BRIDE' | 'GROOM' | 'JOINT';
  link: string | null;
  order: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoAttractionRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  website: string;
  directions: string;
  latitude: number;
  longitude: number;
  imageId: string | null;
  isVisible: boolean;
  isSample: boolean;
  promoCode: string | null;
  bookingUrl: string | null;
  roomRate: string | null;
  cutoffDate: string | null;
  shuttleInfo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoRegistryItemRecord {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  imageId: string;
  quantity: number;
  itemType: 'PHYSICAL' | 'CASH_FUND' | 'EXPERIENCE_FUND';
  paymentHandleType: string | null;
  paymentHandle: string | null;
  vendorUrl: string | null;
  isGroupGift: boolean;
  isMostWanted: boolean;
  displayOrder: number;
  purchased: boolean;
  isSample: boolean;
  purchaserName: string | null;
  amountContributed: number;
  createdAt: string;
  updatedAt: string;
}

export interface DemoContributorRecord {
  id: string;
  name: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  isPlusOne: boolean;
  amount: number;
  refundedAmount: number;
  status: DemoContributorStatus;
  coverFee: boolean;
  feeAmount: number;
  date: string;
  message: string | null;
  thankYouStatus: string;
  thankYouSentAt: string | null;
  thankYouEmailSentAt: string | null;
  thankYouNote: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  transactionTimestamp: string | null;
  confirmationEmailSentAt: string | null;
  alertEmailSentAt: string | null;
  reminderEmailSentAt: string | null;
  retailerOrderNumber: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  registryItemId: string | null;
  invitationCodeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoSubEventRecord {
  id: string;
  title: string;
  description: string;
  startTime: string | null;
  endTime: string | null;
  locationName: string;
  location: string;
  attireRules?: string;
  category: string;
  isPrivate: boolean;
  mealOptions: MealOptionDTO[];
  customQuestions: CustomRsvpQuestionDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface DemoSubEventAccessRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  createdAt: string;
}

export interface DemoSubEventRsvpRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  status: DemoRsvpStatus;
  plusOneCount: number;
  dietaryNotes: string | null;
  mealSelections: string[];
  customAnswers: Record<string, unknown>;
  plusOneNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DemoBroadcastMessageRecord {
  id: string;
  channel: 'EMAIL' | 'SMS';
  subject: string | null;
  body: string;
  targetFilters: Record<string, unknown> | null;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoBroadcastRecipientRecord {
  id: string;
  broadcastId: string;
  invitationCodeId: string | null;
  guestName: string;
  destination: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoSnapshotVersionRecord {
  id: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  createdAt: string;
  author: string | null;
}

interface DemoGuestSession {
  code: string;
  guestName: string;
  sessionType: 'invite' | 'guest';
}

export interface StaticDemoSnapshot {
  storeVersion: number;
  schemaVersion: string;
  activeArchetype: ArchetypeId;
  isSetupMode: boolean;
  setupStep2Saved?: boolean;
  isAdminAuthenticated: boolean;
  guestSession: DemoGuestSession | null;
  storageWarning: string | null;
  updatedAt: string;
  appConfig: DemoAppConfigRecord[];
  contentNode: DemoContentNodeRecord[];
  media: DemoMediaRecord[];
  seatingTable: DemoSeatingTableRecord[];
  invitationCode: DemoInvitationCodeRecord[];
  weddingPartyMember: DemoWeddingPartyMemberRecord[];
  attraction: DemoAttractionRecord[];
  registryItem: DemoRegistryItemRecord[];
  contributor: DemoContributorRecord[];
  subEvent: DemoSubEventRecord[];
  subEventAccess: DemoSubEventAccessRecord[];
  subEventRsvp: DemoSubEventRsvpRecord[];
  broadcastMessage: DemoBroadcastMessageRecord[];
  broadcastRecipient: DemoBroadcastRecipientRecord[];
  snapshotVersion: DemoSnapshotVersionRecord[];
}

export interface StaticDemoStore {
  getSnapshot: () => StaticDemoSnapshot;
  mutate: <T>(updater: (_draft: StaticDemoSnapshot) => T) => T;
  replaceSnapshot: (_next: StaticDemoSnapshot) => void;
  reset: (_archetype?: ArchetypeId) => StaticDemoSnapshot;
  switchArchetype: (_archetype: ArchetypeId) => StaticDemoSnapshot;
  setSetupMode: (_enabled: boolean) => StaticDemoSnapshot;
  subscribe: (_listener: () => void) => () => void;
  getSerializedByteLength: () => number;
}

export interface NormalizedDemoRequest {
  request: Request;
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  origin: string;
}

export interface StaticDemoRouterOptions {
  store: StaticDemoStore;
  mode?: 'browser' | 'msw';
  basePath?: string;
}
