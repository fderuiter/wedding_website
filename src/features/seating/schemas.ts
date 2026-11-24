import { z } from 'zod';
import { InvitationCodeSchema } from '@/features/registry';
import { ALL_SEATING_TABLE_SHAPES, isLandmarkTableShape } from './utils/seatingHelpers';

const SeatingTableShapeSchema = z.enum(ALL_SEATING_TABLE_SHAPES);

function validateTableShapeCapacity(
  data: { shape?: string; capacity?: number },
  ctx: z.RefinementCtx
): void {
  const isLandmark = isLandmarkTableShape(data.shape);
  if (typeof data.capacity === 'number') {
    if (isLandmark && data.capacity !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'Landmarks must have 0 capacity.',
      });
    } else if (!isLandmark && data.capacity < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'Capacity must be at least 1.',
      });
    }
  }
}

const SeatingTableBaseObjectSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .trim()
    .min(1, 'Table name is required.')
    .max(100, 'Table name must be under 100 characters.'),
  shape: SeatingTableShapeSchema.default('round'),
  capacity: z
    .number()
    .int()
    .min(0, 'Capacity cannot be negative.')
    .max(50, 'Capacity cannot exceed 50.')
    .default(8),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(120),
  height: z.number().positive().default(120),
  rotation: z.number().default(0),
  isSample: z.boolean().default(false),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  invitationCodes: z.array(InvitationCodeSchema).optional(),
});

export const SeatingTableSchema = SeatingTableBaseObjectSchema.superRefine(
  validateTableShapeCapacity
);

export type SeatingTableDTO = z.infer<typeof SeatingTableSchema>;

const SeatingTableInputBaseObjectSchema = SeatingTableBaseObjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  invitationCodes: true,
});

export const SeatingTableInputSchema = SeatingTableInputBaseObjectSchema.superRefine(
  validateTableShapeCapacity
);

export const SeatingTableUpdateInputSchema = SeatingTableInputBaseObjectSchema.partial();

const SingleAssignSeatSchema = z.object({
  invitationCodeId: z.string().min(1, 'Invitation code ID is required.'),
  tableId: z.string().nullable(),
  seatNumber: z.number().int().positive().nullable().optional(),
  plusOneSeatNumbers: z.array(z.number().int().positive()).optional(),
});

const BatchSeatActionEnum = z.enum(['assignBatch', 'clearTable', 'undo']);

const BatchAssignSeatIdsSchema = z.object({
  invitationCodeIds: z
    .array(z.string().min(1, 'Invitation code ID is required.'))
    .min(1, 'At least one invitation code ID is required.'),
  tableId: z.string().nullable(),
  action: BatchSeatActionEnum.optional(),
});

const BatchAssignSeatEntriesSchema = z.object({
  assignments: z
    .array(SingleAssignSeatSchema)
    .min(1, 'At least one assignment is required.'),
  action: BatchSeatActionEnum.optional(),
});

export const AssignSeatSchema = z.union([
  SingleAssignSeatSchema,
  BatchAssignSeatIdsSchema,
  BatchAssignSeatEntriesSchema,
]);

export const AutoAssignSchema = z
  .object({
    author: z.string().optional(),
    includePending: z.boolean().optional(),
    keepHouseholdsIntact: z.boolean().optional(),
    partyGroup: z.string().trim().min(1).optional(),
    partyTags: z.array(z.string().trim().min(1)).optional(),
  })
  .optional();

export const AutoAssignResultSchema = z.object({
  assignedCount: z.number().int().min(0),
  unassignedCount: z.number().int().min(0),
  assignedGuests: z.array(InvitationCodeSchema),
});

export type AutoAssignResultDTO = z.infer<typeof AutoAssignResultSchema>;
