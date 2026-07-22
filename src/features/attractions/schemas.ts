import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { MediaSchema } from '@/features/media/schemas';
import { safeImageUrlSchema, safeUrlSchema, coordinateSchema } from '@/utils/validation';

export const AttractionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  imageId: z.string().nullable().optional(),
  imageUrl: safeImageUrlSchema,
  imageAlt: z.string().optional().nullable(),
  imageDecorative: z.boolean().optional(),
  image: MediaSchema.nullable().optional(),
  category: z.string(),
  website: safeUrlSchema,
  directions: z.string(),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  isVisible: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AttractionDTO = z.infer<typeof AttractionSchema>;
