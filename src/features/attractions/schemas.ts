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
  createdAt: z.date(),
  updatedAt: z.date(),
}).merge(createMediaAssociationSchema('image'));

export type AttractionDTO = z.infer<typeof AttractionSchema>;
