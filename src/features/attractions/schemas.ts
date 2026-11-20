import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import { safeUrlSchema, coordinateSchema, deriveAdminInputSchema } from '@/utils/validationPrimitives';

export const AttractionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  website: safeUrlSchema,
  directions: z.string(),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  isVisible: z.boolean(),
  promoCode: z.string().nullable().optional(),
  bookingUrl: safeUrlSchema,
  roomRate: z.string().nullable().optional(),
  cutoffDate: z.string().nullable().optional(),
  shuttleInfo: z.string().nullable().optional(),
  isSample: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
}).extend(createMediaAssociationSchema('image').shape);

export const AttractionCreateInputSchema = deriveAdminInputSchema(AttractionSchema, false);
export const AttractionInputSchema = deriveAdminInputSchema(AttractionSchema, true);

export type AttractionDTO = z.infer<typeof AttractionSchema>;
