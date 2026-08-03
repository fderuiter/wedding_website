import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
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

export const LegacyRegistryItemBaseSchema = z.object({
  legacy_name: z.string({ message: 'Legacy item name is required and must be under 255 characters.' }).trim().min(1, 'Legacy item name is required and must be under 255 characters.').max(255, 'Legacy item name is required and must be under 255 characters.'),
  legacy_price: z.coerce.number({ message: 'Legacy price must be a positive number.' }).positive('Legacy price must be a positive number.'),
  legacy_quantity: z.coerce.number({ message: 'Legacy quantity must be a positive integer.' }).int('Legacy quantity must be a positive integer.').positive('Legacy quantity must be a positive integer.'),
  legacy_category: z.string({ message: 'Legacy category is required and must be under 255 characters.' }).trim().min(1, 'Legacy category is required and must be under 255 characters.').max(255, 'Legacy category is required and must be under 255 characters.'),
  legacy_description: z.string().max(2000, 'Legacy description must be under 2000 characters.').optional().or(z.literal('')),
  legacy_imageUrl: safeImageUrlSchema.optional(),
  legacy_vendorUrl: createLaxUrlSchema('Legacy Vendor URL').optional(),
  legacy_isGroupGift: z.union([z.boolean(), z.literal('on'), z.literal('off'), z.string()]).optional().transform(v => v === true || v === 'on' || v === 'true'),
}, { message: 'Invalid legacy request body.' });

export const LegacyRegistryItemSchema = LegacyRegistryItemBaseSchema.extend({
  id: z.string(),
  purchased: z.boolean().default(false),
  purchaserName: z.string().nullable().optional(),
  amountContributed: z.coerce.number().default(0),
  contributors: z.array(ContributorSchema).default([]),
});

export function translateLegacyToActive(legacyData: any) {
  return {
    name: legacyData.legacy_name,
    price: legacyData.legacy_price,
    quantity: legacyData.legacy_quantity,
    category: legacyData.legacy_category,
    description: legacyData.legacy_description || '',
    imageUrl: legacyData.legacy_imageUrl || '/images/placeholder.png',
    vendorUrl: legacyData.legacy_vendorUrl || null,
    isGroupGift: !!legacyData.legacy_isGroupGift,
  };
}

export function translateActiveToLegacy(activeData: any): any {
  if (!activeData) return activeData;
  if (Array.isArray(activeData)) {
    return activeData.map(item => translateActiveToLegacy(item));
  }
  if (typeof activeData === 'object') {
    // If it's a success/item wrapper:
    const result: any = { ...activeData };
    if (activeData.item && typeof activeData.item === 'object') {
      result.item = translateActiveToLegacy(activeData.item);
    }
    if (activeData.data && typeof activeData.data === 'object') {
      result.data = translateActiveToLegacy(activeData.data);
    }
    if (activeData.items && Array.isArray(activeData.items)) {
      result.items = translateActiveToLegacy(activeData.items);
    }
    
    // Check if it represents a RegistryItem
    if ('name' in activeData && 'price' in activeData && 'quantity' in activeData) {
      return {
        id: activeData.id,
        legacy_name: activeData.name,
        legacy_price: activeData.price,
        legacy_quantity: activeData.quantity,
        legacy_category: activeData.category,
        legacy_description: activeData.description || '',
        legacy_imageUrl: activeData.imageUrl || '',
        legacy_vendorUrl: activeData.vendorUrl || null,
        legacy_isGroupGift: activeData.isGroupGift,
        purchased: activeData.purchased,
        purchaserName: activeData.purchaserName,
        amountContributed: activeData.amountContributed,
        contributors: activeData.contributors,
        createdAt: activeData.createdAt,
        updatedAt: activeData.updatedAt,
      };
    }
    return result;
  }
  return activeData;
}

