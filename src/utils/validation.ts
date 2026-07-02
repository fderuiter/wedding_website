import { z } from 'zod';
import { ContributionSchema, RegistryItemBaseSchema as RegistryItemSchema } from '@/features/registry/schemas';

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

// Schemas are imported from features/registry/schemas.ts

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
