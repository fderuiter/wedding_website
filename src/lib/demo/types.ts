import type { PublicAppConfig } from '@/lib/config';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { RegistryItem } from '@/features/registry';

interface DemoFeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface DemoSiteSection {
  id: string;
  type: string;
  title: string;
  visible: boolean;
  content?: string;
}

export interface DemoConfig extends PublicAppConfig {
  baseUrl: string;
  rsvpOpen: boolean;
  rsvpDeadlineDate: string;
  rsvpClosedMessage: string;
  defaultPaymentHandle: string;
  defaultPaymentHandleType: string;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  moduleToggles: DemoFeatureFlag[];
  siteSections: DemoSiteSection[];
}

interface DemoMealOption {
  id: string;
  label: string;
  description?: string;
  dietaryTags: string[];
}

interface DemoCustomQuestion {
  id: string;
  prompt: string;
  type: 'text' | 'choice';
  required?: boolean;
  options?: string[];
}

export interface DemoSubEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  address: string;
  startTime: string;
  endTime: string;
  dressCode: string;
  isPrivate: boolean;
  rsvpEnabled: boolean;
  mealOptions: DemoMealOption[];
  customQuestions: DemoCustomQuestion[];
  displayOrder: number;
  isSample?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoSubEventRsvp {
  id: string;
  invitationCodeId: string;
  subEventId: string;
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  plusOneNames: string[];
  mealSelections: string[];
  dietaryNotes: string | null;
  customAnswers: Record<string, string>;
  updatedAt: string;
}

export interface DemoInvitationCode {
  id: string;
  code: string;
  guestName: string;
  email: string | null;
  householdName: string | null;
  partyGroup: string | null;
  partyTags: string[];
  used: boolean;
  plusOneAllocations: number;
  plusOneFirstName: string | null;
  plusOneLastName: string | null;
  dietaryNotes: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  addressUpdatedAt: string | null;
  tableId: string | null;
  seatNumber: number | null;
  plusOneSeatNumbers?: number[];
  allowedSubEventIds: string[];
  extraFields: Record<string, unknown>;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoSeatingTable {
  id: string;
  name: string;
  shape:
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

export interface DemoWeddingPartyMember {
  id: string;
  name: string;
  role: string;
  side: string;
  bio: string;
  imageUrl: string;
  imageAlt: string;
  order: number;
  displayOrder: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoAttraction {
  id: string;
  name: string;
  description: string;
  category: string;
  website: string;
  directions: string;
  latitude: number;
  longitude: number;
  promoCode?: string | null;
  roomRate?: string | null;
  address?: string | null;
  displayOrder: number;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoContentNode {
  id: string;
  slug: string;
  type: 'FAQ' | 'PHOTO' | 'PAGE' | 'ANNOUNCEMENT';
  tags: string[];
  isPublished: boolean;
  data: Record<string, unknown>;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoMediaItem {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  altText: string;
  caption?: string;
  category?: string;
  isDecorative: boolean;
  uploaderName?: string;
  moderationStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  createdAt: string;
  updatedAt: string;
}

export interface DemoVersionRecord {
  id: string;
  entityType: string;
  entityId: string;
  versionNumber: number;
  author: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface DemoBroadcastRecord {
  id: string;
  channel: 'EMAIL' | 'SMS';
  subject: string | null;
  body: string;
  audienceLabel?: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  recipients: Array<{
    id: string;
    invitationCodeId?: string | null;
    guestName: string;
    destination: string;
    status: string;
    error?: string | null;
    sentAt?: string | null;
  }>;
}

interface DemoGuestSession {
  invitationCodeId: string;
  code: string;
  guestName: string;
  email: string | null;
}

export interface DemoState {
  schemaVersion: number;
  isAdmin: boolean;
  setupWizardPreview: boolean;
  activeArchetype: ArchetypeId | null;
  guestSession: DemoGuestSession;
  config: DemoConfig;
  registryItems: RegistryItem[];
  invitationCodes: DemoInvitationCode[];
  subEvents: DemoSubEvent[];
  subEventRsvps: DemoSubEventRsvp[];
  seatingTables: DemoSeatingTable[];
  weddingParty: DemoWeddingPartyMember[];
  attractions: DemoAttraction[];
  contentNodes: DemoContentNode[];
  mediaItems: DemoMediaItem[];
  versions: DemoVersionRecord[];
  broadcasts: DemoBroadcastRecord[];
}
