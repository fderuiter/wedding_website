export type BroadcastChannel = 'EMAIL' | 'SMS';

export interface BroadcastTargetFilters {
  partyTags?: string[];
  householdName?: string;
  attendanceStatus?: 'attending' | 'declined' | 'pending' | 'all';
  subEventId?: string;
  subEventRsvpStatus?: string;
  selectedIds?: string[];
  searchQuery?: string;
}

export interface BroadcastTemplateContext {
  guestName: string;
  invitationCode: string;
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
}

export interface PreviewBroadcastInput {
  channel: BroadcastChannel;
  subject?: string;
  body: string;
  sampleGuestId?: string;
  targetFilters?: BroadcastTargetFilters;
}

export interface TestConnectionInput {
  type: 'email' | 'sms';
  provider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;
  resendApiKey?: string;
  resendFrom?: string;
  sendgridApiKey?: string;
  sendgridFrom?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  testRecipient?: string;
}

export interface DispatchResult {
  success: boolean;
  error?: string;
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
