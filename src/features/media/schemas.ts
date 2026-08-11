import { z } from 'zod';

export const MediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  altText: z.string().nullable(),
  isDecorative: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MediaDTO = z.infer<typeof MediaSchema>;

export const MediaCreateSchema = z.object({
  url: z.string().url(),
  altText: z.string().nullable(),
  isDecorative: z.boolean().default(false),
});

export const MediaUpdateSchema = MediaCreateSchema.partial();

export const createMediaAssociationSchema = (prefix: 'image' | 'photo') => {
  const isPhoto = prefix === 'photo';
  return z.object({
    [`${prefix}Id`]: z.string().nullable().optional(),
    [`${prefix}Url`]: z.string()
      .max(2000, `${isPhoto ? 'Photo URL' : 'Image URL'} must be under 2000 characters`)
      .optional()
      .nullable()
      .or(z.literal('')),
    [`${prefix}Alt`]: z.string().optional().nullable(),
    [`${prefix}Decorative`]: z.boolean().optional(),
    [prefix]: MediaSchema.nullable().optional(),
  });
};

