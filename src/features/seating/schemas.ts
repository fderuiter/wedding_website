import { z } from 'zod';
import { InvitationCodeSchema } from '@/features/registry';

const SeatingTableShapeSchema = z.enum(['round', 'rectangular', 'square', 'head', 'sweetheart']);

export const SeatingTableSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, 'Table name is required.').max(100, 'Table name must be under 100 characters.'),
  shape: SeatingTableShapeSchema.default('round'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1.').max(50, 'Capacity cannot exceed 50.').default(8),
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

export type SeatingTableDTO = z.infer<typeof SeatingTableSchema>;

export const SeatingTableInputSchema = SeatingTableSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  invitationCodes: true,
});
export const SeatingTableUpdateInputSchema = SeatingTableInputSchema.partial();

const SingleAssignSeatSchema = z.object({
  invitationCodeId: z.string().min(1, 'Invitation code ID is required.'),
  tableId: z.string().nullable(),
  seatNumber: z.number().int().positive().nullable().optional(),
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

export const AutoAssignSchema = z.object({
  author: z.string().optional(),
  includePending: z.boolean().optional(),
}).optional();

export type AutoAssignDTO = z.infer<typeof AutoAssignSchema>;

export const AutoAssignResultSchema = z.object({
  assignedCount: z.number().int().min(0),
  unassignedCount: z.number().int().min(0),
  assignedGuests: z.array(InvitationCodeSchema),
});

export type AutoAssignResultDTO = z.infer<typeof AutoAssignResultSchema>;
