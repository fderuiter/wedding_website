import { z } from 'zod';
import { InvitationCodeSchema } from '@/features/registry/schemas';

export const SeatingTableShapeSchema = z.enum(['round', 'rectangular', 'square']);

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
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  invitationCodes: z.array(InvitationCodeSchema).optional(),
});

export type SeatingTableDTO = z.infer<typeof SeatingTableSchema>;

export const CreateSeatingTableSchema = SeatingTableSchema.omit({ id: true, createdAt: true, updatedAt: true, invitationCodes: true }).partial({
  shape: true,
  capacity: true,
  x: true,
  y: true,
  width: true,
  height: true,
  rotation: true,
});

export const UpdateSeatingTableSchema = CreateSeatingTableSchema.partial();

export const AssignSeatSchema = z.object({
  invitationCodeId: z.string().min(1, 'Invitation code ID is required.'),
  tableId: z.string().nullable(),
  seatNumber: z.number().int().positive().nullable().optional(),
});

export type AssignSeatDTO = z.infer<typeof AssignSeatSchema>;
