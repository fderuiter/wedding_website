import { z } from 'zod';
import { deriveAdminInputSchema } from '@/utils/validationPrimitives';
import {
  DIETARY_TAG_OPTIONS,
  MAX_RSVP_PLUS_ONE_COUNT,
  MealOptionSchema,
  CustomRsvpQuestionSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
  type DietaryTagOption,
  type MealOptionDTO,
  type CustomRsvpQuestionDTO,
} from '@/utils/rsvpPrompts';

export {
  DIETARY_TAG_OPTIONS,
  MAX_RSVP_PLUS_ONE_COUNT,
  MealOptionSchema,
  CustomRsvpQuestionSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
  type DietaryTagOption,
  type MealOptionDTO,
  type CustomRsvpQuestionDTO,
};

export const MealOptionsListSchema = z
  .array(MealOptionSchema)
  .max(30, 'Cannot exceed 30 meal options per sub-event.')
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const normalizedId = item.id.trim();
      if (seen.has(normalizedId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate meal option ID "${normalizedId}".`,
        });
      }
      seen.add(normalizedId);
    });
  });

export const CustomRsvpQuestionsListSchema = z
  .array(CustomRsvpQuestionSchema)
  .max(30, 'Cannot exceed 30 custom RSVP questions per sub-event.')
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const normalizedId = item.id.trim();
      if (seen.has(normalizedId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate custom question ID "${normalizedId}".`,
        });
      }
      seen.add(normalizedId);
    });
  });

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
  mealOptions: MealOptionsListSchema.optional().default([]),
  customQuestions: CustomRsvpQuestionsListSchema.optional().default([]),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type SubEventDTO = z.infer<typeof SubEventSchema>;

export const SubEventInputSchema = deriveAdminInputSchema(SubEventSchema, false);
export const SubEventUpdateInputSchema = deriveAdminInputSchema(SubEventSchema, true);

export const SubEventRsvpSubmissionItemSchema = z.object({
  subEventId: z.string().min(1, 'Sub-event ID is required.'),
  invitationCodeId: z.string().trim().min(1, 'Invitation code ID cannot be empty.').optional(),
  status: z.enum(['attending', 'declined', 'pending']),
  plusOneCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_RSVP_PLUS_ONE_COUNT, `Plus-one count cannot exceed ${MAX_RSVP_PLUS_ONE_COUNT}.`)
    .optional()
    .default(0),
  dietaryNotes: z.string().optional().default(''),
  mealSelections: z.array(z.string().max(100)).max(MAX_RSVP_PLUS_ONE_COUNT + 1).optional(),
  customAnswers: z.record(z.string().max(100), z.string().max(1000)).optional(),
  plusOneNames: z.array(z.string().max(120)).max(MAX_RSVP_PLUS_ONE_COUNT).optional(),
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

