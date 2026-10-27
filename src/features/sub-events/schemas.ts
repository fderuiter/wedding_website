import { z } from 'zod';

export const SubEventSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Title is required.'),
  description: z.string().optional().default(''),
  startTime: z.union([z.string(), z.date()]).nullish(),
  endTime: z.union([z.string(), z.date()]).nullish(),
  locationName: z.string().optional().default(''),
  location: z.string().optional().default(''),
  category: z.string().optional().default(''),
  isPrivate: z.boolean().default(false),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type SubEventDTO = z.infer<typeof SubEventSchema>;

export const SubEventRsvpSubmissionItemSchema = z.object({
  subEventId: z.string().min(1, 'Sub-event ID is required.'),
  status: z.enum(['attending', 'declined', 'pending']),
  plusOneCount: z.number().int().min(0).optional().default(0),
  dietaryNotes: z.string().optional().default(''),
});

export const SubEventRsvpBatchSubmissionSchema = z.object({
  rsvps: z.array(SubEventRsvpSubmissionItemSchema).min(1, 'At least one RSVP submission is required.'),
});

export type SubEventRsvpSubmissionItem = z.infer<typeof SubEventRsvpSubmissionItemSchema>;

export const UpdateSubEventAccessSchema = z.object({
  invitationCodeId: z.string().min(1, 'invitationCodeId is required.'),
  allowedSubEventIds: z.array(z.string()),
});

export type UpdateSubEventAccessDTO = z.infer<typeof UpdateSubEventAccessSchema>;

export const BatchUpdateSubEventAccessSchema = z.object({
  invitationCodeIds: z.array(z.string()).optional(),
  partyTags: z.array(z.string()).optional(),
  partyGroups: z.array(z.string()).optional(),
  householdName: z.union([z.string(), z.array(z.string())]).optional(),
  search: z.string().optional(),
  subEventIds: z.array(z.string()).min(1, 'At least one subEventId is required.'),
  action: z.enum(['grant', 'revoke', 'set']),
});

export type BatchUpdateSubEventAccessDTO = z.infer<typeof BatchUpdateSubEventAccessSchema>;

export const GetAccessMatrixQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  partyTag: z.string().optional(),
  partyGroup: z.string().optional(),
  householdName: z.string().optional(),
});

export type GetAccessMatrixQueryDTO = z.infer<typeof GetAccessMatrixQuerySchema>;

