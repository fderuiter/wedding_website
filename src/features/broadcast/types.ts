export type BroadcastChannel = 'EMAIL' | 'SMS';

export interface BroadcastTargetFilters {
  partyTags?: string[];
  householdName?: string;
  attendanceStatus?: 'attending' | 'declined' | 'pending' | 'all';
  status?: 'redeemed' | 'unused' | 'all';
  addressStatus?: 'complete' | 'missing' | 'all';
  addressFilter?: 'complete' | 'missing' | 'all';
  dietaryCategory?: string;
  dietaryFilter?: string;
  partyGroup?: string;
  subEventId?: string;
  subEventRsvpStatus?: string;
  selectedIds?: string[];
  searchQuery?: string;
}

export interface BroadcastTemplateContext {
  guestName: string;
  invitationCode: string;
  rsvpUrl?: string;
  baseUrl?: string;
  householdName?: string;
  weddingDate?: string;
  venueName?: string;
  [key: string]: any;
}

export interface SendBroadcastInput {
  channel: BroadcastChannel;
  subject?: string;
  body: string;
  targetFilters?: BroadcastTargetFilters;
  customRecipientIds?: string[];
  scheduledFor?: string;
  requestOrigin?: string;
}

export interface PreviewBroadcastInput {
  channel: BroadcastChannel;
  subject?: string;
  body: string;
  sampleGuestId?: string;
  targetFilters?: BroadcastTargetFilters;
  requestOrigin?: string;
}

export interface SendTestBroadcastInput {
  channel: BroadcastChannel;
  subject?: string;
  body: string;
  destination?: string;
  requestOrigin?: string;
}

export interface TestConnectionInput {
  type: 'email' | 'sms';
  provider?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFrom?: string | null;
  smtpSecure?: boolean | null;
  resendApiKey?: string | null;
  resendFrom?: string | null;
  sendgridApiKey?: string | null;
  sendgridFrom?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioFromNumber?: string | null;
  testRecipient?: string | null;
}

export interface DispatchResult {
  success: boolean;
  error?: string;
}

export interface BroadcastHistoryQueryOptions {
  page?: number;
  limit?: number;
  skip?: number;
}

export interface BroadcastHistoryItem {
  id: string;
  channel: BroadcastChannel;
  subject?: string | null;
  body: string;
  targetFilters?: any;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledFor?: Date | string | null;
  sentAt?: Date | string | null;
  createdAt: Date | string;
  recipients?: Array<{
    id: string;
    invitationCodeId?: string | null;
    guestName: string;
    destination: string;
    status: string;
    error?: string | null;
    sentAt?: Date | string | null;
  }>;
}
