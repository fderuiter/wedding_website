import { z } from 'zod';
import { MediaSchema } from '@/features/media';
import { createLaxUrlSchema, safeUrlSchema } from '@/utils/validation';

export const WeddingPartyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  photoId: z.string().optional(),
  photoUrl: createLaxUrlSchema('Photo URL'),
  photoAlt: z.string().optional().nullable(),
  photoDecorative: z.boolean().optional(),
  photo: MediaSchema.optional(),
  link: safeUrlSchema,
  order: z.coerce.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WeddingPartyMemberDTO = z.infer<typeof WeddingPartyMemberSchema>;
