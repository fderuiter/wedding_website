import { z } from 'zod';

export const AttractionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  image: z.string().nullable(),
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
