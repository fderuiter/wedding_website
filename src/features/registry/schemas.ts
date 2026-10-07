import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import { createLaxUrlSchema, safeImageUrlSchema } from '@/utils/validation';

export const ThankYouStatusEnum = z.enum(['Unsent', 'Sent', 'Not Needed']);
export type ThankYouStatus = z.infer<typeof ThankYouStatusEnum>;

export const ContributorSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  email: z.string().nullable().optional(),
  isPlusOne: z.boolean().optional().default(false),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
  date: z.union([z.string(), z.date()]).transform(d => new Date(d).toISOString()),
  thankYouStatus: z.string().optional().default('Unsent'),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional().transform(d => d ? new Date(d).toISOString() : null),
  thankYouNote: z.string().nullable().optional(),
  registryItemId: z.string().nullable().optional(),
  registryItem: z.object({
    id: z.string(),
    name: z.string(),
    category: z.string().optional(),
  }).nullable().optional(),
});

export const UpdateThankYouNoteSchema = z.object({
  thankYouStatus: z.enum(['Unsent', 'Sent', 'Not Needed']).optional(),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z.string().max(2000, 'Thank-you note must be under 2000 characters.').nullable().optional(),
});

export type UpdateThankYouNoteDTO = z.infer<typeof UpdateThankYouNoteSchema>;

export const BatchUpdateThankYouNotesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'At least one contributor record is required.'),
  status: z.enum(['Unsent', 'Sent', 'Not Needed']),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z.string().max(2000, 'Thank-you note must be under 2000 characters.').nullable().optional(),
});

export type BatchUpdateThankYouNotesDTO = z.infer<typeof BatchUpdateThankYouNotesSchema>;

export const ContributionSchema = z.object({
  itemId: z.string({ message: 'Missing or invalid itemId.' }).min(1, 'Missing or invalid itemId.'),
  name: z.string({ message: 'Name is required and must be under 100 characters.' }).trim().min(1, 'Name is required and must be under 100 characters.').max(100, 'Name is required and must be under 100 characters.'),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
  code: z.string().trim().optional(),
}, { message: 'Invalid request body.' });

export const RegistryItemBaseSchema = z.object({
  name: z.string({ message: 'Item name is required and must be under 255 characters.' }).trim().min(1, 'Item name is required and must be under 255 characters.').max(255, 'Item name is required and must be under 255 characters.'),
  price: z.coerce.number({ message: 'Price must be a positive number.' }).positive('Price must be a positive number.'),
  quantity: z.coerce.number({ message: 'Quantity must be a positive integer.' }).int('Quantity must be a positive integer.').positive('Quantity must be a positive integer.'),
  category: z.string({ message: 'Category is required and must be under 255 characters.' }).trim().min(1, 'Category is required and must be under 255 characters.').max(255, 'Category is required and must be under 255 characters.'),
  description: z.string().max(2000, 'Description must be under 2000 characters.').optional().or(z.literal('')),
  vendorUrl: createLaxUrlSchema('Vendor URL'),
  isGroupGift: z.union([z.boolean(), z.literal('on'), z.literal('off'), z.string()]).optional().transform(v => v === true || v === 'on' || v === 'true'),
}, { message: 'Invalid request body.' }).merge(createMediaAssociationSchema('image'));

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

export function translateSnapshotToActive(snapshotData: any) {
  if (!snapshotData) return null;
  return {
    name: snapshotData.name ?? snapshotData.legacy_name ?? snapshotData.title ?? snapshotData.itemName ?? '',
    description: snapshotData.description ?? snapshotData.legacy_description ?? snapshotData.details ?? '',
    category: snapshotData.category ?? snapshotData.legacy_category ?? snapshotData.group ?? 'Uncategorized',
    price: snapshotData.price ?? snapshotData.legacy_price ?? snapshotData.cost ?? snapshotData.priceAmount ?? 0,
    imageId: snapshotData.imageId ?? snapshotData.legacy_imageId ?? snapshotData.mediaId ?? '',
    vendorUrl: snapshotData.vendorUrl ?? snapshotData.legacy_vendorUrl ?? null,
    quantity: snapshotData.quantity ?? snapshotData.legacy_quantity ?? snapshotData.qty ?? snapshotData.itemCount ?? 1,
    isGroupGift: snapshotData.isGroupGift ?? snapshotData.legacy_isGroupGift ?? false,
    purchased: snapshotData.purchased || false,
    purchaserName: snapshotData.purchaserName,
    amountContributed: snapshotData.amountContributed || 0,
  };
}

export const InvitationCodeSchema = z.object({
  id: z.string(),
  code: z.string().trim().min(1, 'Code is required.').max(50, 'Code must be under 50 characters.'),
  guestName: z.string({ message: 'Guest name is required.' }).trim().min(1, 'Guest name is required and must be under 100 characters.').max(100, 'Guest name is required and must be under 100 characters.'),
  email: z.string().trim().email('Invalid email address.').nullable().optional().or(z.literal('')),
  dietaryNotes: z.string().trim().nullable().optional(),
  plusOneAllocations: z.coerce.number().int().nonnegative().optional().default(0),
  extraFields: z.record(z.string(), z.any()).nullable().optional(),
  used: z.boolean().default(false),
  usedAt: z.union([z.string(), z.date()]).nullable().optional(),
  tableId: z.string().nullable().optional(),
  seatNumber: z.number().int().positive().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type InvitationCodeDTO = z.infer<typeof InvitationCodeSchema>;

export const BatchImportInvitationCodeItemSchema = z.object({
  guestName: z.string({ message: 'Guest name is required.' }).trim().min(1, 'Guest name is required.').max(100, 'Guest name must be under 100 characters.'),
  code: z.string().trim().optional().or(z.literal('')),
  email: z.union([
    z.string().trim().email('Invalid email address.'),
    z.literal(''),
    z.null(),
    z.undefined()
  ]).optional(),
  dietaryNotes: z.string().trim().optional().or(z.literal('')).nullable(),
  plusOneAllocations: z.coerce.number().int('Plus-one allocation must be an integer.').nonnegative('Plus-one allocation must be non-negative.').optional(),
  extraFields: z.record(z.string(), z.any()).optional().nullable(),
});

export const BatchImportInvitationCodesSchema = z.object({
  records: z.array(BatchImportInvitationCodeItemSchema).min(1, 'At least one record is required for batch import.'),
  collisionStrategy: z.enum(['skip', 'update', 'reject']).default('skip'),
});

export type BatchImportInvitationCodesDTO = z.infer<typeof BatchImportInvitationCodesSchema>;



