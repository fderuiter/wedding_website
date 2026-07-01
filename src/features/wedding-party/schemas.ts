import { z } from 'zod';

export const WeddingPartyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  photo: z.string(),
  link: z.string().nullable(),
  order: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WeddingPartyMemberDTO = z.infer<typeof WeddingPartyMemberSchema>;
