import { z } from 'zod';

export const BroadcastTargetFiltersSchema = z.object({
  partyTags: z.array(z.string()).optional(),
  householdName: z.string().optional(),
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
          code: z.ZodIssueCode.custom,
          path: ['destination'],
          message: 'Invalid email address format',
        });
      }
    } else if (data.channel === 'SMS') {
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(data.destination.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destination'],
          message: 'Invalid phone number format. Must be in E.164 format (e.g. +15551234567)',
        });
      }
    }
  }
});

export const TestConnectionSchema = z.object({
  type: z.enum(['email', 'sms']),
  provider: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  resendApiKey: z.string().optional(),
  resendFrom: z.string().optional(),
  sendgridApiKey: z.string().optional(),
  sendgridFrom: z.string().optional(),
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioFromNumber: z.string().optional(),
  testRecipient: z.string().optional(),
});

export const RetryBroadcastSchema = z.object({
  broadcastId: z.string().min(1, 'Broadcast ID is required'),
  recipientIds: z.array(z.string()).optional(),
});
