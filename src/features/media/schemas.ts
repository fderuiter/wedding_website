import { z } from 'zod';

export const MediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  altText: z.string().nullable(),
  isDecorative: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MediaDTO = z.infer<typeof MediaSchema>;
