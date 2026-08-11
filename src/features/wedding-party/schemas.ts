import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import { safeUrlSchema } from '@/utils/validation';

export const WeddingPartyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  link: safeUrlSchema,
  order: z.coerce.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).merge(createMediaAssociationSchema('photo'));

export type WeddingPartyMemberDTO = z.infer<typeof WeddingPartyMemberSchema>;
