import { z } from 'zod';
import { MediaSchema } from '@/features/media/schemas';
import { safeImageUrlSchema, createLaxUrlSchema } from '@/utils/validation';

export const ContributorSchema = z.object({
  name: z.string(),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
  date: z.union([z.string(), z.date()]).transform(d => new Date(d).toISOString()),
});

export const ContributionSchema = z.object({
  itemId: z.string({ message: 'Missing or invalid itemId.' }).min(1, 'Missing or invalid itemId.'),
  name: z.string({ message: 'Name is required and must be under 100 characters.' }).trim().min(1, 'Name is required and must be under 100 characters.').max(100, 'Name is required and must be under 100 characters.'),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
}, { message: 'Invalid request body.' });

export const RegistryItemBaseSchema = z.object({
  name: z.string({ message: 'Item name is required and must be under 255 characters.' }).trim().min(1, 'Item name is required and must be under 255 characters.').max(255, 'Item name is required and must be under 255 characters.'),
  price: z.coerce.number({ message: 'Price must be a positive number.' }).positive('Price must be a positive number.'),
  quantity: z.coerce.number({ message: 'Quantity must be a positive integer.' }).int('Quantity must be a positive integer.').positive('Quantity must be a positive integer.'),
  category: z.string({ message: 'Category is required and must be under 255 characters.' }).trim().min(1, 'Category is required and must be under 255 characters.').max(255, 'Category is required and must be under 255 characters.'),
  description: z.string().max(2000, 'Description must be under 2000 characters.').optional().or(z.literal('')),
  imageId: z.string().optional(),
  imageUrl: safeImageUrlSchema,
  imageAlt: z.string().optional().nullable(),
  imageDecorative: z.boolean().optional(),
  image: MediaSchema.optional(),
  vendorUrl: createLaxUrlSchema('Vendor URL'),
  isGroupGift: z.union([z.boolean(), z.literal('on'), z.literal('off'), z.string()]).optional().transform(v => v === true || v === 'on' || v === 'true'),
}, { message: 'Invalid request body.' });

export const RegistryItemSchema = RegistryItemBaseSchema.extend({
  id: z.string(),
  purchased: z.boolean().default(false),
  purchaserName: z.string().nullable().optional(),
  amountContributed: z.coerce.number().default(0),
  contributors: z.array(ContributorSchema).default([]),
});

export type RegistryItemDTO = z.infer<typeof RegistryItemSchema>;
export type ContributorDTO = z.infer<typeof ContributorSchema>;

