import { z } from 'zod';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import { createLaxUrlSchema } from '@/utils/validation';

export const RegistryQuerySchema = z.object({
  page: z.coerce.number().int({ message: 'Page must be an integer.' }).min(1, 'Page must be at least 1.').default(1),
  limit: z.coerce.number().int({ message: 'Limit must be an integer.' }).min(1, 'Limit must be at least 1.').max(100, 'Limit cannot exceed 100.').default(20),
  category: z.string().optional(),
  minPrice: z.coerce.number({ message: 'minPrice must be a number.' }).min(0, 'minPrice must be non-negative.').optional(),
  maxPrice: z.coerce.number({ message: 'maxPrice must be a number.' }).min(0, 'maxPrice must be non-negative.').optional(),
});

export type RegistryQueryParams = z.infer<typeof RegistryQuerySchema>;

export const ContributorSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  email: z.string().nullable().optional(),
  isPlusOne: z.boolean().optional().default(false),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
  message: z.string().nullable().optional(),
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
  invitationCodeId: z.string().nullable().optional(),
  invitationCode: z.object({
    id: z.string().optional(),
    code: z.string().optional(),
    guestName: z.string().optional(),
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zipCode: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  }).nullable().optional(),
});

export const UpdateThankYouNoteSchema = z.object({
  thankYouStatus: z.enum(['Unsent', 'Sent', 'Not Needed']).optional(),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z.string().max(2000, 'Thank-you note must be under 2000 characters.').nullable().optional(),
});

export const BatchUpdateThankYouNotesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'At least one contributor record is required.'),
  status: z.enum(['Unsent', 'Sent', 'Not Needed']),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z.string().max(2000, 'Thank-you note must be under 2000 characters.').nullable().optional(),
});

export const ContributionSchema = z.object({
  itemId: z.string({ message: 'Missing or invalid itemId.' }).min(1, 'Missing or invalid itemId.'),
  name: z.string({ message: 'Name is required and must be under 100 characters.' }).trim().min(1, 'Name is required and must be under 100 characters.').max(100, 'Name is required and must be under 100 characters.'),
  amount: z.coerce.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
  code: z.string().trim().optional(),
  message: z.string().max(1000, 'Personal note must be under 1000 characters.').optional().nullable(),
}, { message: 'Invalid request body.' });

export const ItemTypeEnum = z.enum(['PHYSICAL', 'CASH_FUND', 'EXPERIENCE_FUND']);
export type ItemType = z.infer<typeof ItemTypeEnum>;

export const RegistryItemBaseSchema = z.object({
  itemType: ItemTypeEnum.optional().default('PHYSICAL'),
  name: z.string({ message: 'Item name is required and must be under 255 characters.' }).trim().min(1, 'Item name is required and must be under 255 characters.').max(255, 'Item name is required and must be under 255 characters.'),
  price: z.coerce.number({ message: 'Price must be a positive number.' }).positive('Price must be a positive number.'),
  quantity: z.coerce.number({ message: 'Quantity must be a positive integer.' }).int('Quantity must be a positive integer.').positive('Quantity must be a positive integer.').optional().default(1),
  category: z.string({ message: 'Category is required and must be under 255 characters.' }).trim().min(1, 'Category is required and must be under 255 characters.').max(255, 'Category is required and must be under 255 characters.'),
  description: z.string().max(2000, 'Description must be under 2000 characters.').optional().or(z.literal('')),
  vendorUrl: createLaxUrlSchema('Vendor URL'),
  isGroupGift: z.union([z.boolean(), z.literal('on'), z.literal('off'), z.string()]).optional().transform(v => v === true || v === 'on' || v === 'true'),
  paymentHandleType: z.string().max(100, 'Payment handle type must be under 100 characters.').optional().nullable().or(z.literal('')),
  paymentHandle: z.string().max(255, 'Payment handle must be under 255 characters.').optional().nullable().or(z.literal('')),
}, { message: 'Invalid request body.' }).merge(createMediaAssociationSchema('image'));

export const RegistryItemSchema = RegistryItemBaseSchema.extend({
  id: z.string(),
  itemType: ItemTypeEnum.default('PHYSICAL'),
  paymentHandleType: z.string().nullable().optional(),
  paymentHandle: z.string().nullable().optional(),
  purchased: z.boolean().default(false),
  purchaserName: z.string().nullable().optional(),
  amountContributed: z.coerce.number().default(0),
  contributors: z.array(ContributorSchema).default([]),
});

export type RegistryItemDTO = z.infer<typeof RegistryItemSchema>;


export function translateSnapshotToActive(snapshotData: any) {
  if (!snapshotData) return null;
  return {
    itemType: snapshotData.itemType ?? 'PHYSICAL',
    paymentHandleType: snapshotData.paymentHandleType ?? null,
    paymentHandle: snapshotData.paymentHandle ?? null,
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
  addressLine1: z.string().trim().max(150, 'Address Line 1 must be under 150 characters.').nullable().optional().or(z.literal('')),
  addressLine2: z.string().trim().max(150, 'Address Line 2 must be under 150 characters.').nullable().optional().or(z.literal('')),
  city: z.string().trim().max(100, 'City must be under 100 characters.').nullable().optional().or(z.literal('')),
  state: z.string().trim().max(100, 'State must be under 100 characters.').nullable().optional().or(z.literal('')),
  zipCode: z.string().trim().max(20, 'Zip Code must be under 20 characters.').nullable().optional().or(z.literal('')),
  country: z.string().trim().max(100, 'Country must be under 100 characters.').nullable().optional().or(z.literal('')),
  dietaryNotes: z.string().trim().nullable().optional(),
  plusOneAllocations: z.coerce.number().int().nonnegative().optional().default(0),
  plusOneFirstName: z.string().trim().max(100, 'Plus-one first name must be under 100 characters.').nullable().optional().or(z.literal('')),
  plusOneLastName: z.string().trim().max(100, 'Plus-one last name must be under 100 characters.').nullable().optional().or(z.literal('')),
  extraFields: z.record(z.string(), z.any()).nullable().optional(),
  used: z.boolean().default(false),
  usedAt: z.union([z.string(), z.date()]).nullable().optional(),
  tableId: z.string().nullable().optional(),
  seatNumber: z.number().int().positive().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type InvitationCodeDTO = z.infer<typeof InvitationCodeSchema>;

const BatchImportInvitationCodeItemSchema = z.object({
  guestName: z.string({ message: 'Guest name is required.' }).trim().min(1, 'Guest name is required.').max(100, 'Guest name must be under 100 characters.'),
  code: z.string().trim().optional().or(z.literal('')),
  email: z.union([
    z.string().trim().email('Invalid email address.'),
    z.literal(''),
    z.null(),
    z.undefined()
  ]).optional(),
  addressLine1: z.string().trim().max(150, 'Address Line 1 must be under 150 characters.').optional().or(z.literal('')).nullable(),
  addressLine2: z.string().trim().max(150, 'Address Line 2 must be under 150 characters.').optional().or(z.literal('')).nullable(),
  city: z.string().trim().max(100, 'City must be under 100 characters.').optional().or(z.literal('')).nullable(),
  state: z.string().trim().max(100, 'State must be under 100 characters.').optional().or(z.literal('')).nullable(),
  zipCode: z.string().trim().max(20, 'Zip Code must be under 20 characters.').optional().or(z.literal('')).nullable(),
  country: z.string().trim().max(100, 'Country must be under 100 characters.').optional().or(z.literal('')).nullable(),
  dietaryNotes: z.string().trim().optional().or(z.literal('')).nullable(),
  plusOneAllocations: z.coerce.number().int('Plus-one allocation must be an integer.').nonnegative('Plus-one allocation must be non-negative.').optional(),
  plusOneFirstName: z.string().trim().max(100, 'Plus-one first name must be under 100 characters.').optional().or(z.literal('')).nullable(),
  plusOneLastName: z.string().trim().max(100, 'Plus-one last name must be under 100 characters.').optional().or(z.literal('')).nullable(),
  extraFields: z.record(z.string(), z.any()).optional().nullable(),
});

export const BatchImportInvitationCodesSchema = z.object({
  records: z.array(BatchImportInvitationCodeItemSchema).min(1, 'At least one record is required for batch import.'),
  collisionStrategy: z.enum(['skip', 'update', 'reject']).default('skip'),
});

export type BatchImportInvitationCodesDTO = z.infer<typeof BatchImportInvitationCodesSchema>;

export const GuestAddressUpdateSchema = z.object({
  code: z.string().trim().optional(),
  addressLine1: z.string().trim().max(150, 'Address Line 1 must be under 150 characters.').optional().or(z.literal('')).nullable(),
  addressLine2: z.string().trim().max(150, 'Address Line 2 must be under 150 characters.').optional().or(z.literal('')).nullable(),
  city: z.string().trim().max(100, 'City must be under 100 characters.').optional().or(z.literal('')).nullable(),
  state: z.string().trim().max(100, 'State must be under 100 characters.').optional().or(z.literal('')).nullable(),
  zipCode: z.string().trim().max(20, 'Zip Code must be under 20 characters.').optional().or(z.literal('')).nullable(),
  country: z.string().trim().max(100, 'Country must be under 100 characters.').optional().or(z.literal('')).nullable(),
});

export type GuestAddressUpdateDTO = z.infer<typeof GuestAddressUpdateSchema>;


