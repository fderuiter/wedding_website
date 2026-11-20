import { z } from 'zod';

export const BroadcastTargetFiltersSchema = z.object({
  partyTags: z.array(z.string()).optional(),
  partyGroup: z.string().optional(),
  householdName: z.string().optional(),
  status: z.enum(['all', 'redeemed', 'unused']).optional(),
  addressFilter: z.enum(['all', 'complete', 'missing']).optional(),
  dietaryFilter: z.string().optional(),
  attendanceStatus: z.enum(['attending', 'declined', 'pending', 'all']).optional(),
  subEventId: z.string().optional(),
  subEventRsvpStatus: z.string().optional(),
  selectedIds: z.array(z.string()).optional(),
  searchQuery: z.string().optional(),
});

export const SendBroadcastSchema = z.object({
  channel: z.enum(['EMAIL', 'SMS']),
  subject: z.string().optional(),
  body: z.string().min(1, 'Message body cannot be empty'),
  targetFilters: BroadcastTargetFiltersSchema.optional(),
  customRecipientIds: z.array(z.string()).optional(),
  scheduledFor: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
});

export const PreviewBroadcastSchema = z.object({
  channel: z.enum(['EMAIL', 'SMS']),
  subject: z.string().optional(),
  body: z.string().min(1, 'Message body cannot be empty'),
  sampleGuestId: z.string().optional(),
  targetFilters: BroadcastTargetFiltersSchema.optional(),
});

export const SendTestBroadcastSchema = z.object({
  channel: z.enum(['EMAIL', 'SMS']),
  subject: z.string().optional(),
  body: z.string().min(1, 'Message body cannot be empty'),
  destination: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.destination && data.destination.trim()) {
    if (data.channel === 'EMAIL') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.destination.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['destination'],
          message: 'Invalid email address format',
        });
      }
    } else if (data.channel === 'SMS') {
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(data.destination.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['destination'],
          message: 'Invalid phone number format. Must be in E.164 format (e.g. +15551234567)',
        });
      }
    }
  }
});

export const TestConnectionSchema = z.object({
  type: z.enum(['email', 'sms']),
  provider: z.string().nullable().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPass: z.string().nullable().optional(),
  smtpFrom: z.string().nullable().optional(),
  smtpSecure: z.boolean().nullable().optional(),
  resendApiKey: z.string().nullable().optional(),
  resendFrom: z.string().nullable().optional(),
  sendgridApiKey: z.string().nullable().optional(),
  sendgridFrom: z.string().nullable().optional(),
  twilioAccountSid: z.string().nullable().optional(),
  twilioAuthToken: z.string().nullable().optional(),
  twilioFromNumber: z.string().nullable().optional(),
  testRecipient: z.string().nullable().optional(),
});

export const RetryBroadcastSchema = z.object({
  broadcastId: z.string().min(1, 'Broadcast ID is required'),
  recipientIds: z.array(z.string()).optional(),
});
