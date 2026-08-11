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

export const ImageAssociationSchema = z.object({
  imageId: z.string().nullable().optional(),
  imageUrl: z.string()
    .max(2000, 'Image URL must be under 2000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  imageAlt: z.string().optional().nullable(),
  imageDecorative: z.boolean().optional(),
  image: MediaSchema.nullable().optional(),
});

export const PhotoAssociationSchema = z.object({
  photoId: z.string().nullable().optional(),
  photoUrl: z.string()
    .max(2000, 'Photo URL must be under 2000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  photoAlt: z.string().optional().nullable(),
  photoDecorative: z.boolean().optional(),
  photo: MediaSchema.nullable().optional(),
});

export function createMediaAssociationSchema(prefix: 'image'): typeof ImageAssociationSchema;
export function createMediaAssociationSchema(prefix: 'photo'): typeof PhotoAssociationSchema;
export function createMediaAssociationSchema(prefix: 'image' | 'photo') {
  return prefix === 'image' ? ImageAssociationSchema : PhotoAssociationSchema;
}

