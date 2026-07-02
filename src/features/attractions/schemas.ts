import { z } from 'zod';
import { MediaSchema } from '@/features/media/schemas';

export const AttractionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  imageId: z.string().nullable().optional(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().optional().nullable(),
  imageDecorative: z.boolean().optional(),
  image: MediaSchema.nullable().optional(),
  category: z.string(),
  website: z.string(),
  directions: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  isVisible: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AttractionDTO = z.infer<typeof AttractionSchema>;
