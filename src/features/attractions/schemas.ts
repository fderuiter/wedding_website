import { z } from 'zod';
import { createMediaAssociationSchema } from '@/features/media';
import { safeUrlSchema, coordinateSchema } from '@/utils/validation';

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
  createdAt: z.date(),
  updatedAt: z.date(),
}).merge(createMediaAssociationSchema('image'));

export type AttractionDTO = z.infer<typeof AttractionSchema>;
