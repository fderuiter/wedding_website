import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import { deriveAdminInputSchema, safeUrlSchema } from '@/utils/validationPrimitives';

export const WeddingPartySideSchema = z.enum(['BRIDE', 'GROOM', 'JOINT']);
export type WeddingPartySide = z.infer<typeof WeddingPartySideSchema>;

export const WeddingPartyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  side: WeddingPartySideSchema.nullish(),
  link: safeUrlSchema,
  order: z.coerce.number(),
  isSample: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
}).extend(createMediaAssociationSchema('photo').shape);

export const WeddingPartyInputSchema = deriveAdminInputSchema(WeddingPartyMemberSchema, false);
export const WeddingPartyUpdateInputSchema = deriveAdminInputSchema(WeddingPartyMemberSchema, true);

export type WeddingPartyMemberDTO = z.infer<typeof WeddingPartyMemberSchema>;
