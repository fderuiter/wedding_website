import { z } from 'zod';

export const coordinateSchema = z.union([z.number(), z.string()]).superRefine((val, ctx) => {
  if (typeof val === 'number') return;
  const parsed = parseFloat(val);
  if (!isNaN(parsed)) return;

  if (!/^[A-Z_]+$/.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid coordinate format. Must be a numeric value or a placeholder.',
    });
  }
}).transform((val) => {
  if (typeof val === 'number') return val;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
});

// Centralized Zod schemas for registry
export const ContributionSchema = z.object({
  itemId: z.string({ message: 'Missing or invalid itemId.' }).min(1, 'Missing or invalid itemId.'),
  name: z.string({ message: 'Name is required and must be under 100 characters.' }).trim().min(1, 'Name is required and must be under 100 characters.').max(100, 'Name is required and must be under 100 characters.'),
  amount: z.number({ message: 'Contribution amount must be a positive number.' }).positive('Contribution amount must be a positive number.'),
}, { message: 'Invalid request body.' });

export const RegistryItemSchema = z.object({
  name: z.string({ message: 'Item name is required and must be under 255 characters.' }).trim().min(1, 'Item name is required and must be under 255 characters.').max(255, 'Item name is required and must be under 255 characters.'),
  price: z.number({ message: 'Price must be a positive number.' }).positive('Price must be a positive number.'),
  quantity: z.number({ message: 'Quantity must be a positive integer.' }).int('Quantity must be a positive integer.').positive('Quantity must be a positive integer.'),
  category: z.string({ message: 'Category is required and must be under 255 characters.' }).trim().min(1, 'Category is required and must be under 255 characters.').max(255, 'Category is required and must be under 255 characters.'),
  description: z.string().max(2000, 'Description must be under 2000 characters.').optional().or(z.literal('')),
  image: z.string().max(2000, 'Image URL must be under 2000 characters.').optional().or(z.literal('')),
  vendorUrl: z.string().max(2000, 'Vendor URL must be under 2000 characters.').optional().nullable().or(z.literal('')),
  isGroupGift: z.union([z.boolean(), z.literal('on'), z.literal('off'), z.string()]).optional().transform(v => v === true || v === 'on' || v === 'true'),
}, { message: 'Invalid request body.' });

function isValidString(value: unknown, maxLength: number = 255): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function validateContentNodeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Invalid request body.';
  const data = input as Record<string, unknown>;

  if (!isValidString(data.type, 100)) return 'Type is required and must be under 100 characters.';
  if (!Array.isArray(data.tags)) return 'Tags must be an array of strings.';
  for (const tag of data.tags) {
    if (!isValidString(tag, 100)) return 'Each tag must be a string under 100 characters.';
  }

  if (typeof data.data !== 'object' || data.data === null) return 'Data must be an object.';

  for (const [key, value] of Object.entries(data.data)) {
    if (key.toLowerCase().includes('url') && typeof value === 'string' && value !== '') {
      try {
        new URL(value);
      } catch (e) {
        return `Field ${key} contains an invalid URL.`;
      }
    }
  }

  return null;
}

export function validateContributeInput(input: unknown): string | null {
  const result = ContributionSchema.safeParse(input);
  if (!result.success) {
    return result.error.issues[0].message;
  }
  return null;
}

export function validateAddItemInput(input: unknown): string | null {
  const result = RegistryItemSchema.safeParse(input);
  if (!result.success) {
    return result.error.issues[0].message;
  }
  return null;
}
