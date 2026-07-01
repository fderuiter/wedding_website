import { z } from 'zod';

export const ContributorSchema = z.object({
  name: z.string(),
  amount: z.number(),
  date: z.union([z.string(), z.date()]).transform(d => new Date(d).toISOString()),
});

export const RegistryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  price: z.number(),
  image: z.string(),
  vendorUrl: z.string().nullable(),
  quantity: z.number(),
  isGroupGift: z.boolean(),
  purchased: z.boolean(),
  purchaserName: z.string().nullable().optional(),
  amountContributed: z.number(),
  contributors: z.array(ContributorSchema).default([]),
});

export type RegistryItemDTO = z.infer<typeof RegistryItemSchema>;
export type ContributorDTO = z.infer<typeof ContributorSchema>;
