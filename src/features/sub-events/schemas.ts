import { z } from 'zod';
import { deriveAdminInputSchema } from '@/utils/validationPrimitives';
import {
  MAX_RSVP_PLUS_ONE_COUNT,
  MealOptionSchema,
  CustomRsvpQuestionSchema,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
  type MealOptionDTO,
  type CustomRsvpQuestionDTO,
} from '@/utils/rsvpPrompts';

export {
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
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

const SubEventSchema = z.object({
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

export const AdminInvitationRsvpsQuerySchema = z.object({
  invitationCodeId: z.string().trim().min(1, 'invitationCodeId is required.'),
});

const AdminSubEventRsvpOverrideItemSchema = z.object({
  subEventId: z.string().trim().min(1, 'subEventId is required.'),
  status: z.enum(['attending', 'declined', 'pending', 'clear']),
  plusOneCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_RSVP_PLUS_ONE_COUNT, `Plus-one count cannot exceed ${MAX_RSVP_PLUS_ONE_COUNT}.`)
    .optional(),
  plusOneNames: z.array(z.string().trim().max(120)).max(MAX_RSVP_PLUS_ONE_COUNT).optional(),
  mealSelections: z.array(z.string().trim().max(100)).max(MAX_RSVP_PLUS_ONE_COUNT + 1).optional(),
  dietaryNotes: z.string().trim().max(500).nullable().optional(),
  customAnswers: z.record(z.string().max(100), z.string().max(1000)).optional(),
});

export type AdminSubEventRsvpOverrideItemDTO = z.infer<typeof AdminSubEventRsvpOverrideItemSchema>;

const AdminSingleGuestRsvpOverrideSchema = z.object({
  invitationCodeId: z.string().trim().min(1, 'invitationCodeId is required.'),
  clearAll: z.boolean().optional(),
  overallAttendanceStatus: z.enum(['attending', 'declined', 'pending']).optional(),
  plusOneCount: z.number().int().min(0).max(MAX_RSVP_PLUS_ONE_COUNT).optional(),
  plusOneNames: z.array(z.string().trim().max(120)).max(MAX_RSVP_PLUS_ONE_COUNT).optional(),
  rsvps: z.array(AdminSubEventRsvpOverrideItemSchema).max(50).optional(),
});

export type AdminSingleGuestRsvpOverrideDTO = z.infer<typeof AdminSingleGuestRsvpOverrideSchema>;

const AdminBatchAttendanceOverrideSchema = z.object({
  invitationCodeIds: z
    .array(z.string().trim().min(1, 'Invitation code ID cannot be empty.'))
    .min(1, 'At least one invitationCodeId is required.')
    .max(1000, 'Maximum of 1000 invitation code IDs per batch attendance override.'),
  status: z.enum(['attending', 'declined', 'pending', 'clear']),
  subEventIds: z.array(z.string().trim().min(1)).max(50).optional(),
});

export type AdminBatchAttendanceOverrideDTO = z.infer<typeof AdminBatchAttendanceOverrideSchema>;

export const AdminUpdateInvitationRsvpsSchema = z.union([
  AdminSingleGuestRsvpOverrideSchema,
  AdminBatchAttendanceOverrideSchema,
]);

export interface RsvpMealOptionCount {
  optionId: string;
  label: string;
  dietaryTags: string[];
  count: number;
}

export interface GlobalRsvpMealTotal extends RsvpMealOptionCount {
  subEventId: string;
  subEventTitle: string;
}

export interface RsvpDietaryBreakdown {
  totalWithRestrictions: number;
  glutenFree: number;
  vegetarian: number;
  vegan: number;
  dairyFree: number;
  nutFree: number;
  halal: number;
  kosher: number;
  other: number;
  kids: number;
}

interface RsvpQuestionChoiceCount {
  option: string;
  count: number;
}

interface RsvpQuestionTextResponse {
  invitationCodeId: string;
  guestName: string;
  answer: string;
}

export interface RsvpQuestionBreakdown {
  subEventId: string;
  subEventTitle: string;
  questionId: string;
  prompt: string;
  type: 'text' | 'choice';
  totalResponses: number;
  optionCounts: RsvpQuestionChoiceCount[];
  textResponses: RsvpQuestionTextResponse[];
}

export interface SubEventRsvpSummaryItem {
  subEventId: string;
  title: string;
  isPrivate: boolean;
  invitedCount: number;
  attendingCount: number;
  attendingPlusOnes: number;
  attendingHeadcount: number;
  declinedCount: number;
  pendingCount: number;
  kidsCount: number;
  mealCounts: RsvpMealOptionCount[];
  dietaryCounts: RsvpDietaryBreakdown;
  questionBreakdowns: RsvpQuestionBreakdown[];
}

export interface RsvpSummaryResponse {
  global: {
    totalInvitations: number;
    attendingHouseholds: number;
    declinedHouseholds: number;
    pendingHouseholds: number;
    attendingHeadcount: number;
    attendingPlusOnes: number;
    declinedHeadcount: number;
    pendingHeadcount: number;
    dietary: RsvpDietaryBreakdown;
    mealTotals: GlobalRsvpMealTotal[];
    questionBreakdowns: RsvpQuestionBreakdown[];
  };
  subEvents: SubEventRsvpSummaryItem[];
}

export interface AdminInvitationRsvpsDetail {
  invitationCode: {
    id: string;
    code: string;
    guestName: string;
    used: boolean;
    plusOneAllocations: number;
    plusOneFirstName: string | null;
    plusOneLastName: string | null;
    dietaryNotes: string | null;
    extraFields: Record<string, unknown> | null;
  };
  subEvents: Array<{
    id: string;
    title: string;
    isPrivate: boolean;
    hasAccess: boolean;
    mealOptions: MealOptionDTO[];
    customQuestions: CustomRsvpQuestionDTO[];
  }>;
  rsvps: Array<{
    id: string;
    subEventId: string;
    status: 'attending' | 'declined' | 'pending';
    plusOneCount: number;
    plusOneNames: string[];
    mealSelections: string[];
    dietaryNotes: string | null;
    customAnswers: Record<string, string>;
  }>;
}


