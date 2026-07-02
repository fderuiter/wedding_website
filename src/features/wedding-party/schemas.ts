import { z } from 'zod';
import { MediaSchema } from '@/features/media/schemas';

export const WeddingPartyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  photoId: z.string().optional(),
  photoUrl: z.string().optional(),
  photoAlt: z.string().optional().nullable(),
  photoDecorative: z.boolean().optional(),
  photo: MediaSchema.optional(),
  link: z.string().nullable(),
  order: z.coerce.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WeddingPartyMemberDTO = z.infer<typeof WeddingPartyMemberSchema>;
