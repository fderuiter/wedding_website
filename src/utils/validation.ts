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

export const DynamicSchema = z.record(z.string(), z.any());

export const UpdateFeaturesSchema = z.object({
  features: z.array(z.any())
});

export const ImportBackupSchema = z.object({
  appConfig: z.array(z.any()).optional(),
  contentNode: z.array(z.any()).optional(),
  weddingPartyMember: z.array(z.any()).optional(),
  attraction: z.array(z.any()).optional(),
  registryItem: z.array(z.any()).optional(),
  contributor: z.array(z.any()).optional(),
});
